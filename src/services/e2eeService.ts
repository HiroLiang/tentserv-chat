import { e2eeApi } from '@/api/index.ts';
import { useE2eeStore } from '@/stores/e2eeStore.ts';
import { useChatStore } from '@/stores/chatStore.ts';
import { useUserStore } from '@/stores/userStore.ts';
import { logger } from '@/utils/logger.ts';
import {
    bootstrapLocalE2eeKeys,
    replenishOtpKeys,
    performX3dhSend,
    performX3dhReceive,
    hasSenderKey,
    generateSenderKey,
    encryptWithSenderKey,
    decryptWithSenderKey,
    storeMemberSenderKey,
} from '@/bridge/e2ee.ts';

export const WAITING_FOR_SENDER_KEY = '__E2EE_WAITING_KEY__';
import type {
    PublicKeyBundle,
    InitialMessage,
} from '@/types/e2ee.ts';

const INITIAL_SPK_KEY_ID = 1;
const DEFAULT_OTP_PREKEY_TARGET_COUNT = 20;
const DEFAULT_OTP_PREKEY_REPLENISH_THRESHOLD = 5;

// Rust returns [u8;32] / [u8;64] as number[] in JSON.
// Server expects base64.StdEncoding (standard, not URL-safe, with padding).
const toBase64 = (bytes: number[]): string =>
    btoa(String.fromCharCode(...bytes));

type IdentityKeys = Awaited<ReturnType<typeof bootstrapLocalE2eeKeys>>['identity_keys'];
type SignedPreKey = Awaited<ReturnType<typeof bootstrapLocalE2eeKeys>>['spk'];
type KeyStatus = Awaited<ReturnType<typeof e2eeApi.checkKeyStatus>>;
type KeyPolicy = Awaited<ReturnType<typeof e2eeApi.getKeyPolicy>>;

// [EN] E2eeService manages end-to-end encryption key lifecycle using Signal Protocol X3DH.
//      Private keys live in the OS keyring (Tauri). Public keys are uploaded to the backend.
//      Message encryption uses per-room AES-256-GCM sender keys.
// [中] E2eeService 使用 Signal Protocol X3DH 管理端對端加密金鑰生命週期。
//      私鑰存於系統 keyring（Tauri），公鑰上傳至後端。訊息加密使用各房間的 AES-256-GCM sender key。
// [日] E2eeService は Signal Protocol X3DH を用いてエンドツーエンド暗号化の鍵ライフサイクルを管理する。
//      秘密鍵は OS keyring（Tauri）に保存し、公開鍵はバックエンドにアップロードする。
//      メッセージの暗号化にはルームごとの AES-256-GCM sender key を使用する。
class E2eeService {
    private _initPromises = new Map<string, Promise<void>>();
    private _replenishPromises = new Map<string, Promise<void>>();

    private getCurrentUserId(): number {
        const userId = useUserStore.getState().currentUser?.id;
        if (!userId) throw new Error('No current user');
        return userId;
    }

    private getCurrentAccountId(): number {
        const accountId = useUserStore.getState().currentUser?.accountId;
        if (!accountId) throw new Error('No current account');
        return accountId;
    }

    private resolveCurrentMemberId(roomId: number, memberId?: number): number {
        if (memberId !== undefined) return memberId;

        const myParticipantId = useUserStore.getState().participantId;
        const roomDetail = useChatStore.getState().currentRoomDetail;
        if (myParticipantId === null || !roomDetail || roomDetail.room_id !== roomId) {
            throw new Error(`No participant context for room ${roomId}`);
        }

        const me = roomDetail.members.find((m) => m.participant_id === myParticipantId);
        if (!me) {
            throw new Error(`No member mapping found for room ${roomId}`);
        }

        return me.member_id;
    }

    private async ensureRemoteBootstrap(
        accountId: number,
        userId: number,
        deviceId: string,
        identityKeys: IdentityKeys,
        spk: SignedPreKey,
        policy: Required<KeyPolicy>,
        identityRegenerated: boolean,
        spkRegenerated: boolean,
    ): Promise<number> {
        const status = await e2eeApi.checkKeyStatus(userId, deviceId);
        const identityNeedsUpload = identityRegenerated || !remoteIdentityMatches(status, identityKeys);
        const spkNeedsUpload = identityNeedsUpload || spkRegenerated || !remoteSPKMatches(status, spk);

        if (identityNeedsUpload) {
            await e2eeApi.uploadIdentityKey(deviceId, toBase64(identityKeys.identity_key_dh_pub), toBase64(identityKeys.identity_key_sign_pub));
            logger.info('E2EE identity key uploaded');
        }

        if (spkNeedsUpload) {
            await e2eeApi.uploadSignedPreKey(deviceId, spk.key_id, toBase64(spk.public_key), toBase64(spk.signature));
            logger.info('E2EE signed pre-key uploaded');
        }

        let otpCount = status.otp_prekey_count ?? 0;
        const shouldReplenish = identityRegenerated || otpCount < policy.otp_prekey_target_count;
        if (shouldReplenish) {
            // When IK was regenerated, old OTP private keys are gone — force a full batch.
            const targetDelta = identityRegenerated
                ? policy.otp_prekey_target_count
                : policy.otp_prekey_target_count - otpCount;
            if (targetDelta > 0) {
                const otpKeys = await replenishOtpKeys(accountId, targetDelta);
                logger.info(`E2EE OTP pre-keys generated: ${otpKeys.length}`);
                const { count: uploadedOtpCount } = await e2eeApi.uploadOTPPreKeys(deviceId, otpKeys.map(k => ({
                    key_id: k.key_id,
                    public_key: toBase64(k.public_key),
                })));
                otpCount = uploadedOtpCount;
                logger.info('E2EE OTP pre-keys uploaded');
            }
        }

        return otpCount;
    }

    // [EN] ensureInitialized: bootstraps local account-scoped E2EE keys and reconciles them with remote public key status.
    //      A Promise guard keyed by accountId:deviceId prevents concurrent re-entrant calls.
    // [中] ensureInitialized：以 accountId 為本地命名空間初始化 E2EE key，並與遠端公開 key status 同步。
    //      以 accountId:deviceId 為 key 的 Promise 快取防止並發重入。
    // [日] ensureInitialized：accountId をローカル名前空間として E2EE key を初期化し、リモート公開 key status と同期する。
    //      accountId:deviceId をキーとする Promise キャッシュで並行再入を防ぐ。
    async ensureInitialized(deviceId: string): Promise<void> {
        const accountId = this.getCurrentAccountId();
        const userId = this.getCurrentUserId();
        const key = `${accountId}:${deviceId}`;
        const existing = this._initPromises.get(key);
        if (existing) return existing;

        const promise = this._doInitialize(accountId, userId, deviceId).finally(() => {
            this._initPromises.delete(key);
        });
        this._initPromises.set(key, promise);
        return promise;
    }

    private async _doInitialize(accountId: number, userId: number, deviceId: string): Promise<void> {
        const policy = normalizeKeyPolicy(await e2eeApi.getKeyPolicy());
        const store = useE2eeStore.getState();
        store.setKeyPolicy(policy.otp_prekey_target_count, policy.otp_prekey_replenish_threshold);

        // Single Tauri call: validates, clears if corrupted, regenerates with ONE master key read.
        const local = await bootstrapLocalE2eeKeys(accountId, INITIAL_SPK_KEY_ID);
        logger.info('E2EE local bootstrap complete', {
            identityRegenerated: local.identity_regenerated,
            spkRegenerated: local.spk_regenerated,
        });

        const otpCount = await this.ensureRemoteBootstrap(
            accountId,
            userId,
            deviceId,
            local.identity_keys,
            local.spk,
            policy,
            local.identity_regenerated,
            local.spk_regenerated,
        );
        store.setOtpKeyCount(otpCount);
        store.setKeysUploaded(true);
        logger.info('E2EE keys initialized and reconciled');
    }

    async replenishOTPKeys(deviceId: string, threshold?: number): Promise<void> {
        const accountId = this.getCurrentAccountId();
        const key = `${accountId}:${deviceId}`;
        const existing = this._replenishPromises.get(key);
        if (existing) return existing;

        const promise = this._doReplenishOTPKeys(accountId, deviceId, threshold).finally(() => {
            this._replenishPromises.delete(key);
        });
        this._replenishPromises.set(key, promise);
        return promise;
    }

    private async _doReplenishOTPKeys(accountId: number, deviceId: string, threshold?: number): Promise<void> {
        const { count } = await e2eeApi.countOTPPreKeys(deviceId);
        const store = useE2eeStore.getState();
        store.setOtpKeyCount(count);

        const replenishThreshold = resolvePositiveNumber(
            threshold,
            store.otpReplenishThreshold,
            DEFAULT_OTP_PREKEY_REPLENISH_THRESHOLD,
        );
        if (count >= replenishThreshold) return;

        const targetCount = resolvePositiveNumber(
            undefined,
            store.otpKeyTargetCount,
            DEFAULT_OTP_PREKEY_TARGET_COUNT,
        );
        const delta = Math.max(targetCount - count, 0);
        if (delta <= 0) return;

        const otpKeys = await replenishOtpKeys(accountId, delta);
        if (otpKeys.length === 0) return;

        const { count: newCount } = await e2eeApi.uploadOTPPreKeys(deviceId, otpKeys.map(k => ({
            key_id: k.key_id,
            public_key: toBase64(k.public_key),
        })));
        store.setOtpKeyCount(newCount);

        logger.info(`Replenished ${otpKeys.length} OTP keys`);
    }

    async performSend(
        targetUserId: number,
        targetDeviceId: string,
        plaintext: string,
    ): Promise<InitialMessage> {
        const accountId = this.getCurrentAccountId();
        const bundle = await e2eeApi.getKeyBundle(targetUserId, targetDeviceId);

        const keyBundle: PublicKeyBundle = {
            identity_key_dh: fromBase64(bundle.identity_key),
            identity_key_sign: fromBase64(bundle.identity_key_sign),
            signed_pre_key: fromBase64(bundle.signed_pre_key),
            spk_signature: fromBase64(bundle.spk_signature),
            spk_key_id: bundle.spk_key_id,
            one_time_pre_key: bundle.otp_pre_key ? fromBase64(bundle.otp_pre_key) : undefined,
            otpk_key_id: bundle.otp_pre_key_id,
        };

        return performX3dhSend(accountId, keyBundle, Array.from(new TextEncoder().encode(plaintext)));
    }

    async performReceive(
        msg: InitialMessage,
        spkKeyId: number,
        otpkKeyId?: number,
    ): Promise<string> {
        const accountId = this.getCurrentAccountId();
        const plaintextBytes = await performX3dhReceive(accountId, msg, spkKeyId, otpkKeyId);

        return new TextDecoder().decode(new Uint8Array(plaintextBytes));
    }

    // [EN] performDirectKeyExchange: fetches the other user's X3DH public key bundle,
    //      generates a sender key, encrypts it via X3DH send, and uploads it to the backend.
    //      Both inviter and invitee call this to each upload their own sender key.
    // [中] performDirectKeyExchange：取得對方 X3DH 公鑰包，生成 sender key，用 X3DH send 加密後上傳至後端。
    //      邀請者與被邀請者各自呼叫以上傳各自的 sender key。
    // [日] performDirectKeyExchange：相手の X3DH 公開鍵バンドルを取得し、sender key を生成して
    //      X3DH send で暗号化してバックエンドにアップロードする。招待者・被招待者の両方がそれぞれ呼び出す。
    async performDirectKeyExchange(roomId: number, inviterUserId: number, memberId?: number): Promise<void> {
        const accountId = this.getCurrentAccountId();
        const myMemberId = this.resolveCurrentMemberId(roomId, memberId);
        const bundle = await e2eeApi.getKeyBundle(inviterUserId);

        const keyBundle: PublicKeyBundle = {
            identity_key_dh: fromBase64(bundle.identity_key),
            identity_key_sign: fromBase64(bundle.identity_key_sign),
            signed_pre_key: fromBase64(bundle.signed_pre_key),
            spk_signature: fromBase64(bundle.spk_signature),
            spk_key_id: bundle.spk_key_id,
            one_time_pre_key: bundle.otp_pre_key ? fromBase64(bundle.otp_pre_key) : undefined,
            otpk_key_id: bundle.otp_pre_key_id,
        };

        const senderKey = await generateSenderKey(accountId, myMemberId);
        const initialMsg = await performX3dhSend(accountId, keyBundle, senderKey.public_key);

        const distMsgBytes = Array.from(new TextEncoder().encode(JSON.stringify(initialMsg)));

        await e2eeApi.uploadSenderKey(
            roomId,
            toBase64(senderKey.public_key),
            toBase64(distMsgBytes),
        );

        logger.info(`Direct key exchange completed for room ${roomId}`);
    }

    // [EN] encryptMessage: encrypts plaintext bytes with the room's AES-256-GCM sender key.
    //      Returns "e2ee:v1:{base64(nonce + ciphertext)}".
    // [中] encryptMessage：用房間 AES-256-GCM sender key 加密明文位元組，回傳 "e2ee:v1:{base64(nonce + ciphertext)}"。
    // [日] encryptMessage：ルームの AES-256-GCM sender key でプレーンテキストを暗号化し、
    //      "e2ee:v1:{base64(nonce + ciphertext)}" を返す。
    async encryptMessage(roomId: number, plaintext: string, memberId?: number): Promise<string> {
        const accountId = this.getCurrentAccountId();
        const myMemberId = this.resolveCurrentMemberId(roomId, memberId);
        const bytes = Array.from(new TextEncoder().encode(plaintext));
        const { ciphertext, nonce } = await encryptWithSenderKey(accountId, myMemberId, bytes);
        const combined = new Uint8Array([...nonce, ...ciphertext]);
        const b64 = btoa(String.fromCharCode(...combined));
        return `e2ee:v1:${b64}`;
    }

    // [EN] decryptMessage: decodes "e2ee:v1:{base64}" content back to plaintext using the sender's key.
    //      Returns content unchanged if it is not in the e2ee envelope format.
    // [中] decryptMessage：將 "e2ee:v1:{base64}" 格式的訊息解密回明文；若非 e2ee 格式則原樣返回。
    // [日] decryptMessage："e2ee:v1:{base64}" 形式のコンテンツを送信者の鍵で復号して平文に戻す。
    //      e2ee エンベロープ形式でない場合はそのまま返す。
    async decryptMessage(content: string, senderMemberId: number): Promise<string> {
        const PREFIX = 'e2ee:v1:';
        if (!content.startsWith(PREFIX)) return content;
        const accountId = this.getCurrentAccountId();
        try {
            const combined = Uint8Array.from(atob(content.slice(PREFIX.length)), c => c.charCodeAt(0));
            const nonce = Array.from(combined.slice(0, 12));
            const ciphertext = Array.from(combined.slice(12));
            const plaintext = await decryptWithSenderKey(accountId, senderMemberId, ciphertext, nonce);
            return new TextDecoder().decode(new Uint8Array(plaintext));
        } catch (err) {
            logger.warn(`Failed to decrypt message from member ${senderMemberId}`, err);
            const keyExists = await hasSenderKey(accountId, senderMemberId).catch(() => false);
            if (!keyExists) return WAITING_FOR_SENDER_KEY;
            return content;
        }
    }

    // Called when the inviter receives e2ee.sender_key_needed.
    // Encrypts own sender key using the requester's (invitee's) X3DH public key bundle and uploads it.
    async performInviterKeyExchange(roomId: number, requesterUserId: number, memberId?: number): Promise<void> {
        const accountId = this.getCurrentAccountId();
        const myMemberId = this.resolveCurrentMemberId(roomId, memberId);
        const bundle = await e2eeApi.getKeyBundle(requesterUserId);

        const keyBundle: PublicKeyBundle = {
            identity_key_dh: fromBase64(bundle.identity_key),
            identity_key_sign: fromBase64(bundle.identity_key_sign),
            signed_pre_key: fromBase64(bundle.signed_pre_key),
            spk_signature: fromBase64(bundle.spk_signature),
            spk_key_id: bundle.spk_key_id,
            one_time_pre_key: bundle.otp_pre_key ? fromBase64(bundle.otp_pre_key) : undefined,
            otpk_key_id: bundle.otp_pre_key_id,
        };

        const senderKey = await generateSenderKey(accountId, myMemberId);
        const initialMsg = await performX3dhSend(accountId, keyBundle, senderKey.public_key);

        const distMsgBytes = Array.from(new TextEncoder().encode(JSON.stringify(initialMsg)));

        await e2eeApi.uploadSenderKey(
            roomId,
            toBase64(senderKey.public_key),
            toBase64(distMsgBytes),
        );

        logger.info(`Inviter key exchange completed for room ${roomId}`);
    }

    // [EN] resolveMemberSenderKeys: fetches all sender keys for a room, decrypts each distribution_message
    //      via X3DH receive, and stores the resulting AES key bytes in the local keyring.
    // [中] resolveMemberSenderKeys：取得房間內所有成員的 sender key，
    //      用 X3DH receive 解密每個 distribution_message，並將 AES key bytes 存入本地 keyring。
    async resolveMemberSenderKeys(roomId: number): Promise<void> {
        const accountId = this.getCurrentAccountId();
        const myMemberId = this.resolveCurrentMemberId(roomId);
        const resp = await e2eeApi.getSenderKeys(roomId);
        for (const item of resp.keys) {
            if (item.chat_member_id === myMemberId) continue;
            try {
                // distribution_message is base64(JSON.stringify(InitialMessage))
                const distBytes = Uint8Array.from(atob(item.distribution_message), c => c.charCodeAt(0));
                const initialMsg = JSON.parse(new TextDecoder().decode(distBytes)) as {
                    identity_key_dh_pub: number[];
                    identity_key_sign_pub: number[];
                    ephemeral_key_pub: number[];
                    spk_key_id: number;
                    otpk_key_id?: number;
                    ciphertext: number[];
                    nonce: number[];
                };
                const keyBytes = await performX3dhReceive(accountId, initialMsg, initialMsg.spk_key_id, initialMsg.otpk_key_id);
                await storeMemberSenderKey(accountId, item.chat_member_id, keyBytes);
            } catch (err) {
                logger.warn(`Failed to resolve sender key for member ${item.chat_member_id}`, err);
            }
        }
    }

    async resolveDirectKey(roomId: number): Promise<boolean> {
        const status = await e2eeApi.getSenderKeyDistributionStatus(roomId);
        if (!status || !Array.isArray(status.pending_from_members)) {
            logger.warn(`Invalid sender key distribution status for room ${roomId}`, status);
            return false;
        }

        let myMemberId: number;
        try {
            myMemberId = this.resolveCurrentMemberId(roomId);
        } catch (err) {
            logger.warn(`Cannot resolve local sender key state for room ${roomId}`, err);
            return false;
        }

        const accountId = this.getCurrentAccountId();
        const localSenderKeyExists = await hasSenderKey(accountId, myMemberId).catch(() => false);
        return status.own_sender_key_exists
            && localSenderKeyExists
            && status.pending_from_members.length === 0;
    }
}

const fromBase64 = (b64: string): number[] =>
    Array.from(atob(b64), c => c.charCodeAt(0));

const normalizeKeyPolicy = (policy: KeyPolicy): Required<KeyPolicy> => ({
    otp_prekey_target_count: policy.otp_prekey_target_count > 0
        ? policy.otp_prekey_target_count
        : DEFAULT_OTP_PREKEY_TARGET_COUNT,
    otp_prekey_replenish_threshold: policy.otp_prekey_replenish_threshold > 0
        ? policy.otp_prekey_replenish_threshold
        : DEFAULT_OTP_PREKEY_REPLENISH_THRESHOLD,
});

const resolvePositiveNumber = (preferred: number | undefined, fallback: number, defaultValue: number): number => {
    if (preferred !== undefined && preferred > 0) return preferred;
    if (fallback > 0) return fallback;
    return defaultValue;
};

const remoteIdentityMatches = (status: KeyStatus, identityKeys: IdentityKeys): boolean =>
    status.identity_key_exists &&
    status.identity_key === toBase64(identityKeys.identity_key_dh_pub) &&
    status.identity_key_sign === toBase64(identityKeys.identity_key_sign_pub);

const remoteSPKMatches = (status: KeyStatus, spk: SignedPreKey): boolean =>
    status.signed_pre_key_exists &&
    status.spk_key_id === spk.key_id &&
    status.signed_pre_key === toBase64(spk.public_key) &&
    status.spk_signature === toBase64(spk.signature);

export const e2eeService = new E2eeService();
