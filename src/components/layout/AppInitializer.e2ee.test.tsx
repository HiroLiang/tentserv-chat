import { render, waitFor } from "@testing-library/react";
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
import { useE2eeStore } from "@/stores/e2eeStore.ts";
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

const renderInitializer = () =>
    render(
        <MemoryRouter initialEntries={["/"]}>
            <Routes>
                <Route path="/" element={<AppInitializer><div>App Route</div></AppInitializer>} />
            </Routes>
        </MemoryRouter>,
    );

describe("AppInitializer E2EE gate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(networkService.initialize).mockResolvedValue(undefined);
        vi.mocked(deviceService.initializeDevice).mockImplementation(async () => {
            useDeviceStore.setState({
                deviceId: "device-1",
                deviceName: "MacBook",
                platform: "macos",
                registered: true,
                createdAt: 1000,
                updatedAt: null,
            });
        });
        vi.mocked(userService.tryRestoreSession).mockImplementation(async () => {
            useUserStore.getState().setCurrentUser({
                id: 501,
                accountId: 42,
                token: "token-restored",
                isLoggedIn: true,
            });
            return true;
        });
        vi.mocked(chatService.initialize).mockResolvedValue(undefined);
        useE2eeStore.setState({
            bootstrapStatus: "idle",
            keysUploaded: false,
            otpKeyCount: 0,
            otpKeyTargetCount: 0,
            otpReplenishThreshold: 0,
            bootstrapError: null,
            senderKeyRequests: new Set(),
        });
    });

    it("waits for bootstrap success before starting the Rust chat runtime", async () => {
        vi.mocked(e2eeService.ensureSessionBootstrap).mockImplementation(async () => {
            useE2eeStore.setState({
                bootstrapStatus: "ready",
                keysUploaded: true,
            });
            return true;
        });

        renderInitializer();

        await waitFor(() => expect(chatService.initialize).toHaveBeenCalledTimes(1));
        expect(useE2eeStore.getState()).toMatchObject({
            bootstrapStatus: "ready",
            keysUploaded: true,
        });
    });

    it("leaves the runtime stopped when bootstrap fails and preserves the bootstrap state for UI gating", async () => {
        vi.mocked(e2eeService.ensureSessionBootstrap).mockImplementation(async () => {
            useE2eeStore.setState({
                bootstrapStatus: "failed",
                bootstrapError: "bootstrap failed",
            });
            return false;
        });

        renderInitializer();

        await waitFor(() => expect(e2eeService.ensureSessionBootstrap).toHaveBeenCalledWith("device-1"));
        expect(chatService.initialize).not.toHaveBeenCalled();
        expect(useE2eeStore.getState()).toMatchObject({
            bootstrapStatus: "failed",
            bootstrapError: "bootstrap failed",
        });
    });
});
