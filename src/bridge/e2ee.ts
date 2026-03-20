import { invoke } from '@tauri-apps/api/core';
import type {
    GenerateIdentityKeysResult,
    GenerateSignedPreKeyResult,
    OneTimePreKeyResult,
    PublicKeyBundle,
    InitialMessage,
} from '@/types/e2ee.ts';

export const getE2eeFlag = (deviceId: string): Promise<boolean> =>
    invoke<boolean>('get_e2ee_flag', { deviceId });

export const setE2eeFlag = (deviceId: string, value: boolean): Promise<void> =>
    invoke('set_e2ee_flag', { deviceId, value });

export const generateIdentityKeys = (): Promise<GenerateIdentityKeysResult> =>
    invoke<GenerateIdentityKeysResult>('generate_identity_keys');

export const generateSignedPreKey = (keyId: number): Promise<GenerateSignedPreKeyResult> =>
    invoke<GenerateSignedPreKeyResult>('generate_signed_pre_key', { keyId });

export const generateOneTimePreKeys = (keyIds: number[]): Promise<OneTimePreKeyResult[]> =>
    invoke<OneTimePreKeyResult[]>('generate_one_time_pre_keys', { keyIds });

export const performX3dhSend = (bundle: PublicKeyBundle, plaintext: number[]): Promise<InitialMessage> =>
    invoke<InitialMessage>('perform_x3dh_send', { bundle, plaintext });

export const performX3dhReceive = (msg: InitialMessage, spkKeyId: number, otpkKeyId?: number): Promise<number[]> =>
    invoke<number[]>('perform_x3dh_receive', {
        msg,
        spk_key_id: spkKeyId,
        ...(otpkKeyId !== undefined && { otpk_key_id: otpkKeyId }),
    });
