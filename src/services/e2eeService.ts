import { e2eeApi } from '@/api/index.ts';
import { useE2eeStore } from '@/stores/e2eeStore.ts';
import { logger } from '@/utils/logger.ts';
import {
    getE2eeFlag,
    setE2eeFlag,
    generateIdentityKeys,
    generateSignedPreKey,
    generateOneTimePreKeys,
    performX3dhSend,
    performX3dhReceive,
} from '@/bridge/e2ee.ts';
import type {
    PublicKeyBundle,
    InitialMessage,
} from '@/types/e2ee.ts';

const INITIAL_SPK_KEY_ID = 1;
const INITIAL_OTP_KEY_IDS = Array.from({ length: 20 }, (_, i) => i + 1);
const OTP_REPLENISH_BATCH = 20;

// Rust returns [u8;32] / [u8;64] as number[] in JSON.
// Server expects base64.StdEncoding (standard, not URL-safe, with padding).
const toBase64 = (bytes: number[]): string =>
    btoa(String.fromCharCode(...bytes));

const fromBase64 = (b64: string): number[] =>
    Array.from(atob(b64), c => c.charCodeAt(0));

class E2eeService {
    async ensureInitialized(deviceId: string): Promise<void> {
        const alreadyInitialized = await getE2eeFlag(deviceId);
        logger.info(`E2EE already initialized: ${alreadyInitialized}`);

        if (!alreadyInitialized) {
            const identityKeys = await generateIdentityKeys();
            logger.info('Generated E2EE keys:', identityKeys);
            await e2eeApi.uploadIdentityKey(
                deviceId,
                toBase64(identityKeys.identity_key_dh_pub),
                toBase64(identityKeys.identity_key_sign_pub),
            );

            const spk = await generateSignedPreKey(INITIAL_SPK_KEY_ID);
            logger.info('Generated SPK:', spk);
            await e2eeApi.uploadSignedPreKey(deviceId, spk.key_id, toBase64(spk.public_key), toBase64(spk.signature));

            const otpKeys = await generateOneTimePreKeys(INITIAL_OTP_KEY_IDS);
            logger.info('Generated OTP keys:', otpKeys.length);
            await e2eeApi.uploadOTPPreKeys(deviceId, otpKeys.map(k => ({
                key_id: k.key_id,
                public_key: toBase64(k.public_key)
            })));

            await setE2eeFlag(deviceId, true);

            const e2eeState = useE2eeStore.getState();
            e2eeState.setKeysUploaded(true);
            e2eeState.setOtpKeyCount(otpKeys.length);

            logger.info('E2EE keys initialized and uploaded');
        }

        await this.replenishOTPKeys(deviceId, 10);
    }

    async replenishOTPKeys(deviceId: string, threshold = 20): Promise<void> {
        const { count } = await e2eeApi.countOTPPreKeys(deviceId);
        const store = useE2eeStore.getState();
        store.setOtpKeyCount(count);

        if (count >= threshold) return;

        const startId = Date.now();
        const keyIds = Array.from({ length: OTP_REPLENISH_BATCH }, (_, i) => startId + i);
        const otpKeys = await generateOneTimePreKeys(keyIds);
        await e2eeApi.uploadOTPPreKeys(deviceId, otpKeys.map(k => ({
            key_id: k.key_id,
            public_key: toBase64(k.public_key)
        })));
        store.setOtpKeyCount(count + otpKeys.length);

        logger.info(`Replenished ${otpKeys.length} OTP keys`);
    }

    async performSend(
        targetUserId: number,
        targetDeviceId: string,
        plaintext: string,
    ): Promise<InitialMessage> {
        const bundle = await e2eeApi.getKeyBundle(targetUserId, targetDeviceId);

        const keyBundle: PublicKeyBundle = {
            identity_key_dh:   fromBase64(bundle.identity_key),
            identity_key_sign: fromBase64(bundle.identity_key_sign),
            signed_pre_key:    fromBase64(bundle.signed_pre_key),
            spk_signature:     fromBase64(bundle.spk_signature),
            spk_key_id:        bundle.spk_key_id,
            one_time_pre_key:  bundle.otp_pre_key ? fromBase64(bundle.otp_pre_key) : undefined,
            otpk_key_id:       bundle.otp_pre_key_id,
        };

        return performX3dhSend(keyBundle, Array.from(new TextEncoder().encode(plaintext)));
    }

    async performReceive(
        msg: InitialMessage,
        spkKeyId: number,
        otpkKeyId?: number,
    ): Promise<string> {
        const plaintextBytes = await performX3dhReceive(msg, spkKeyId, otpkKeyId);

        return new TextDecoder().decode(new Uint8Array(plaintextBytes));
    }
}

export const e2eeService = new E2eeService();
