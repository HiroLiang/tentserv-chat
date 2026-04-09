import { beforeEach, describe, expect, it, vi } from "vitest";
import { e2eeApi } from "@/api/index.ts";
import {
    generateIdentityKeys,
    generateSignedPreKey,
    getIdentityKeys,
    getSignedPreKey,
    hasIdentityKeys,
    performX3dhSend,
    replenishOtpKeys,
    validateIdentityKeys,
    validateSignedPreKey,
} from "@/bridge/e2ee.ts";
import { useE2eeStore } from "@/stores/e2eeStore.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { e2eeService } from "./e2eeService.ts";

vi.mock("@/api/index.ts", () => ({
    e2eeApi: {
        getKeyPolicy: vi.fn(),
        checkKeyStatus: vi.fn(),
        uploadIdentityKey: vi.fn(),
        uploadSignedPreKey: vi.fn(),
        uploadOTPPreKeys: vi.fn(),
        countOTPPreKeys: vi.fn(),
        getKeyBundle: vi.fn(),
    },
}));

vi.mock("@/bridge/e2ee.ts", () => ({
    generateIdentityKeys: vi.fn(),
    getIdentityKeys: vi.fn(),
    generateSignedPreKey: vi.fn(),
    getSignedPreKey: vi.fn(),
    replenishOtpKeys: vi.fn(),
    performX3dhSend: vi.fn(),
    performX3dhReceive: vi.fn(),
    hasIdentityKeys: vi.fn(),
    validateIdentityKeys: vi.fn(),
    validateSignedPreKey: vi.fn(),
    validateE2eeKeyMaterial: vi.fn(),
    hasSenderKey: vi.fn(),
    generateSenderKey: vi.fn(),
    encryptWithSenderKey: vi.fn(),
    decryptWithSenderKey: vi.fn(),
    storeMemberSenderKey: vi.fn(),
    clearE2eeKeys: vi.fn(),
}));

vi.mock("@/utils/logger.ts", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

const deviceId = "device-1";
const bytes = (value: number, length: number): number[] => Array(length).fill(value);
const toBase64 = (input: number[]): string => btoa(String.fromCharCode(...input));

const identityKeys = {
    identity_key_dh_pub: bytes(1, 32),
    identity_key_sign_pub: bytes(2, 32),
};
const signedPreKey = {
    key_id: 1,
    public_key: bytes(3, 32),
    signature: bytes(4, 64),
};

const otpKeys = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
        key_id: index + 1,
        public_key: bytes(20 + index, 32),
    }));

const matchingStatus = (otpCount: number) => ({
    identity_key_exists: true,
    signed_pre_key_exists: true,
    identity_key: toBase64(identityKeys.identity_key_dh_pub),
    identity_key_sign: toBase64(identityKeys.identity_key_sign_pub),
    signed_pre_key: toBase64(signedPreKey.public_key),
    spk_signature: toBase64(signedPreKey.signature),
    spk_key_id: signedPreKey.key_id,
    otp_prekey_count: otpCount,
});

const emptyStatus = {
    identity_key_exists: false,
    signed_pre_key_exists: false,
    otp_prekey_count: 0,
};

const resetStores = () => {
    useUserStore.setState({
        currentUser: {
            id: 501,
            accountId: 42,
            name: "Hiro",
            isLoggedIn: true,
        },
        recordedUsers: new Map(),
        participantId: null,
    });
    useE2eeStore.setState({
        keysUploaded: false,
        otpKeyCount: 0,
        otpKeyTargetCount: 0,
        otpReplenishThreshold: 0,
        senderKeyRequests: new Set(),
    });
};

const resetMocks = () => {
    vi.mocked(e2eeApi.getKeyPolicy).mockResolvedValue({
        otp_prekey_target_count: 20,
        otp_prekey_replenish_threshold: 5,
    });
    vi.mocked(e2eeApi.checkKeyStatus).mockResolvedValue(emptyStatus);
    vi.mocked(e2eeApi.uploadIdentityKey).mockResolvedValue({ fingerprint: "fp" });
    vi.mocked(e2eeApi.uploadSignedPreKey).mockResolvedValue(undefined);
    vi.mocked(e2eeApi.uploadOTPPreKeys).mockImplementation(async (_deviceID, keys) => ({
        count: keys.length,
    }));
    vi.mocked(e2eeApi.countOTPPreKeys).mockResolvedValue({ count: 0 });
    vi.mocked(e2eeApi.getKeyBundle).mockResolvedValue({
        identity_key: toBase64(identityKeys.identity_key_dh_pub),
        identity_key_sign: toBase64(identityKeys.identity_key_sign_pub),
        signed_pre_key: toBase64(signedPreKey.public_key),
        spk_signature: toBase64(signedPreKey.signature),
        spk_key_id: signedPreKey.key_id,
    });
    vi.mocked(hasIdentityKeys).mockResolvedValue(false);
    vi.mocked(generateIdentityKeys).mockResolvedValue(identityKeys);
    vi.mocked(getIdentityKeys).mockResolvedValue(identityKeys);
    vi.mocked(generateSignedPreKey).mockResolvedValue(signedPreKey);
    vi.mocked(getSignedPreKey).mockResolvedValue(signedPreKey);
    vi.mocked(validateIdentityKeys).mockResolvedValue(true);
    vi.mocked(validateSignedPreKey).mockResolvedValue(true);
    vi.mocked(replenishOtpKeys).mockImplementation(async (_accountID, count) => otpKeys(count));
    vi.mocked(performX3dhSend).mockResolvedValue({
        identity_key_dh_pub: bytes(1, 32),
        identity_key_sign_pub: bytes(2, 32),
        ephemeral_key_pub: bytes(3, 32),
        spk_key_id: 1,
        ciphertext: bytes(4, 12),
        nonce: bytes(5, 12),
    });
};

describe("e2eeService.ensureInitialized", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStores();
        resetMocks();
    });

    it("generates local account-id keys and uploads missing remote keys", async () => {
        await e2eeService.ensureInitialized(deviceId);

        expect(hasIdentityKeys).toHaveBeenCalledWith(42);
        expect(generateIdentityKeys).toHaveBeenCalledWith(42);
        expect(generateSignedPreKey).toHaveBeenCalledWith(42, 1);
        expect(e2eeApi.checkKeyStatus).toHaveBeenCalledWith(501, deviceId);
        expect(e2eeApi.uploadIdentityKey).toHaveBeenCalledWith(
            deviceId,
            toBase64(identityKeys.identity_key_dh_pub),
            toBase64(identityKeys.identity_key_sign_pub),
        );
        expect(e2eeApi.uploadSignedPreKey).toHaveBeenCalledWith(
            deviceId,
            1,
            toBase64(signedPreKey.public_key),
            toBase64(signedPreKey.signature),
        );
        expect(replenishOtpKeys).toHaveBeenCalledWith(42, 20);
        expect(e2eeApi.uploadOTPPreKeys).toHaveBeenCalledWith(deviceId, expect.arrayContaining([
            expect.objectContaining({ key_id: 1 }),
        ]));
        expect(useE2eeStore.getState()).toMatchObject({
            keysUploaded: true,
            otpKeyCount: 20,
            otpKeyTargetCount: 20,
            otpReplenishThreshold: 5,
        });
    });

    it("does not re-upload matching identity and SPK, but tops OTP up to policy target", async () => {
        vi.mocked(hasIdentityKeys).mockResolvedValue(true);
        vi.mocked(e2eeApi.checkKeyStatus).mockResolvedValue(matchingStatus(12));
        vi.mocked(e2eeApi.uploadOTPPreKeys).mockResolvedValueOnce({ count: 20 });

        await e2eeService.ensureInitialized("device-match");

        expect(validateIdentityKeys).toHaveBeenCalledWith(42);
        expect(validateSignedPreKey).toHaveBeenCalledWith(42, 1);
        expect(getIdentityKeys).toHaveBeenCalledWith(42);
        expect(getSignedPreKey).toHaveBeenCalledWith(42, 1);
        expect(e2eeApi.uploadIdentityKey).not.toHaveBeenCalled();
        expect(e2eeApi.uploadSignedPreKey).not.toHaveBeenCalled();
        expect(replenishOtpKeys).toHaveBeenCalledWith(42, 8);
        expect(useE2eeStore.getState().otpKeyCount).toBe(20);
    });

    it("re-uploads identity and SPK when remote identity public material mismatches", async () => {
        vi.mocked(hasIdentityKeys).mockResolvedValue(true);
        vi.mocked(e2eeApi.checkKeyStatus).mockResolvedValue({
            ...matchingStatus(20),
            identity_key: toBase64(bytes(9, 32)),
        });

        await e2eeService.ensureInitialized("device-identity-mismatch");

        expect(e2eeApi.uploadIdentityKey).toHaveBeenCalledTimes(1);
        expect(e2eeApi.uploadSignedPreKey).toHaveBeenCalledTimes(1);
        expect(replenishOtpKeys).not.toHaveBeenCalled();
        expect(useE2eeStore.getState().otpKeyCount).toBe(20);
    });

    it("re-uploads only the SPK when remote SPK public material mismatches", async () => {
        vi.mocked(hasIdentityKeys).mockResolvedValue(true);
        vi.mocked(e2eeApi.checkKeyStatus).mockResolvedValue({
            ...matchingStatus(20),
            signed_pre_key: toBase64(bytes(9, 32)),
        });

        await e2eeService.ensureInitialized("device-spk-mismatch");

        expect(e2eeApi.uploadIdentityKey).not.toHaveBeenCalled();
        expect(e2eeApi.uploadSignedPreKey).toHaveBeenCalledTimes(1);
        expect(replenishOtpKeys).not.toHaveBeenCalled();
    });

    it("regenerates identity and SPK when local identity material is unusable", async () => {
        vi.mocked(hasIdentityKeys).mockResolvedValue(true);
        vi.mocked(validateIdentityKeys).mockResolvedValue(false);

        await e2eeService.ensureInitialized("device-corrupt-local");

        expect(generateIdentityKeys).toHaveBeenCalledWith(42);
        expect(generateSignedPreKey).toHaveBeenCalledWith(42, 1);
        expect(getSignedPreKey).not.toHaveBeenCalled();
    });

    it("regenerates only the SPK when local signed pre-key material is unusable", async () => {
        vi.mocked(hasIdentityKeys).mockResolvedValue(true);
        vi.mocked(e2eeApi.checkKeyStatus).mockResolvedValue(matchingStatus(20));
        vi.mocked(validateIdentityKeys).mockResolvedValue(true);
        vi.mocked(validateSignedPreKey).mockResolvedValue(false);

        await e2eeService.ensureInitialized("device-spk-invalid-local");

        expect(getIdentityKeys).toHaveBeenCalledWith(42);
        expect(generateIdentityKeys).not.toHaveBeenCalled();
        expect(validateSignedPreKey).toHaveBeenCalledWith(42, 1);
        expect(generateSignedPreKey).toHaveBeenCalledWith(42, 1);
        expect(e2eeApi.uploadIdentityKey).not.toHaveBeenCalled();
        expect(e2eeApi.uploadSignedPreKey).toHaveBeenCalledTimes(1);
    });

    it("uses the server policy target to decide OTP batch size", async () => {
        vi.mocked(e2eeApi.getKeyPolicy).mockResolvedValue({
            otp_prekey_target_count: 5,
            otp_prekey_replenish_threshold: 2,
        });
        vi.mocked(e2eeApi.checkKeyStatus).mockResolvedValue({ ...emptyStatus, otp_prekey_count: 2 });
        vi.mocked(e2eeApi.uploadOTPPreKeys).mockResolvedValueOnce({ count: 5 });

        await e2eeService.ensureInitialized("device-policy");

        expect(replenishOtpKeys).toHaveBeenCalledWith(42, 3);
        expect(useE2eeStore.getState()).toMatchObject({
            otpKeyTargetCount: 5,
            otpReplenishThreshold: 2,
            otpKeyCount: 5,
        });
    });

    it("guards concurrent initialization by account id and device id", async () => {
        vi.mocked(generateIdentityKeys).mockImplementation(async () => {
            await Promise.resolve();
            return identityKeys;
        });

        await Promise.all([
            e2eeService.ensureInitialized("device-guard"),
            e2eeService.ensureInitialized("device-guard"),
        ]);

        expect(e2eeApi.getKeyPolicy).toHaveBeenCalledTimes(1);
        expect(hasIdentityKeys).toHaveBeenCalledTimes(1);
        expect(generateIdentityKeys).toHaveBeenCalledTimes(1);
        expect(e2eeApi.uploadIdentityKey).toHaveBeenCalledTimes(1);
    });
});

describe("e2eeService.replenishOTPKeys", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStores();
        resetMocks();
        useE2eeStore.setState({
            otpKeyTargetCount: 20,
            otpReplenishThreshold: 5,
        });
    });

    it("tops up from server count to the configured target when below threshold", async () => {
        vi.mocked(e2eeApi.countOTPPreKeys).mockResolvedValue({ count: 3 });
        vi.mocked(e2eeApi.uploadOTPPreKeys).mockResolvedValueOnce({ count: 20 });

        await e2eeService.replenishOTPKeys(deviceId);

        expect(e2eeApi.countOTPPreKeys).toHaveBeenCalledWith(deviceId);
        expect(replenishOtpKeys).toHaveBeenCalledWith(42, 17);
        expect(e2eeApi.uploadOTPPreKeys).toHaveBeenCalledWith(deviceId, expect.arrayContaining([
            expect.objectContaining({ key_id: 1 }),
        ]));
        expect(useE2eeStore.getState().otpKeyCount).toBe(20);
    });

    it("does nothing when server count equals the threshold", async () => {
        vi.mocked(e2eeApi.countOTPPreKeys).mockResolvedValue({ count: 5 });

        await e2eeService.replenishOTPKeys(deviceId);

        expect(replenishOtpKeys).not.toHaveBeenCalled();
        expect(e2eeApi.uploadOTPPreKeys).not.toHaveBeenCalled();
        expect(useE2eeStore.getState().otpKeyCount).toBe(5);
    });

    it("does not generate keys when below threshold but already above target", async () => {
        useE2eeStore.setState({
            otpKeyTargetCount: 5,
            otpReplenishThreshold: 10,
        });
        vi.mocked(e2eeApi.countOTPPreKeys).mockResolvedValue({ count: 7 });

        await e2eeService.replenishOTPKeys(deviceId);

        expect(replenishOtpKeys).not.toHaveBeenCalled();
        expect(e2eeApi.uploadOTPPreKeys).not.toHaveBeenCalled();
        expect(useE2eeStore.getState().otpKeyCount).toBe(7);
    });

    it("guards concurrent replenish calls by account id and device id", async () => {
        let resolveCount: ((value: { count: number }) => void) | undefined;
        vi.mocked(e2eeApi.countOTPPreKeys).mockImplementation(() => new Promise((resolve) => {
            resolveCount = resolve;
        }));
        vi.mocked(e2eeApi.uploadOTPPreKeys).mockResolvedValueOnce({ count: 20 });

        const first = e2eeService.replenishOTPKeys("device-guard");
        const second = e2eeService.replenishOTPKeys("device-guard");
        resolveCount?.({ count: 0 });
        await Promise.all([first, second]);

        expect(e2eeApi.countOTPPreKeys).toHaveBeenCalledTimes(1);
        expect(replenishOtpKeys).toHaveBeenCalledWith(42, 20);
        expect(e2eeApi.uploadOTPPreKeys).toHaveBeenCalledTimes(1);
    });
});

describe("e2eeService.performSend", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStores();
        resetMocks();
    });

    it("passes a 3DH bundle to Rust when the server has no OTP pre-key", async () => {
        await e2eeService.performSend(601, "target-device", "hello");

        expect(e2eeApi.getKeyBundle).toHaveBeenCalledWith(601, "target-device");
        expect(performX3dhSend).toHaveBeenCalledTimes(1);
        const [, bundle, plaintext] = vi.mocked(performX3dhSend).mock.calls[0];
        expect(bundle.one_time_pre_key).toBeUndefined();
        expect(bundle.otpk_key_id).toBeUndefined();
        expect(plaintext).toEqual(Array.from(new TextEncoder().encode("hello")));
    });
});
