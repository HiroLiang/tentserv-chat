import { invoke } from '@tauri-apps/api/core';
import type {
    GenerateIdentityKeysResult,
    GenerateSignedPreKeyResult,
    OneTimePreKey,
    SenderKeyBundle,
    SenderKeyEncryptedMessage,
    SenderKeyState,
    PublicKeyBundle,
    InitialMessage,
    PreparedSenderKeyDistribution,
    ConsumeSenderKeyDistributionResult,
    DecryptSenderKeyResult,
} from '@/types/e2ee.ts';

type BridgeId = string | number;

const toBridgeId = (value: BridgeId): string => String(value);

export const hasIdentityKeys = (accountId: BridgeId): Promise<boolean> =>
    invoke<boolean>('has_identity_keys', { accountId: toBridgeId(accountId) });

export const generateIdentityKeys = (accountId: BridgeId): Promise<GenerateIdentityKeysResult> =>
    invoke<GenerateIdentityKeysResult>('generate_identity_keys', { accountId: toBridgeId(accountId) });

export const getIdentityKeys = (accountId: BridgeId): Promise<GenerateIdentityKeysResult> =>
    invoke<GenerateIdentityKeysResult>('get_identity_keys', { accountId: toBridgeId(accountId) });

export const validateE2eeKeyMaterial = (accountId: BridgeId, spkKeyId: number): Promise<boolean> =>
    invoke<boolean>('validate_e2ee_key_material', { accountId: toBridgeId(accountId), spkKeyId });

export const validateIdentityKeys = (accountId: BridgeId): Promise<boolean> =>
    invoke<boolean>('validate_identity_keys', { accountId: toBridgeId(accountId) });

export const validateSignedPreKey = (accountId: BridgeId, keyId: number): Promise<boolean> =>
    invoke<boolean>('validate_signed_pre_key', { accountId: toBridgeId(accountId), keyId });

export const generateSignedPreKey = (accountId: BridgeId, keyId: number): Promise<GenerateSignedPreKeyResult> =>
    invoke<GenerateSignedPreKeyResult>('generate_signed_pre_key', { accountId: toBridgeId(accountId), keyId });

export const getSignedPreKey = (accountId: BridgeId, keyId: number): Promise<GenerateSignedPreKeyResult> =>
    invoke<GenerateSignedPreKeyResult>('get_signed_pre_key', { accountId: toBridgeId(accountId), keyId });

export const replenishOtpKeys = (accountId: BridgeId, count: number): Promise<OneTimePreKey[]> =>
    invoke<OneTimePreKey[]>('replenish_otp_keys', { accountId: toBridgeId(accountId), count });

export const performX3dhSend = (
    accountId: BridgeId,
    bundle: PublicKeyBundle,
    plaintext: number[],
): Promise<InitialMessage> =>
    invoke<InitialMessage>('perform_x3dh_send', { accountId: toBridgeId(accountId), bundle, plaintext });

export const performX3dhReceive = (
    accountId: BridgeId,
    msg: InitialMessage,
    spkKeyId: number,
    otpkKeyId?: number,
): Promise<number[]> =>
    invoke<number[]>('perform_x3dh_receive', {
        accountId: toBridgeId(accountId),
        msg,
        spkKeyId,
        ...(otpkKeyId !== undefined && { otpkKeyId }),
    });

// sender keys are keyed by (local account_id, member_id) where member_id = chat_members.id.
// room_id is not needed because chat_members.id is a globally unique sequence PK.
// Device-scoped sender keys additionally require the concrete sender `device_id`.

export const generateSenderKey = (
    accountId: BridgeId,
    memberId: BridgeId,
    deviceId: string,
): Promise<SenderKeyBundle> =>
    invoke<SenderKeyBundle>('generate_sender_key', {
        accountId: toBridgeId(accountId),
        memberId: toBridgeId(memberId),
        deviceId,
    });

export const hasSenderKey = (
    accountId: BridgeId,
    memberId: BridgeId,
    deviceId: string,
): Promise<boolean> =>
    invoke<boolean>('has_sender_key', {
        accountId: toBridgeId(accountId),
        memberId: toBridgeId(memberId),
        deviceId,
    });

export const storeMemberSenderKey = (
    accountId: BridgeId,
    memberId: BridgeId,
    deviceId: string,
    keyBytes: number[],
): Promise<void> =>
    invoke('store_member_sender_key', {
        accountId: toBridgeId(accountId),
        memberId: toBridgeId(memberId),
        deviceId,
        keyBytes,
    });

export const getSenderKeyStates = (
    accountId: BridgeId,
    memberIds: BridgeId[],
): Promise<SenderKeyState[]> =>
    invoke<SenderKeyState[]>('get_sender_key_states', {
        accountId: toBridgeId(accountId),
        memberIds: memberIds.map(toBridgeId),
    });

export const deleteSenderKeys = (
    accountId: BridgeId,
    memberIds: BridgeId[],
): Promise<void> =>
    invoke('delete_sender_keys', {
        accountId: toBridgeId(accountId),
        memberIds: memberIds.map(toBridgeId),
    });

export const prepareSenderKeyDistribution = (
    accountId: BridgeId,
    ownMemberId: BridgeId,
    ownDeviceId: string,
    requesterBundle: PublicKeyBundle,
): Promise<PreparedSenderKeyDistribution> =>
    invoke<PreparedSenderKeyDistribution>('prepare_sender_key_distribution', {
        accountId: toBridgeId(accountId),
        ownMemberId: toBridgeId(ownMemberId),
        ownDeviceId,
        requesterBundle,
    });

export const consumeSenderKeyDistribution = (
    accountId: BridgeId,
    senderMemberId: BridgeId,
    senderDeviceId: string,
    receiverMemberId: BridgeId | undefined,
    receiverDeviceId: string | undefined,
    distributionMessage: number[],
    senderKeyVersion: number,
): Promise<ConsumeSenderKeyDistributionResult> =>
    invoke<ConsumeSenderKeyDistributionResult>('consume_sender_key_distribution', {
        accountId: toBridgeId(accountId),
        senderMemberId: toBridgeId(senderMemberId),
        senderDeviceId,
        ...(receiverMemberId !== undefined && { receiverMemberId: toBridgeId(receiverMemberId) }),
        ...(receiverDeviceId !== undefined && { receiverDeviceId }),
        distributionMessage,
        senderKeyVersion,
    });

export const encryptWithSenderKey = (
    accountId: BridgeId,
    memberId: BridgeId,
    deviceId: string,
    plaintext: number[],
): Promise<SenderKeyEncryptedMessage> =>
    invoke<SenderKeyEncryptedMessage>('encrypt_with_sender_key', {
        accountId: toBridgeId(accountId),
        memberId: toBridgeId(memberId),
        deviceId,
        plaintext,
    });

export const decryptWithSenderKey = (
    accountId: BridgeId,
    memberId: BridgeId,
    deviceId: string,
    senderKeyVersion: number,
    ciphertext: number[],
    nonce: number[],
): Promise<DecryptSenderKeyResult> =>
    invoke<DecryptSenderKeyResult>('decrypt_with_sender_key', {
        accountId: toBridgeId(accountId),
        memberId: toBridgeId(memberId),
        deviceId,
        senderKeyVersion,
        ciphertext,
        nonce,
    });

export const clearE2eeKeys = (accountId: BridgeId): Promise<void> =>
    invoke('clear_e2ee_keys', { accountId: toBridgeId(accountId) });

export type LocalBootstrapResult = {
    identity_keys: GenerateIdentityKeysResult;
    spk: GenerateSignedPreKeyResult;
    identity_regenerated: boolean;
    spk_regenerated: boolean;
};

export const bootstrapLocalE2eeKeys = (
    accountId: BridgeId,
    spkKeyId: number,
): Promise<LocalBootstrapResult> =>
    invoke<LocalBootstrapResult>('bootstrap_local_e2ee_keys', {
        accountId: toBridgeId(accountId),
        spkKeyId,
    });
