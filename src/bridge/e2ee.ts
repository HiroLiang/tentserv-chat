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

export const hasIdentityKeys = (userId: number): Promise<boolean> =>
    invoke<boolean>('has_identity_keys', { userId });

export const generateIdentityKeys = (userId: number): Promise<GenerateIdentityKeysResult> =>
    invoke<GenerateIdentityKeysResult>('generate_identity_keys', { userId });

export const generateSignedPreKey = (userId: number, keyId: number): Promise<GenerateSignedPreKeyResult> =>
    invoke<GenerateSignedPreKeyResult>('generate_signed_pre_key', { userId, keyId });

export const replenishOtpKeys = (userId: number, number: number): Promise<OneTimePreKey[]> =>
    invoke<OneTimePreKey[]>('replenish_otp_keys', { userId, count: number });

export const performX3dhSend = (userId: number, bundle: PublicKeyBundle, plaintext: number[]): Promise<InitialMessage> =>
    invoke<InitialMessage>('perform_x3dh_send', { userId, bundle, plaintext });

export const performX3dhReceive = (userId: number, msg: InitialMessage, spkKeyId: number, otpkKeyId?: number): Promise<number[]> =>
    invoke<number[]>('perform_x3dh_receive', {
        userId,
        msg,
        spkKeyId,
        ...(otpkKeyId !== undefined && { otpkKeyId }),
    });

export const generateSenderKey = (userId: number, roomId: number): Promise<SenderKeyBundle> =>
    invoke<SenderKeyBundle>('generate_sender_key', { userId, roomId });

export const hasSenderKey = (userId: number, roomId: number): Promise<boolean> =>
    invoke<boolean>('has_sender_key', { userId, roomId });

export const encryptWithSenderKey = (
    userId: number,
    roomId: number,
    plaintext: number[],
): Promise<SenderKeyEncryptedMessage> =>
    invoke<SenderKeyEncryptedMessage>('encrypt_with_sender_key', {
        userId,
        roomId,
        plaintext,
    });
