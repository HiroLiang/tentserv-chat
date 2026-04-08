import { invoke } from '@tauri-apps/api/core';
import type {
    GenerateIdentityKeysResult,
    GenerateSignedPreKeyResult,
    OneTimePreKey,
    SenderKeyBundle,
    SenderKeyEncryptedMessage,
    PublicKeyBundle,
    InitialMessage,
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

export const generateSenderKey = (
    accountId: BridgeId,
    memberId: BridgeId,
): Promise<SenderKeyBundle> =>
    invoke<SenderKeyBundle>('generate_sender_key', {
        accountId: toBridgeId(accountId),
        memberId: toBridgeId(memberId),
    });

export const hasSenderKey = (
    accountId: BridgeId,
    memberId: BridgeId,
): Promise<boolean> =>
    invoke<boolean>('has_sender_key', {
        accountId: toBridgeId(accountId),
        memberId: toBridgeId(memberId),
    });

export const storeMemberSenderKey = (
    accountId: BridgeId,
    memberId: BridgeId,
    keyBytes: number[],
): Promise<void> =>
    invoke('store_member_sender_key', {
        accountId: toBridgeId(accountId),
        memberId: toBridgeId(memberId),
        keyBytes,
    });

export const encryptWithSenderKey = (
    accountId: BridgeId,
    memberId: BridgeId,
    plaintext: number[],
): Promise<SenderKeyEncryptedMessage> =>
    invoke<SenderKeyEncryptedMessage>('encrypt_with_sender_key', {
        accountId: toBridgeId(accountId),
        memberId: toBridgeId(memberId),
        plaintext,
    });

export const decryptWithSenderKey = (
    accountId: BridgeId,
    memberId: BridgeId,
    ciphertext: number[],
    nonce: number[],
): Promise<number[]> =>
    invoke<number[]>('decrypt_with_sender_key', {
        accountId: toBridgeId(accountId),
        memberId: toBridgeId(memberId),
        ciphertext,
        nonce,
    });

export const clearE2eeKeys = (accountId: BridgeId): Promise<void> =>
    invoke('clear_e2ee_keys', { accountId: toBridgeId(accountId) });
