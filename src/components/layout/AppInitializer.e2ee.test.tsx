import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { AppInitializer } from "./AppInitializer.tsx";
import { deviceService } from "@/services/deviceService.ts";
import { networkService } from "@/services/networkService.ts";
import { userService } from "@/services/userService.ts";
import { chatService } from "@/services/chatService.ts";
import { wsService } from "@/services/wsService.ts";
import { chatRoomService } from "@/services/chatRoomService.ts";
import { e2eeApi } from "@/api/index.ts";
import {
    generateSenderKey,
    getIdentityKeys,
    getSignedPreKey,
    hasIdentityKeys,
    performX3dhSend,
    replenishOtpKeys,
    validateIdentityKeys,
    validateSignedPreKey,
} from "@/bridge/e2ee.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import { useE2eeStore } from "@/stores/e2eeStore.ts";
import { useNetworkStore } from "@/stores/networkStore.ts";
import { useUserStore } from "@/stores/userStore.ts";

const envMock = vi.hoisted(() => ({
    API_BASE_URL: "http://api.test",
    WS_BASE_URL: "ws://ws.test",
    IS_DEV: false,
}));

vi.mock("@tauri-apps/api/core", () => ({
    isTauri: vi.fn(() => true),
}));

vi.mock("@/config/env.ts", () => ({
    env: envMock,
}));

vi.mock("@/services/deviceService.ts", () => ({
    deviceService: {
        initializeDevice: vi.fn(),
    },
}));

vi.mock("@/services/networkService.ts", () => ({
    networkService: {
        initialize: vi.fn(),
    },
}));

vi.mock("@/services/userService.ts", () => ({
    userService: {
        tryRestoreSession: vi.fn(),
        login: vi.fn(),
    },
}));

vi.mock("@/services/chatService.ts", () => ({
    chatService: {
        initialize: vi.fn(),
    },
}));

vi.mock("@/services/wsService.ts", () => ({
    wsService: {
        connect: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    },
}));

vi.mock("@/services/chatRoomService.ts", () => ({
    chatRoomService: {
        initializeGroupRoomEncryption: vi.fn(),
    },
}));

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
        getSenderKeys: vi.fn(),
        getSenderKeyDistributionStatus: vi.fn(),
        createSenderKeyRequest: vi.fn(),
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

const senderKeyBundle = {
    public_key: bytes(6, 32),
};

const initialMessage = {
    identity_key_dh_pub: bytes(7, 32),
    identity_key_sign_pub: bytes(8, 32),
    ephemeral_key_pub: bytes(9, 32),
    spk_key_id: 1,
    ciphertext: bytes(10, 12),
    nonce: bytes(11, 12),
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

const registerDevice = () => {
    useDeviceStore.setState({
        deviceId: "device-1",
        deviceName: "MacBook",
        platform: "macos",
        registered: true,
        createdAt: 1000,
        updatedAt: null,
    });
};

const resetStores = () => {
    useUserStore.setState({
        currentUser: { id: 0 },
        recordedUsers: new Map(),
        participantId: null,
    });
    useDeviceStore.setState({
        deviceId: null,
        deviceName: null,
        platform: null,
        registered: false,
        createdAt: null,
        updatedAt: null,
    });
    useNetworkStore.setState({
        browserOnline: true,
        serverReachable: true,
        networkStatus: "healthy",
        lastCheck: null,
    });
    useE2eeStore.setState({
        keysUploaded: false,
        otpKeyCount: 0,
        otpKeyTargetCount: 0,
        otpReplenishThreshold: 0,
        senderKeyRequests: new Set(),
    });
};

const renderInitializer = () =>
    render(
        <MemoryRouter initialEntries={["/"]}>
            <Routes>
                <Route path="/" element={<AppInitializer><div>App Route</div></AppInitializer>} />
                <Route path="/login" element={<div>Login Route</div>} />
            </Routes>
        </MemoryRouter>,
    );

describe("AppInitializer E2EE replenish integration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.IS_DEV = false;
        vi.mocked(isTauri).mockReturnValue(true);
        resetStores();
        vi.mocked(networkService.initialize).mockResolvedValue(undefined);
        vi.mocked(deviceService.initializeDevice).mockImplementation(async () => registerDevice());
        vi.mocked(userService.tryRestoreSession).mockImplementation(async () => {
            useUserStore.getState().setCurrentUser({
                id: 501,
                accountId: 42,
                token: "token-restored",
                isLoggedIn: true,
            });
            return true;
        });
        vi.mocked(userService.login).mockResolvedValue({ message: "Login successfully" });
        vi.mocked(chatService.initialize).mockResolvedValue(undefined);
        vi.mocked(chatRoomService.initializeGroupRoomEncryption).mockResolvedValue(undefined);

        vi.mocked(e2eeApi.getKeyPolicy).mockResolvedValue({
            otp_prekey_target_count: 20,
            otp_prekey_replenish_threshold: 5,
        });
        vi.mocked(e2eeApi.checkKeyStatus).mockResolvedValue(matchingStatus(20));
        vi.mocked(e2eeApi.uploadIdentityKey).mockResolvedValue({ fingerprint: "ignored" });
        vi.mocked(e2eeApi.uploadSignedPreKey).mockResolvedValue(undefined);
        vi.mocked(e2eeApi.uploadOTPPreKeys).mockResolvedValue({ count: 20 });
        vi.mocked(e2eeApi.countOTPPreKeys).mockResolvedValue({ count: 0 });
        vi.mocked(e2eeApi.getKeyBundle).mockResolvedValue({
            identity_key: toBase64(identityKeys.identity_key_dh_pub),
            identity_key_sign: toBase64(identityKeys.identity_key_sign_pub),
            signed_pre_key: toBase64(signedPreKey.public_key),
            spk_signature: toBase64(signedPreKey.signature),
            spk_key_id: signedPreKey.key_id,
        });
        vi.mocked(e2eeApi.uploadSenderKey).mockResolvedValue(undefined);
        vi.mocked(hasIdentityKeys).mockResolvedValue(true);
        vi.mocked(getIdentityKeys).mockResolvedValue(identityKeys);
        vi.mocked(getSignedPreKey).mockResolvedValue(signedPreKey);
        vi.mocked(validateIdentityKeys).mockResolvedValue(true);
        vi.mocked(validateSignedPreKey).mockResolvedValue(true);
        vi.mocked(generateSenderKey).mockResolvedValue(senderKeyBundle);
        vi.mocked(performX3dhSend).mockResolvedValue(initialMessage);
        vi.mocked(replenishOtpKeys).mockImplementation(async (_accountId, count) => otpKeys(count));
    });

    it("processes replenish websocket events end-to-end with real e2eeService", async () => {
        renderInitializer();

        await waitFor(() => expect(wsService.on).toHaveBeenCalledWith("e2ee.replenish_otp_keys", expect.any(Function)));
        await waitFor(() => expect(useE2eeStore.getState()).toMatchObject({
            keysUploaded: true,
            otpKeyTargetCount: 20,
            otpReplenishThreshold: 5,
            otpKeyCount: 20,
        }));

        vi.mocked(e2eeApi.countOTPPreKeys).mockResolvedValueOnce({ count: 3 });
        vi.mocked(e2eeApi.uploadOTPPreKeys).mockResolvedValueOnce({ count: 20 });

        const handler = getWSHandler("e2ee.replenish_otp_keys");
        handler({ user_id: 501, device_id: "device-1" });

        await waitFor(() => expect(e2eeApi.countOTPPreKeys).toHaveBeenCalledWith("device-1"));
        expect(replenishOtpKeys).toHaveBeenCalledWith(42, 17);
        expect(e2eeApi.uploadOTPPreKeys).toHaveBeenCalledWith("device-1", expect.arrayContaining([
            expect.objectContaining({ key_id: 1 }),
        ]));
        expect(useE2eeStore.getState().otpKeyCount).toBe(20);
    });

    it("processes sender_key_needed websocket events end-to-end with real e2eeService", async () => {
        renderInitializer();

        await waitFor(() => expect(wsService.on).toHaveBeenCalledWith("e2ee.sender_key_needed", expect.any(Function)));

        vi.mocked(e2eeApi.getKeyBundle).mockClear();
        vi.mocked(generateSenderKey).mockClear();
        vi.mocked(performX3dhSend).mockClear();
        vi.mocked(e2eeApi.uploadSenderKey).mockClear();

        const handler = getWSHandler("e2ee.sender_key_needed");
        handler({ room_id: 77, requester_user_id: 601, provider_member_id: 702 });

        await waitFor(() => expect(e2eeApi.getKeyBundle).toHaveBeenCalledWith(601));
        expect(generateSenderKey).toHaveBeenCalledWith(42, 702);
        expect(performX3dhSend).toHaveBeenCalledWith(42, expect.objectContaining({
            spk_key_id: 1,
        }), senderKeyBundle.public_key);
        expect(e2eeApi.uploadSenderKey).toHaveBeenCalledWith(
            77,
            toBase64(senderKeyBundle.public_key),
            expect.any(String),
        );

        const distributionMessage = vi.mocked(e2eeApi.uploadSenderKey).mock.calls[0][2];
        const decoded = atob(distributionMessage);
        expect(JSON.parse(decoded)).toEqual(initialMessage);
    });
});

const getWSHandler = (type: string): ((data: unknown) => void) => {
    const call = vi.mocked(wsService.on).mock.calls.find(([event]) => event === type);
    if (!call) throw new Error(`missing ws handler for ${type}`);
    return call[1] as (data: unknown) => void;
};
