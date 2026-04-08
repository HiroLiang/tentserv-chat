import { e2eeApi } from '@/api/index.ts';
import { useE2eeStore } from '@/stores/e2eeStore.ts';
import { useChatStore } from '@/stores/chatStore.ts';
import { useUserStore } from '@/stores/userStore.ts';
import { logger } from '@/utils/logger.ts';
import {
    generateIdentityKeys,
    getIdentityKeys,
    generateSignedPreKey,
    getSignedPreKey,
    replenishOtpKeys,
    performX3dhSend,
    performX3dhReceive,
    hasIdentityKeys,
    validateE2eeKeyMaterial,
    hasSenderKey,
    generateSenderKey,
    encryptWithSenderKey,
    decryptWithSenderKey,
    storeMemberSenderKey,
    clearE2eeKeys,
} from '@/bridge/e2ee.ts';

export const WAITING_FOR_SENDER_KEY = '__E2EE_WAITING_KEY__';
import type {
    PublicKeyBundle,
    InitialMessage,
} from '@/types/e2ee.ts';

const INITIAL_SPK_KEY_ID = 1;

// Rust returns [u8;32] / [u8;64] as number[] in JSON.
// Server expects base64.StdEncoding (standard, not URL-safe, with padding).
const toBase64 = (bytes: number[]): string =>
    btoa(String.fromCharCode(...bytes));

type IdentityKeys = Awaited<ReturnType<typeof generateIdentityKeys>>;
type SignedPreKey = Awaited<ReturnType<typeof generateSignedPreKey>>;

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

    private getCurrentUserId(): number {
        const userId = useUserStore.getState().currentUser?.id;
        if (!userId) throw new Error('No current user');
        return userId;
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

    private async prepareLocalKeyMaterial(
        userId: number,
        locallyInitialized: boolean,
    ): Promise<{ identityKeys: IdentityKeys; spk: SignedPreKey }> {
        if (locallyInitialized) {
            try {
                const identityKeys = await getIdentityKeys(userId);
                logger.info('E2EE reusing existing local identity key for re-upload');

                let spk: SignedPreKey;
                try {
                    spk = await getSignedPreKey(userId, INITIAL_SPK_KEY_ID);
                    logger.info('E2EE reusing existing local SPK for re-upload');
                } catch {
                    spk = await generateSignedPreKey(userId, INITIAL_SPK_KEY_ID);
                    logger.info('E2EE generating new SPK (local not found)');
                }

                const usable = await validateE2eeKeyMaterial(userId, INITIAL_SPK_KEY_ID);
                if (!usable) {
                    throw new Error('local E2EE key material is incomplete');
                }

                return { identityKeys, spk };
            } catch (err) {
                logger.warn('E2EE local key material unusable; clearing and regenerating', err);
                await clearE2eeKeys(userId);
            }
        }

        const identityKeys = await generateIdentityKeys(userId);
        logger.info(locallyInitialized
            ? 'E2EE generating new identity key after local reset'
            : 'E2EE generating new identity key (first time)');

        const spk = await generateSignedPreKey(userId, INITIAL_SPK_KEY_ID);
        logger.info('E2EE generating new SPK (identity key is new)');

        const usable = await validateE2eeKeyMaterial(userId, INITIAL_SPK_KEY_ID);
        if (!usable) {
            throw new Error('E2EE key material validation failed after regeneration');
        }

        return { identityKeys, spk };
    }

    // [EN] ensureInitialized: generates identity keys if absent or if backend is missing them,
    //      uploads identity key + signed pre-key + 20 OTP pre-keys. If already initialized, replenishes OTP keys.
    //      A Promise guard keyed by userId:deviceId prevents concurrent re-entrant calls.
    // [中] ensureInitialized：若本地無身份金鑰或後端遺失，則生成並上傳身份金鑰、signed pre-key 及 20 個 OTP pre-key；
    //      若已初始化則補充 OTP 金鑰。以 userId:deviceId 為 key 的 Promise 快取防止並發重入。
    // [日] ensureInitialized：ローカルに identity key がない、またはバックエンドが欠損している場合に
    //      identity key、signed pre-key、20 個の OTP pre-key を生成・アップロードする。既初期化時は OTP key を補充する。
    //      userId:deviceId をキーとする Promise キャッシュで並行再入を防ぐ。
    async ensureInitialized(deviceId: string): Promise<void> {
        const userId = this.getCurrentUserId();
        const key = `${userId}:${deviceId}`;
        const existing = this._initPromises.get(key);
        if (existing) return existing;

        const promise = this._doInitialize(userId, deviceId).finally(() => {
            this._initPromises.delete(key);
        });
        this._initPromises.set(key, promise);
        return promise;
    }

    private async _doInitialize(userId: number, deviceId: string): Promise<void> {
        const locallyInitialized = await hasIdentityKeys(userId);
        logger.info(`E2EE locally initialized: ${locallyInitialized}`);

        let needsUpload = !locallyInitialized;
        if (locallyInitialized) {
            try {
                const status = await e2eeApi.checkKeyStatus(userId, deviceId);
                if (!status.identity_key_exists || !status.signed_pre_key_exists) {
                    logger.warn('E2EE backend missing keys despite local init — re-uploading');
                    needsUpload = true;
                }
            } catch {
                logger.warn('E2EE key status check failed — re-uploading');
                needsUpload = true;
            }

            try {
                const localUsable = await validateE2eeKeyMaterial(userId, INITIAL_SPK_KEY_ID);
                if (!localUsable) {
                    logger.warn('E2EE local key material incomplete — re-uploading');
                    needsUpload = true;
                }
            } catch (err) {
                logger.warn('E2EE local key material validation failed — re-uploading', err);
                needsUpload = true;
            }
        }

        if (needsUpload) {
            const { identityKeys, spk } = await this.prepareLocalKeyMaterial(userId, locallyInitialized);

            await e2eeApi.uploadIdentityKey(
                deviceId,
                toBase64(identityKeys.identity_key_dh_pub),
                toBase64(identityKeys.identity_key_sign_pub),
            );
            logger.info('E2EE identity key uploaded');

            await e2eeApi.uploadSignedPreKey(deviceId, spk.key_id, toBase64(spk.public_key), toBase64(spk.signature));
            logger.info('E2EE signed pre-key uploaded');

            const otpKeys = await replenishOtpKeys(userId, 20);
            logger.info('E2EE OTP pre-keys generated');
            const { count: otpCount } = await e2eeApi.uploadOTPPreKeys(deviceId, otpKeys.map(k => ({
                key_id: k.key_id,
                public_key: toBase64(k.public_key)
            })));
            logger.info('E2EE OTP pre-keys uploaded');

            const e2eeState = useE2eeStore.getState();
            e2eeState.setKeysUploaded(true);
            e2eeState.setOtpKeyCount(otpCount);

            logger.info('E2EE keys initialized and uploaded');
        }

        if (!needsUpload) {
            await this.replenishOTPKeys(deviceId, 10);
        }
    }

    async replenishOTPKeys(deviceId: string, threshold = 20): Promise<void> {
        const userId = this.getCurrentUserId();
        const { count } = await e2eeApi.countOTPPreKeys(deviceId);
        const store = useE2eeStore.getState();
        store.setOtpKeyCount(count);

        if (count >= threshold) return;

        const otpKeys = await replenishOtpKeys(userId, 20);
        const { count: newCount } = await e2eeApi.uploadOTPPreKeys(deviceId, otpKeys.map(k => ({
            key_id: k.key_id,
            public_key: toBase64(k.public_key)
        })));
        store.setOtpKeyCount(newCount);

        logger.info(`Replenished ${otpKeys.length} OTP keys`);
    }

    async performSend(
        targetUserId: number,
        targetDeviceId: string,
        plaintext: string,
    ): Promise<InitialMessage> {
        const userId = this.getCurrentUserId();
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

        return performX3dhSend(userId, keyBundle, Array.from(new TextEncoder().encode(plaintext)));
    }

    async performReceive(
        msg: InitialMessage,
        spkKeyId: number,
        otpkKeyId?: number,
    ): Promise<string> {
        const userId = this.getCurrentUserId();
        const plaintextBytes = await performX3dhReceive(userId, msg, spkKeyId, otpkKeyId);

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
        const userId = this.getCurrentUserId();
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

        const senderKey = await generateSenderKey(userId, myMemberId);
        const initialMsg = await performX3dhSend(userId, keyBundle, senderKey.public_key);

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
        const userId = this.getCurrentUserId();
        const myMemberId = this.resolveCurrentMemberId(roomId, memberId);
        const bytes = Array.from(new TextEncoder().encode(plaintext));
        const { ciphertext, nonce } = await encryptWithSenderKey(userId, myMemberId, bytes);
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
        const userId = this.getCurrentUserId();
        try {
            const combined = Uint8Array.from(atob(content.slice(PREFIX.length)), c => c.charCodeAt(0));
            const nonce = Array.from(combined.slice(0, 12));
            const ciphertext = Array.from(combined.slice(12));
            const plaintext = await decryptWithSenderKey(userId, senderMemberId, ciphertext, nonce);
            return new TextDecoder().decode(new Uint8Array(plaintext));
        } catch (err) {
            logger.warn(`Failed to decrypt message from member ${senderMemberId}`, err);
            const keyExists = await hasSenderKey(userId, senderMemberId).catch(() => false);
            if (!keyExists) return WAITING_FOR_SENDER_KEY;
            return content;
        }
    }

    // Called when the inviter receives e2ee.sender_key_needed.
    // Encrypts own sender key using the requester's (invitee's) X3DH public key bundle and uploads it.
    async performInviterKeyExchange(roomId: number, requesterUserId: number, memberId?: number): Promise<void> {
        const userId = this.getCurrentUserId();
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

        const senderKey = await generateSenderKey(userId, myMemberId);
        const initialMsg = await performX3dhSend(userId, keyBundle, senderKey.public_key);

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
        const userId = this.getCurrentUserId();
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
                const keyBytes = await performX3dhReceive(userId, initialMsg, initialMsg.spk_key_id, initialMsg.otpk_key_id);
                await storeMemberSenderKey(userId, item.chat_member_id, keyBytes);
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

        const userId = this.getCurrentUserId();
        const localSenderKeyExists = await hasSenderKey(userId, myMemberId).catch(() => false);
        return status.own_sender_key_exists
            && localSenderKeyExists
            && status.pending_from_members.length === 0;
    }
}

const fromBase64 = (b64: string): number[] =>
    Array.from(atob(b64), c => c.charCodeAt(0));

export const e2eeService = new E2eeService();
