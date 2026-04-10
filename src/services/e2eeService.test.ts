import { beforeEach, describe, expect, it, vi } from "vitest";
import { e2eeApi } from "@/api/index.ts";
import {
    bootstrapLocalE2eeKeys,
    consumeSenderKeyDistribution,
    getSenderKeyStates,
    performX3dhSend,
    prepareSenderKeyDistribution,
    replenishOtpKeys,
} from "@/bridge/e2ee.ts";
import { useE2eeStore } from "@/stores/e2eeStore.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { e2eeService } from "./e2eeService.ts";
import type { RoomMember } from "@/types/chat.ts";

vi.mock("@/api/index.ts", () => ({
    e2eeApi: {
        getKeyPolicy: vi.fn(),
        checkKeyStatus: vi.fn(),
        uploadIdentityKey: vi.fn(),
        uploadSignedPreKey: vi.fn(),
        uploadOTPPreKeys: vi.fn(),
        countOTPPreKeys: vi.fn(),
        getKeyBundle: vi.fn(),
        uploadSenderKey: vi.fn(),
        getSenderKeyDistributionStatus: vi.fn(),
        getPendingSenderKeyDistributions: vi.fn(),
        createSenderKeyRequest: vi.fn(),
        consumeSenderKeyDistribution: vi.fn(),
    },
}));

vi.mock("@/bridge/e2ee.ts", () => ({
    bootstrapLocalE2eeKeys: vi.fn(),
    replenishOtpKeys: vi.fn(),
    performX3dhSend: vi.fn(),
    performX3dhReceive: vi.fn(),
    hasSenderKey: vi.fn(),
    getSenderKeyStates: vi.fn(),
    encryptWithSenderKey: vi.fn(),
    decryptWithSenderKey: vi.fn(),
    prepareSenderKeyDistribution: vi.fn(),
    consumeSenderKeyDistribution: vi.fn(),
    generateSenderKey: vi.fn(),
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

vi.mock("sonner", () => ({
    toast: {
        warning: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
    },
}));

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

const preparedSenderKeyDistribution = {
    distribution_message: bytes(6, 32),
    sender_key_version: 1775758701055,
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

const roomMembers: RoomMember[] = [
    {
        member_id: 10,
        participant_id: 100,
        user_id: 501,
        display_name: "Me",
        role: "owner",
        joined_at: "2026-04-10T00:00:00Z",
    },
    {
        member_id: 11,
        participant_id: 101,
        user_id: 601,
        display_name: "Peer",
        role: "owner",
        joined_at: "2026-04-10T00:00:00Z",
    },
];

const resetStores = () => {
    useUserStore.setState({
        currentUser: {
            id: 501,
            accountId: 42,
            name: "Hiro",
            isLoggedIn: true,
        },
        recordedUsers: new Map(),
        participantId: 100,
    });
    useE2eeStore.setState({
        keysUploaded: false,
        otpKeyCount: 0,
        otpKeyTargetCount: 0,
        otpReplenishThreshold: 0,
        bootstrapStatus: "ready",
        bootstrapError: null,
        senderKeyRequests: new Set(),
    });
};

const mockBootstrap = (overrides?: Partial<Awaited<ReturnType<typeof bootstrapLocalE2eeKeys>>>) => {
    vi.mocked(bootstrapLocalE2eeKeys).mockResolvedValue({
        identity_keys: identityKeys,
        spk: signedPreKey,
        identity_regenerated: true,
        spk_regenerated: true,
        ...overrides,
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
    vi.mocked(e2eeApi.uploadSenderKey).mockResolvedValue(undefined);
    vi.mocked(e2eeApi.getSenderKeyDistributionStatus).mockResolvedValue({
        own_sender_key_exists: true,
        requestable_member_ids: [],
        available_from_member_ids: [],
        available_to_member_ids: [],
        pending_receivers: [],
        pending_from_members: [],
    });
    vi.mocked(e2eeApi.getPendingSenderKeyDistributions).mockResolvedValue({ distributions: [] });
    vi.mocked(e2eeApi.createSenderKeyRequest).mockResolvedValue(undefined);
    vi.mocked(e2eeApi.consumeSenderKeyDistribution).mockResolvedValue(undefined);
    vi.mocked(replenishOtpKeys).mockImplementation(async (_accountID, count) => otpKeys(count));
    vi.mocked(performX3dhSend).mockResolvedValue({
        identity_key_dh_pub: bytes(1, 32),
        identity_key_sign_pub: bytes(2, 32),
        ephemeral_key_pub: bytes(3, 32),
        spk_key_id: 1,
        ciphertext: bytes(4, 12),
        nonce: bytes(5, 12),
    });
    vi.mocked(getSenderKeyStates).mockResolvedValue([]);
    vi.mocked(prepareSenderKeyDistribution).mockResolvedValue(preparedSenderKeyDistribution);
    vi.mocked(consumeSenderKeyDistribution).mockResolvedValue({ status: "consumed" });
    mockBootstrap();
};

describe("e2eeService.ensureInitialized", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStores();
        resetMocks();
    });

    it("uploads missing remote identity, SPK, and OTP material from the bootstrap result", async () => {
        await e2eeService.ensureInitialized("device-1");

        expect(bootstrapLocalE2eeKeys).toHaveBeenCalledWith(42, 1);
        expect(e2eeApi.checkKeyStatus).toHaveBeenCalledWith(501, "device-1");
        expect(e2eeApi.uploadIdentityKey).toHaveBeenCalledWith(
            "device-1",
            toBase64(identityKeys.identity_key_dh_pub),
            toBase64(identityKeys.identity_key_sign_pub),
        );
        expect(e2eeApi.uploadSignedPreKey).toHaveBeenCalledWith(
            "device-1",
            1,
            toBase64(signedPreKey.public_key),
            toBase64(signedPreKey.signature),
        );
        expect(replenishOtpKeys).toHaveBeenCalledWith(42, 20);
        expect(useE2eeStore.getState()).toMatchObject({
            keysUploaded: true,
            otpKeyCount: 20,
            otpKeyTargetCount: 20,
            otpReplenishThreshold: 5,
        });
    });

    it("reuses matching remote identity/SPK and only tops OTP up to the policy target", async () => {
        mockBootstrap({
            identity_regenerated: false,
            spk_regenerated: false,
        });
        vi.mocked(e2eeApi.checkKeyStatus).mockResolvedValue(matchingStatus(12));
        vi.mocked(e2eeApi.uploadOTPPreKeys).mockResolvedValueOnce({ count: 20 });

        await e2eeService.ensureInitialized("device-match");

        expect(e2eeApi.uploadIdentityKey).not.toHaveBeenCalled();
        expect(e2eeApi.uploadSignedPreKey).not.toHaveBeenCalled();
        expect(replenishOtpKeys).toHaveBeenCalledWith(42, 8);
        expect(useE2eeStore.getState().otpKeyCount).toBe(20);
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

    it("tops up from the current server count when below threshold", async () => {
        vi.mocked(e2eeApi.countOTPPreKeys).mockResolvedValue({ count: 3 });
        vi.mocked(e2eeApi.uploadOTPPreKeys).mockResolvedValueOnce({ count: 20 });

        await e2eeService.replenishOTPKeys("device-1");

        expect(replenishOtpKeys).toHaveBeenCalledWith(42, 17);
        expect(useE2eeStore.getState().otpKeyCount).toBe(20);
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

describe("e2eeService sender-key reconciliation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStores();
        resetMocks();
    });

    it("provides, consumes, and clears pending state during room reconciliation", async () => {
        vi.mocked(getSenderKeyStates)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                { member_id: "10", is_own_key: true, sender_key_version: 1775758701055, updated_at: 1 },
                { member_id: "11", is_own_key: false, sender_key_version: 88, updated_at: 2 },
            ]);
        vi.mocked(e2eeApi.getSenderKeyDistributionStatus)
            .mockResolvedValueOnce({
                own_sender_key_exists: false,
                requestable_member_ids: [11],
                available_from_member_ids: [11],
                available_to_member_ids: [],
                pending_receivers: [11],
                pending_from_members: [11],
            })
            .mockResolvedValueOnce({
                own_sender_key_exists: true,
                requestable_member_ids: [],
                available_from_member_ids: [],
                available_to_member_ids: [11],
                pending_receivers: [],
                pending_from_members: [],
            });
        vi.mocked(e2eeApi.getPendingSenderKeyDistributions).mockResolvedValue({
            distributions: [
                {
                    distribution_id: 901,
                    sender_member_id: 11,
                    receiver_member_id: 10,
                    sender_key_version: 88,
                    distribution_message: toBase64(bytes(7, 32)),
                },
            ],
        });

        const result = await e2eeService.reconcileRoomSenderKeys({
            roomId: 77,
            roomMembers,
        });

        expect(e2eeApi.getKeyBundle).toHaveBeenCalledWith(601);
        expect(prepareSenderKeyDistribution).toHaveBeenCalledWith(42, 10, expect.objectContaining({
            spk_key_id: 1,
        }));
        expect(e2eeApi.uploadSenderKey).toHaveBeenCalledWith(
            77,
            11,
            preparedSenderKeyDistribution.sender_key_version,
            expect.any(String),
        );
        expect(consumeSenderKeyDistribution).toHaveBeenCalledWith(42, 11, bytes(7, 32), 88);
        expect(e2eeApi.consumeSenderKeyDistribution).toHaveBeenCalledWith(901, "consumed");
        expect(e2eeApi.createSenderKeyRequest).not.toHaveBeenCalled();
        expect(result.currentMemberId).toBe(10);
        expect(result.status.available_to_member_ids).toEqual([11]);
    });

    it("falls back to requesting a peer key even when providing my own key fails", async () => {
        vi.mocked(getSenderKeyStates)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);
        vi.mocked(e2eeApi.getSenderKeyDistributionStatus)
            .mockResolvedValueOnce({
                own_sender_key_exists: false,
                requestable_member_ids: [11],
                available_from_member_ids: [],
                available_to_member_ids: [],
                pending_receivers: [11],
                pending_from_members: [11],
            })
            .mockResolvedValueOnce({
                own_sender_key_exists: false,
                requestable_member_ids: [11],
                available_from_member_ids: [],
                available_to_member_ids: [],
                pending_receivers: [11],
                pending_from_members: [11],
            });
        vi.mocked(e2eeApi.getKeyBundle).mockRejectedValueOnce(new Error("bundle failed"));

        await e2eeService.reconcileRoomSenderKeys({
            roomId: 78,
            roomMembers,
        });

        expect(e2eeApi.getKeyBundle).toHaveBeenCalledWith(601);
        expect(e2eeApi.createSenderKeyRequest).toHaveBeenCalledWith(78, 11);
    });

    it("skips provider-side upload when the requester already has a current available distribution", async () => {
        vi.mocked(getSenderKeyStates).mockResolvedValue([
            { member_id: "10", is_own_key: true, sender_key_version: 1775758701055, updated_at: 1 },
        ]);
        vi.mocked(e2eeApi.getSenderKeyDistributionStatus).mockResolvedValue({
            own_sender_key_exists: true,
            requestable_member_ids: [],
            available_from_member_ids: [],
            available_to_member_ids: [11],
            pending_receivers: [],
            pending_from_members: [],
        });

        const uploaded = await e2eeService.performInviterKeyExchange(79, 601, 10, 11);

        expect(uploaded).toBe(false);
        expect(e2eeApi.getKeyBundle).not.toHaveBeenCalled();
        expect(e2eeApi.uploadSenderKey).not.toHaveBeenCalled();
    });
});
