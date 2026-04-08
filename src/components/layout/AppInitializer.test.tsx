import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { AppInitializer } from "./AppInitializer.tsx";
import { deviceService } from "@/services/deviceService.ts";
import { networkService } from "@/services/networkService.ts";
import { userService } from "@/services/userService.ts";
import { chatService } from "@/services/chatService.ts";
import { wsService } from "@/services/wsService.ts";
import { e2eeService } from "@/services/e2eeService.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";
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

vi.mock("@/services/e2eeService.ts", () => ({
    e2eeService: {
        ensureInitialized: vi.fn(),
        performInviterKeyExchange: vi.fn(),
        replenishOTPKeys: vi.fn(),
    },
}));

vi.mock("@/services/chatRoomService.ts", () => ({
    chatRoomService: {
        initializeGroupRoomEncryption: vi.fn(),
    },
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

describe("AppInitializer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        envMock.IS_DEV = false;
        vi.mocked(isTauri).mockReturnValue(true);
        resetStores();
        vi.mocked(networkService.initialize).mockResolvedValue(undefined);
        vi.mocked(deviceService.initializeDevice).mockImplementation(async () => registerDevice());
        vi.mocked(userService.tryRestoreSession).mockResolvedValue(false);
        vi.mocked(userService.login).mockResolvedValue({ message: "Login successfully" });
        vi.mocked(chatService.initialize).mockResolvedValue(undefined);
        vi.mocked(e2eeService.ensureInitialized).mockResolvedValue(undefined);
        vi.mocked(e2eeService.replenishOTPKeys).mockResolvedValue(undefined);
    });

    it("stops startup outside the Tauri runtime", async () => {
        vi.mocked(isTauri).mockReturnValue(false);

        renderInitializer();

        expect(await screen.findByText(/requires the Tauri desktop runtime/i)).toBeInTheDocument();
        expect(networkService.initialize).not.toHaveBeenCalled();
        expect(deviceService.initializeDevice).not.toHaveBeenCalled();
    });

    it("blocks auth restore when device registration fails", async () => {
        vi.mocked(deviceService.initializeDevice).mockResolvedValue(undefined);

        renderInitializer();

        expect(await screen.findByText(/unable to register device/i)).toBeInTheDocument();
        expect(userService.tryRestoreSession).not.toHaveBeenCalled();
        expect(userService.login).not.toHaveBeenCalled();
    });

    it("redirects unauthenticated production startup to login", async () => {
        renderInitializer();

        expect(await screen.findByText("Login Route")).toBeInTheDocument();
        expect(userService.login).not.toHaveBeenCalled();
        expect(chatService.initialize).not.toHaveBeenCalled();
        expect(wsService.connect).not.toHaveBeenCalled();
        expect(e2eeService.ensureInitialized).not.toHaveBeenCalled();
    });

    it("restores an existing session before chat, websocket, and E2EE handoff", async () => {
        vi.mocked(userService.tryRestoreSession).mockImplementation(async () => {
            useUserStore.getState().setCurrentUser({
                id: 501,
                accountId: 42,
                token: "token-restored",
                isLoggedIn: true,
            });
            return true;
        });

        renderInitializer();

        await waitFor(() => expect(chatService.initialize).toHaveBeenCalledTimes(1));
        expect(wsService.connect).toHaveBeenCalledWith("ws://ws.test", "token-restored", "device-1");
        expect(e2eeService.ensureInitialized).toHaveBeenCalledWith("device-1");
    });

    it("uses dev auto-login when restore has no token", async () => {
        envMock.IS_DEV = true;
        vi.mocked(userService.login).mockImplementation(async () => {
            useUserStore.getState().setCurrentUser({
                id: 501,
                accountId: 42,
                token: "token-dev",
                isLoggedIn: true,
            });
            return { message: "Login successfully" };
        });

        renderInitializer();

        await waitFor(() => expect(userService.login).toHaveBeenCalledWith("hiromichi.liang@gmail.com", "string"));
        expect(chatService.initialize).toHaveBeenCalledTimes(1);
        expect(wsService.connect).toHaveBeenCalledWith("ws://ws.test", "token-dev", "device-1");
        expect(e2eeService.ensureInitialized).toHaveBeenCalledWith("device-1");
    });

    it("registers and cleans up the OTP replenish websocket handler", async () => {
        const view = renderInitializer();

        await waitFor(() => expect(wsService.on).toHaveBeenCalledWith("e2ee.replenish_otp_keys", expect.any(Function)));
        const handler = getWSHandler("e2ee.replenish_otp_keys");

        view.unmount();

        expect(wsService.off).toHaveBeenCalledWith("e2ee.replenish_otp_keys", handler);
    });

    it("replenishes OTP keys only when the websocket event matches current user and device", async () => {
        renderInitializer();
        await waitFor(() => expect(wsService.on).toHaveBeenCalledWith("e2ee.replenish_otp_keys", expect.any(Function)));
        const handler = getWSHandler("e2ee.replenish_otp_keys");
        useUserStore.getState().setCurrentUser({
            id: 501,
            accountId: 42,
            isLoggedIn: true,
        });
        registerDevice();

        handler({ user_id: 501, device_id: "device-1" });

        await waitFor(() => expect(e2eeService.replenishOTPKeys).toHaveBeenCalledWith("device-1"));
    });

    it("ignores malformed or stale OTP replenish websocket events", async () => {
        renderInitializer();
        await waitFor(() => expect(wsService.on).toHaveBeenCalledWith("e2ee.replenish_otp_keys", expect.any(Function)));
        const handler = getWSHandler("e2ee.replenish_otp_keys");
        useUserStore.getState().setCurrentUser({
            id: 501,
            accountId: 42,
            isLoggedIn: true,
        });
        registerDevice();

        handler({ user_id: 999, device_id: "device-1" });
        handler({ user_id: 501, device_id: "device-2" });
        handler({ room_id: 1 });

        expect(e2eeService.replenishOTPKeys).not.toHaveBeenCalled();
    });
});

const getWSHandler = (type: string): ((data: unknown) => void) => {
    const call = vi.mocked(wsService.on).mock.calls.find(([event]) => event === type);
    if (!call) throw new Error(`missing ws handler for ${type}`);
    return call[1] as (data: unknown) => void;
};
