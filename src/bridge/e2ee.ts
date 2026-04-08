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

export const hasIdentityKeys = (userId: BridgeId): Promise<boolean> =>
    invoke<boolean>('has_identity_keys', { userId: toBridgeId(userId) });

export const generateIdentityKeys = (userId: BridgeId): Promise<GenerateIdentityKeysResult> =>
    invoke<GenerateIdentityKeysResult>('generate_identity_keys', { userId: toBridgeId(userId) });

export const getIdentityKeys = (userId: BridgeId): Promise<GenerateIdentityKeysResult> =>
    invoke<GenerateIdentityKeysResult>('get_identity_keys', { userId: toBridgeId(userId) });

export const validateE2eeKeyMaterial = (userId: BridgeId, spkKeyId: number): Promise<boolean> =>
    invoke<boolean>('validate_e2ee_key_material', { userId: toBridgeId(userId), spkKeyId });

export const generateSignedPreKey = (userId: BridgeId, keyId: number): Promise<GenerateSignedPreKeyResult> =>
    invoke<GenerateSignedPreKeyResult>('generate_signed_pre_key', { userId: toBridgeId(userId), keyId });

export const getSignedPreKey = (userId: BridgeId, keyId: number): Promise<GenerateSignedPreKeyResult> =>
    invoke<GenerateSignedPreKeyResult>('get_signed_pre_key', { userId: toBridgeId(userId), keyId });

export const replenishOtpKeys = (userId: BridgeId, count: number): Promise<OneTimePreKey[]> =>
    invoke<OneTimePreKey[]>('replenish_otp_keys', { userId: toBridgeId(userId), count });

export const performX3dhSend = (
    userId: BridgeId,
    bundle: PublicKeyBundle,
    plaintext: number[],
): Promise<InitialMessage> =>
    invoke<InitialMessage>('perform_x3dh_send', { userId: toBridgeId(userId), bundle, plaintext });

export const performX3dhReceive = (
    userId: BridgeId,
    msg: InitialMessage,
    spkKeyId: number,
    otpkKeyId?: number,
): Promise<number[]> =>
    invoke<number[]>('perform_x3dh_receive', {
        userId: toBridgeId(userId),
        msg,
        spkKeyId,
        ...(otpkKeyId !== undefined && { otpkKeyId }),
    });

// sender keys are keyed by (user_id, member_id) where member_id = chat_members.id.
// room_id is not needed because chat_members.id is a globally unique sequence PK.

export const generateSenderKey = (
    userId: BridgeId,
    memberId: BridgeId,
): Promise<SenderKeyBundle> =>
    invoke<SenderKeyBundle>('generate_sender_key', {
        userId: toBridgeId(userId),
        memberId: toBridgeId(memberId),
    });

export const hasSenderKey = (
    userId: BridgeId,
    memberId: BridgeId,
): Promise<boolean> =>
    invoke<boolean>('has_sender_key', {
        userId: toBridgeId(userId),
        memberId: toBridgeId(memberId),
    });

export const storeMemberSenderKey = (
    userId: BridgeId,
    memberId: BridgeId,
    keyBytes: number[],
): Promise<void> =>
    invoke('store_member_sender_key', {
        userId: toBridgeId(userId),
        memberId: toBridgeId(memberId),
        keyBytes,
    });

export const encryptWithSenderKey = (
    userId: BridgeId,
    memberId: BridgeId,
    plaintext: number[],
): Promise<SenderKeyEncryptedMessage> =>
    invoke<SenderKeyEncryptedMessage>('encrypt_with_sender_key', {
        userId: toBridgeId(userId),
        memberId: toBridgeId(memberId),
        plaintext,
    });

export const decryptWithSenderKey = (
    userId: BridgeId,
    memberId: BridgeId,
    ciphertext: number[],
    nonce: number[],
): Promise<number[]> =>
    invoke<number[]>('decrypt_with_sender_key', {
        userId: toBridgeId(userId),
        memberId: toBridgeId(memberId),
        ciphertext,
        nonce,
    });

export const clearE2eeKeys = (userId: BridgeId): Promise<void> =>
    invoke('clear_e2ee_keys', { userId: toBridgeId(userId) });
