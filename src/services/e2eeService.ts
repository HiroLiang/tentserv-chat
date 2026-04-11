import { e2eeApi } from '@/api/index.ts';
import { useE2eeStore } from '@/stores/e2eeStore.ts';
import { useChatStore } from '@/stores/chatStore.ts';
import { useUserStore } from '@/stores/userStore.ts';
import { logger } from '@/utils/logger.ts';
import { toast } from 'sonner';
import {
    bootstrapLocalE2eeKeys,
    replenishOtpKeys,
    performX3dhSend,
    performX3dhReceive,
    hasSenderKey,
    getSenderKeyStates,
    deleteSenderKeys,
    encryptWithSenderKey,
    decryptWithSenderKey,
    prepareSenderKeyDistribution,
    consumeSenderKeyDistribution,
} from '@/bridge/e2ee.ts';

export const WAITING_FOR_SENDER_KEY = '__E2EE_WAITING_KEY__';
import type {
    PublicKeyBundle,
    InitialMessage,
    SenderKeyState,
} from '@/types/e2ee.ts';
import type {
    GetPendingSenderKeyDistributionsResponse,
    GetSenderKeyDistributionStatusResponse,
} from '@/api/types.ts';
import type { RoomMember } from '@/types/chat.ts';

const INITIAL_SPK_KEY_ID = 1;
const DEFAULT_OTP_PREKEY_TARGET_COUNT = 20;
const DEFAULT_OTP_PREKEY_REPLENISH_THRESHOLD = 5;
const MAX_BOOTSTRAP_ATTEMPTS = 2;
const E2EE_BOOTSTRAP_FAILURE_MESSAGE = 'End-to-end encryption could not be initialized. Chat is unavailable until encryption is ready.';

// Rust returns [u8;32] / [u8;64] as number[] in JSON.
// Server expects base64.StdEncoding (standard, not URL-safe, with padding).
const toBase64 = (bytes: number[]): string =>
    btoa(String.fromCharCode(...bytes));

type IdentityKeys = Awaited<ReturnType<typeof bootstrapLocalE2eeKeys>>['identity_keys'];
type SignedPreKey = Awaited<ReturnType<typeof bootstrapLocalE2eeKeys>>['spk'];
type KeyStatus = Awaited<ReturnType<typeof e2eeApi.checkKeyStatus>>;
type KeyPolicy = Awaited<ReturnType<typeof e2eeApi.getKeyPolicy>>;
type SenderKeyStateMap = Map<number, SenderKeyState>;

interface RoomSenderKeyReconciliationInput {
    roomId: number;
    roomMembers: RoomMember[];
    currentMemberId?: number;
}

interface RoomSenderKeyReconciliationResult {
    currentMemberId: number;
    status: GetSenderKeyDistributionStatusResponse;
    localStates: SenderKeyStateMap;
}

// [EN] E2eeService manages end-to-end encryption key lifecycle using Signal Protocol X3DH.
//      Private keys live in the OS keyring (Tauri). Public keys are uploaded to the backend.
//      Message encryption uses per-room AES-256-GCM sender keys.
// [中] E2eeService 使用 Signal Protocol X3DH 管理端對端加密金鑰生命週期。
//      私鑰存於系統 keyring（Tauri），公鑰上傳至後端。訊息加密使用各房間的 AES-256-GCM sender key。
// [日] E2eeService は Signal Protocol X3DH を用いてエンドツーエンド暗号化の鍵ライフサイクルを管理する。
//      秘密鍵は OS keyring（Tauri）に保存し、公開鍵はバックエンドにアップロードする。
//      メッセージの暗号化にはルームごとの AES-256-GCM sender key を使用する。
// Debounce window for decrypt-triggered sender key requests (ms).
const DECRYPT_REQUEST_DEBOUNCE_MS = 10_000;

class E2eeService {
    private _initPromises = new Map<string, Promise<void>>();
    private _replenishPromises = new Map<string, Promise<void>>();
    private _sessionBootstrapPromises = new Map<string, Promise<boolean>>();
    private _decryptRequestDebounce = new Map<string, number>();
    private _senderKeyUploadPromises = new Map<string, Promise<void>>();

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

    private resolveCurrentMemberIdFromMembers(roomId: number, roomMembers: RoomMember[], memberId?: number): number {
        if (memberId !== undefined) return memberId;

        const myParticipantId = useUserStore.getState().participantId;
        if (myParticipantId === null) {
            throw new Error(`No participant context for room ${roomId}`);
        }

        const me = roomMembers.find((member) => member.participant_id === myParticipantId);
        if (!me) {
            throw new Error(`No member mapping found for room ${roomId}`);
        }

        return me.member_id;
    }

    private resolvePeerMemberId(roomId: number, targetUserId?: number, fallbackMemberId?: number): number {
        if (fallbackMemberId !== undefined) return fallbackMemberId;

        const myParticipantId = useUserStore.getState().participantId;
        const myUserId = useUserStore.getState().currentUser?.id;
        const roomDetail = useChatStore.getState().currentRoomDetail;
        if (!roomDetail || roomDetail.room_id !== roomId) {
            throw new Error(`No room detail loaded for room ${roomId}`);
        }

        const peer = roomDetail.members.find(member => {
            if (targetUserId !== undefined && member.user_id === targetUserId) return true;
            if (myParticipantId !== null && member.participant_id === myParticipantId) return false;
            if (myUserId !== undefined && member.user_id === myUserId) return false;
            return true;
        });

        if (!peer) {
            throw new Error(`No peer member found for room ${roomId}`);
        }

        return peer.member_id;
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

    // [EN] ensureSessionBootstrap: retries startup/login bootstrap and records the global chat gate state.
    // [中] ensureSessionBootstrap：重試啟動/登入 bootstrap，並記錄全域 chat gate 狀態。
    // [日] ensureSessionBootstrap：起動/ログイン bootstrap を再試行し、グローバルな chat gate 状態を記録する。
    async ensureSessionBootstrap(deviceId: string): Promise<boolean> {
        const accountId = this.getCurrentAccountId();
        const key = `${accountId}:${deviceId}`;
        const store = useE2eeStore.getState();
        if (store.bootstrapStatus === 'ready' && store.keysUploaded) return true;

        const existing = this._sessionBootstrapPromises.get(key);
        if (existing) return existing;

        const promise = this._doEnsureSessionBootstrap(deviceId).finally(() => {
            this._sessionBootstrapPromises.delete(key);
        });
        this._sessionBootstrapPromises.set(key, promise);
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

    private async _doEnsureSessionBootstrap(deviceId: string): Promise<boolean> {
        const store = useE2eeStore.getState();
        store.resetBootstrapState();
        store.setBootstrapStatus('loading');

        for (let attempt = 1; attempt <= MAX_BOOTSTRAP_ATTEMPTS; attempt++) {
            try {
                await this.ensureInitialized(deviceId);
                useE2eeStore.getState().setBootstrapStatus('ready');
                return true;
            } catch (err) {
                logger.error(`E2EE initialization attempt ${attempt}/${MAX_BOOTSTRAP_ATTEMPTS} failed`, err);
                if (attempt === MAX_BOOTSTRAP_ATTEMPTS) {
                    const message = err instanceof Error ? err.message : 'Failed to initialize end-to-end encryption';
                    useE2eeStore.getState().setBootstrapStatus('failed', message);
                    toast.warning(E2EE_BOOTSTRAP_FAILURE_MESSAGE, {
                        id: 'e2ee-bootstrap-failed',
                    });
                    return false;
                }
            }
        }

        return false;
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

    private async getSenderKeyStateMap(accountId: number, memberIds: number[]): Promise<SenderKeyStateMap> {
        const states = await getSenderKeyStates(accountId, memberIds);
        return new Map(
            states.map((state) => [Number(state.member_id), state]),
        );
    }

    isDirectRoomReadyFromState(
        status: GetSenderKeyDistributionStatusResponse,
        localStates: Map<number, SenderKeyState>,
        options: { roomMembers?: RoomMember[]; currentMemberId: number },
    ): boolean {
        const localSenderKeyExists = localStates.get(options.currentMemberId)?.is_own_key === true;
        const peerMembers = (options.roomMembers ?? []).filter((member) => member.member_id !== options.currentMemberId);
        const allPeerKeysReady = peerMembers.every((member) => {
            const state = localStates.get(member.member_id);
            return state !== undefined && !state.is_own_key;
        });

        return status.own_sender_key_exists
            && localSenderKeyExists
            && (status.pending_from_members?.length ?? 0) === 0
            && (status.available_from_member_ids?.length ?? 0) === 0
            && (peerMembers.length === 0 || allPeerKeysReady);
    }

    async deleteLocalSenderKeys(memberIds: number[]): Promise<void> {
        if (memberIds.length === 0) return;
        const accountId = this.getCurrentAccountId();
        await deleteSenderKeys(accountId, memberIds);
    }

    private async createSenderKeyRequestOnce(roomId: number, providerMemberId: number): Promise<boolean> {
        const store = useE2eeStore.getState();
        if (store.hasSenderKeyRequest(roomId, providerMemberId)) {
            return false;
        }

        await e2eeApi.createSenderKeyRequest(roomId, providerMemberId);
        useE2eeStore.getState().addSenderKeyRequest(roomId, providerMemberId);
        return true;
    }

    private clearSenderKeyRequest(roomId: number, providerMemberId: number): void {
        useE2eeStore.getState().removeSenderKeyRequest(roomId, providerMemberId);
    }

    private async uploadOwnSenderKey(
        roomId: number,
        targetUserId: number,
        ownMemberId: number,
        receiverMemberId: number,
    ): Promise<void> {
        const uploadKey = `${roomId}:${ownMemberId}:${receiverMemberId}`;
        const existing = this._senderKeyUploadPromises.get(uploadKey);
        if (existing) {
            await existing;
            return;
        }

        const uploadPromise = this.uploadOwnSenderKeyOnce(roomId, targetUserId, ownMemberId, receiverMemberId);
        this._senderKeyUploadPromises.set(uploadKey, uploadPromise);
        try {
            await uploadPromise;
        } finally {
            if (this._senderKeyUploadPromises.get(uploadKey) === uploadPromise) {
                this._senderKeyUploadPromises.delete(uploadKey);
            }
        }
    }

    private async uploadOwnSenderKeyOnce(
        roomId: number,
        targetUserId: number,
        ownMemberId: number,
        receiverMemberId: number,
    ): Promise<void> {
        const accountId = this.getCurrentAccountId();
        const bundle = await e2eeApi.getKeyBundle(targetUserId);

        const keyBundle: PublicKeyBundle = {
            identity_key_dh: fromBase64(bundle.identity_key),
            identity_key_sign: fromBase64(bundle.identity_key_sign),
            signed_pre_key: fromBase64(bundle.signed_pre_key),
            spk_signature: fromBase64(bundle.spk_signature),
            spk_key_id: bundle.spk_key_id,
            one_time_pre_key: bundle.otp_pre_key ? fromBase64(bundle.otp_pre_key) : undefined,
            otpk_key_id: bundle.otp_pre_key_id,
        };

        const prepared = await prepareSenderKeyDistribution(accountId, ownMemberId, keyBundle);

        await e2eeApi.uploadSenderKey(
            roomId,
            receiverMemberId,
            prepared.sender_key_version,
            toBase64(prepared.distribution_message),
        );
    }

    private async provideOwnSenderKeyIfNeeded(
        roomId: number,
        ownMemberId: number,
        roomMembers: RoomMember[],
        localStates: SenderKeyStateMap,
        status: GetSenderKeyDistributionStatusResponse,
    ): Promise<void> {
        const ownState = localStates.get(ownMemberId);
        const refreshAllReceivers = !ownState?.is_own_key || !status.own_sender_key_exists;
        const pendingReceivers = new Set(status.pending_receivers ?? []);

        for (const member of roomMembers) {
            if (member.member_id === ownMemberId || member.user_id === undefined) continue;
            if (!refreshAllReceivers && !pendingReceivers.has(member.member_id)) continue;

            try {
                await this.uploadOwnSenderKey(roomId, member.user_id, ownMemberId, member.member_id);
                logger.info(`Sender key uploaded for room ${roomId} to member ${member.member_id}`);
            } catch (err) {
                logger.warn(`Failed to upload sender key for room ${roomId} to member ${member.member_id}`, err);
            }
        }
    }

    private async requestMissingPeerSenderKeys(
        roomId: number,
        ownMemberId: number,
        roomMembers: RoomMember[],
        localStates: SenderKeyStateMap,
        status: GetSenderKeyDistributionStatusResponse,
    ): Promise<void> {
        const pendingFromMembers = new Set(status.pending_from_members ?? []);
        const availableFromMembers = new Set(status.available_from_member_ids ?? []);

        for (const member of roomMembers) {
            if (member.member_id === ownMemberId) continue;

            const localState = localStates.get(member.member_id);
            const hasLocalPeerKey = localState !== undefined && !localState.is_own_key;
            if (hasLocalPeerKey && !pendingFromMembers.has(member.member_id)) {
                this.clearSenderKeyRequest(roomId, member.member_id);
                continue;
            }

            if (availableFromMembers.has(member.member_id) || !pendingFromMembers.has(member.member_id)) {
                continue;
            }

            try {
                await this.createSenderKeyRequestOnce(roomId, member.member_id);
            } catch (err) {
                logger.warn(`Failed to create sender key request for room ${roomId} and member ${member.member_id}`, err);
            }
        }
    }

    async reconcileRoomSenderKeys(
        input: RoomSenderKeyReconciliationInput,
    ): Promise<RoomSenderKeyReconciliationResult> {
        const accountId = this.getCurrentAccountId();
        const currentMemberId = this.resolveCurrentMemberIdFromMembers(
            input.roomId,
            input.roomMembers,
            input.currentMemberId,
        );
        const memberIds = input.roomMembers.map((member) => member.member_id);

        const localStatesBefore = await this.getSenderKeyStateMap(accountId, memberIds);
        const initialStatus = await e2eeApi.getSenderKeyDistributionStatus(input.roomId);
        await this.provideOwnSenderKeyIfNeeded(
            input.roomId,
            currentMemberId,
            input.roomMembers,
            localStatesBefore,
            initialStatus,
        );

        const pending = await e2eeApi.getPendingSenderKeyDistributions(input.roomId);
        await this.resolveMemberSenderKeys(input.roomId, pending);

        const status = await e2eeApi.getSenderKeyDistributionStatus(input.roomId);
        const localStates = await this.getSenderKeyStateMap(accountId, memberIds);
        await this.requestMissingPeerSenderKeys(
            input.roomId,
            currentMemberId,
            input.roomMembers,
            localStates,
            status,
        );

        return {
            currentMemberId,
            status,
            localStates,
        };
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
    async performDirectKeyExchange(
        roomId: number,
        inviterUserId: number,
        memberId?: number,
        receiverMemberId?: number,
    ): Promise<void> {
        const myMemberId = this.resolveCurrentMemberId(roomId, memberId);
        const resolvedReceiverMemberId = this.resolvePeerMemberId(roomId, inviterUserId, receiverMemberId);

        await this.uploadOwnSenderKey(roomId, inviterUserId, myMemberId, resolvedReceiverMemberId);

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
    //      When decryption fails due to missing/stale key and roomId is provided,
    //      automatically fires a sender key request (debounced per room+member).
    // [中] decryptMessage：將 "e2ee:v1:{base64}" 格式的訊息解密回明文；若非 e2ee 格式則原樣返回。
    //      當因缺少/過期 key 解密失敗且有提供 roomId 時，自動發出 sender key 請求（依 room+member 防抖）。
    async decryptMessage(content: string, senderMemberId: number, roomId?: number): Promise<string> {
        const PREFIX = 'e2ee:v1:';
        if (!content.startsWith(PREFIX)) return content;
        const accountId = this.getCurrentAccountId();
        try {
            const combined = Uint8Array.from(atob(content.slice(PREFIX.length)), c => c.charCodeAt(0));
            const nonce = Array.from(combined.slice(0, 12));
            const ciphertext = Array.from(combined.slice(12));
            const result = await decryptWithSenderKey(accountId, senderMemberId, ciphertext, nonce);
            if (result.status === 'ok' && result.plaintext) {
                return new TextDecoder().decode(new Uint8Array(result.plaintext));
            }
            if (result.status === 'missing_key' || result.status === 'stale_key') {
                this.requestSenderKeyOnDecryptFail(roomId, senderMemberId);
                return WAITING_FOR_SENDER_KEY;
            }
            return content;
        } catch (err) {
            logger.warn(`Failed to decrypt message from member ${senderMemberId}`, err);
            const keyExists = await hasSenderKey(accountId, senderMemberId).catch(() => false);
            if (!keyExists) {
                this.requestSenderKeyOnDecryptFail(roomId, senderMemberId);
                return WAITING_FOR_SENDER_KEY;
            }
            return content;
        }
    }

    private requestSenderKeyOnDecryptFail(roomId: number | undefined, senderMemberId: number): void {
        if (roomId === undefined) return;
        const key = `${roomId}:${senderMemberId}`;
        const now = Date.now();
        const lastRequested = this._decryptRequestDebounce.get(key);
        if (lastRequested !== undefined && now - lastRequested < DECRYPT_REQUEST_DEBOUNCE_MS) return;
        this._decryptRequestDebounce.set(key, now);
        this.createSenderKeyRequestOnce(roomId, senderMemberId).catch(() => {});
    }

    // Called when the inviter receives e2ee.sender_key_needed.
    // Encrypts own sender key using the requester's (invitee's) X3DH public key bundle and uploads it.
    async performInviterKeyExchange(
        roomId: number,
        requesterUserId: number,
        memberId?: number,
        requesterMemberId?: number,
    ): Promise<boolean> {
        const accountId = this.getCurrentAccountId();
        const myMemberId = this.resolveCurrentMemberId(roomId, memberId);
        const receiverMemberId = this.resolvePeerMemberId(roomId, requesterUserId, requesterMemberId);
        const [status, localStates] = await Promise.all([
            e2eeApi.getSenderKeyDistributionStatus(roomId).catch(() => null),
            this.getSenderKeyStateMap(accountId, [myMemberId]).catch(() => new Map<number, SenderKeyState>()),
        ]);
        const ownState = localStates.get(myMemberId);
        const shouldUpload = !ownState?.is_own_key
            || !status?.own_sender_key_exists
            || (status.pending_receivers ?? []).includes(receiverMemberId);

        if (!shouldUpload) {
            logger.info(`Sender key upload skipped for room ${roomId}: receiver ${receiverMemberId} already has the latest distribution`);
            return false;
        }

        await this.uploadOwnSenderKey(roomId, requesterUserId, myMemberId, receiverMemberId);

        logger.info(`Inviter key exchange completed for room ${roomId}`);
        return true;
    }

    // [EN] checkAndRequestReverseKey: after providing our key to a requester, check if we also need
    //      their key. If missing locally, try consuming pending distributions first; if still missing,
    //      create a sender key request.
    // [中] checkAndRequestReverseKey：提供我方 key 給請求者後，反向確認是否也缺對方 key。
    //      若本地沒有，先嘗試消化已有 distribution；若仍缺少則建立 sender key 請求。
    async checkAndRequestReverseKey(roomId: number, targetMemberId: number): Promise<void> {
        const accountId = this.getCurrentAccountId();
        let localStates = await this.getSenderKeyStateMap(accountId, [targetMemberId]).catch(() => new Map<number, SenderKeyState>());
        if (localStates.get(targetMemberId)?.is_own_key === false) {
            this.clearSenderKeyRequest(roomId, targetMemberId);
            return;
        }

        // Try consuming any pending distributions that may already be available.
        await this.resolveMemberSenderKeys(roomId).catch(() => {});
        localStates = await this.getSenderKeyStateMap(accountId, [targetMemberId]).catch(() => new Map<number, SenderKeyState>());
        if (localStates.get(targetMemberId)?.is_own_key === false) {
            this.clearSenderKeyRequest(roomId, targetMemberId);
            return;
        }

        const status = await e2eeApi.getSenderKeyDistributionStatus(roomId).catch(() => null);
        if (status && (status.available_from_member_ids ?? []).includes(targetMemberId)) {
            return;
        }

        if (!status || (status.pending_from_members ?? []).includes(targetMemberId)) {
            await this.createSenderKeyRequestOnce(roomId, targetMemberId).catch(() => {});
        }
    }

    // [EN] resolveMemberSenderKeys: fetches pending distributions for the room, consumes each one in Rust,
    //      and then reports the resulting consumed/failed status back to the backend.
    // [中] resolveMemberSenderKeys：取得房間內待消化的 distribution，由 Rust 完成 consume，
    //      再回報 consumed/failed 給後端。
    async resolveMemberSenderKeys(
        roomId: number,
        pendingResponse?: GetPendingSenderKeyDistributionsResponse,
    ): Promise<void> {
        const accountId = this.getCurrentAccountId();
        const pending = pendingResponse ?? await e2eeApi.getPendingSenderKeyDistributions(roomId);
        for (const item of pending.distributions) {
            try {
                const distBytes = Array.from(Uint8Array.from(atob(item.distribution_message), c => c.charCodeAt(0)));
                const result = await consumeSenderKeyDistribution(
                    accountId,
                    item.sender_member_id,
                    distBytes,
                    item.sender_key_version,
                );
                if (result.status === 'stale') {
                    logger.info(`Sender key distribution ${item.distribution_id} is stale (local key is newer), marking consumed`);
                }
                const status = result.status === 'failed' ? 'failed' : 'consumed';
                await e2eeApi.consumeSenderKeyDistribution(item.distribution_id, status);
                if (status === 'consumed') {
                    this.clearSenderKeyRequest(roomId, item.sender_member_id);
                }
            } catch (err) {
                logger.warn(`Failed to resolve sender key distribution ${item.distribution_id}`, err);
                await e2eeApi.consumeSenderKeyDistribution(item.distribution_id, 'failed').catch(() => {});
            }
        }
    }

    async resolveDirectKey(
        roomId: number,
        options?: { roomMembers?: RoomMember[]; currentMemberId?: number },
    ): Promise<boolean> {
        await this.resolveMemberSenderKeys(roomId).catch(err =>
            logger.warn(`Failed to consume pending sender key distributions for room ${roomId}`, err)
        );
        const status = await e2eeApi.getSenderKeyDistributionStatus(roomId);
        if (!status || !Array.isArray(status.pending_from_members)) {
            logger.warn(`Invalid sender key distribution status for room ${roomId}`, status);
            return false;
        }

        let myMemberId: number;
        try {
            myMemberId = options?.roomMembers
                ? this.resolveCurrentMemberIdFromMembers(roomId, options.roomMembers, options.currentMemberId)
                : this.resolveCurrentMemberId(roomId, options?.currentMemberId);
        } catch (err) {
            logger.warn(`Cannot resolve local sender key state for room ${roomId}`, err);
            return false;
        }

        const accountId = this.getCurrentAccountId();
        const localStates = options?.roomMembers
            ? await this.getSenderKeyStateMap(
                accountId,
                options.roomMembers.map((member) => member.member_id),
            ).catch(() => new Map<number, SenderKeyState>())
            : await this.getSenderKeyStateMap(accountId, [myMemberId]).catch(() => new Map<number, SenderKeyState>());

        return this.isDirectRoomReadyFromState(status, localStates, {
            roomMembers: options?.roomMembers,
            currentMemberId: myMemberId,
        });
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
