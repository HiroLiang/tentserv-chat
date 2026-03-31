import { invoke } from '@tauri-apps/api/core';
import type {
    GenerateIdentityKeysResult,
    GenerateSignedPreKeyResult,
    OneTimePreKey,
    SenderKeyBundle,
    PublicKeyBundle,
    InitialMessage,
} from '@/types/e2ee.ts';

export const hasIdentityKeys = (): Promise<boolean> =>
    invoke<boolean>('has_identity_keys');

export const generateIdentityKeys = (): Promise<GenerateIdentityKeysResult> =>
    invoke<GenerateIdentityKeysResult>('generate_identity_keys');

export const generateSignedPreKey = (keyId: number): Promise<GenerateSignedPreKeyResult> =>
    invoke<GenerateSignedPreKeyResult>('generate_signed_pre_key', { keyId });

export const replenishOtpKeys = (number: number): Promise<OneTimePreKey[]> =>
    invoke<OneTimePreKey[]>("replenish_otp_keys", { count: number, });

export const performX3dhSend = (bundle: PublicKeyBundle, plaintext: number[]): Promise<InitialMessage> =>
    invoke<InitialMessage>('perform_x3dh_send', { bundle, plaintext });

export const performX3dhReceive = (msg: InitialMessage, spkKeyId: number, otpkKeyId?: number): Promise<number[]> =>
    invoke<number[]>('perform_x3dh_receive', {
        msg,
        spk_key_id: spkKeyId,
        ...(otpkKeyId !== undefined && { otpk_key_id: otpkKeyId }),
    });

export const generateSenderKey = (roomId: number): Promise<SenderKeyBundle> =>
    invoke<SenderKeyBundle>('generate_sender_key', { room_id: roomId });

