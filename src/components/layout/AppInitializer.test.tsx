import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { AppInitializer } from "./AppInitializer.tsx";
import { deviceService } from "@/services/deviceService.ts";
import { networkService } from "@/services/networkService.ts";
import { userService } from "@/services/userService.ts";
import { chatService } from "@/services/chatService.ts";
import { e2eeService } from "@/services/e2eeService.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import { useNetworkStore } from "@/stores/networkStore.ts";
import { useUserStore } from "@/stores/userStore.ts";

vi.mock("@tauri-apps/api/core", () => ({
    isTauri: vi.fn(() => true),
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
    },
}));

vi.mock("@/services/chatService.ts", () => ({
    chatService: {
        initialize: vi.fn(),
    },
}));

vi.mock("@/services/e2eeService.ts", () => ({
    e2eeService: {
        ensureSessionBootstrap: vi.fn(),
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
        resetStores();
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(networkService.initialize).mockResolvedValue(undefined);
        vi.mocked(deviceService.initializeDevice).mockImplementation(async () => registerDevice());
        vi.mocked(userService.tryRestoreSession).mockResolvedValue(false);
        vi.mocked(chatService.initialize).mockResolvedValue(undefined);
        vi.mocked(e2eeService.ensureSessionBootstrap).mockResolvedValue(true);
    });

    it("shows an error overlay when Tauri runtime is unavailable", async () => {
        vi.mocked(isTauri).mockReturnValue(false);

        renderInitializer();

        expect(await screen.findByText(/requires the tauri desktop runtime/i)).toBeInTheDocument();
    });

    it("shows an error when device registration fails", async () => {
        vi.mocked(deviceService.initializeDevice).mockResolvedValue(undefined);

        renderInitializer();

        expect(await screen.findByText(/unable to register device/i)).toBeInTheDocument();
        expect(userService.tryRestoreSession).not.toHaveBeenCalled();
    });

    it("stops on the public route when no cached session exists", async () => {
        renderInitializer();

        expect(await screen.findByText("App Route")).toBeInTheDocument();
        expect(chatService.initialize).not.toHaveBeenCalled();
        expect(e2eeService.ensureSessionBootstrap).not.toHaveBeenCalled();
    });

    it("restores an existing session, runs E2EE bootstrap, then starts the Rust chat runtime", async () => {
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
        expect(e2eeService.ensureSessionBootstrap).toHaveBeenCalledWith("device-1");
        expect(vi.mocked(chatService.initialize).mock.invocationCallOrder[0])
            .toBeGreaterThan(vi.mocked(e2eeService.ensureSessionBootstrap).mock.invocationCallOrder[0]);
    });

    it("keeps the app usable but skips runtime startup when bootstrap is not ready", async () => {
        vi.mocked(userService.tryRestoreSession).mockImplementation(async () => {
            useUserStore.getState().setCurrentUser({
                id: 501,
                accountId: 42,
                token: "token-restored",
                isLoggedIn: true,
            });
            return true;
        });
        vi.mocked(e2eeService.ensureSessionBootstrap).mockResolvedValue(false);

        renderInitializer();

        expect(await screen.findByText("App Route")).toBeInTheDocument();
        expect(chatService.initialize).not.toHaveBeenCalled();
    });
});
