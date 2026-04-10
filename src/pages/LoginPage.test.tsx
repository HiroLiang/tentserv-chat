import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/config/env.ts";
import { e2eeService } from "@/services/e2eeService.ts";
import { chatService } from "@/services/chatService.ts";
import { userService } from "@/services/userService.ts";
import { wsService } from "@/services/wsService.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { LoginPage } from "./LoginPage.tsx";

vi.mock("@/components/layout/Navbar.tsx", () => ({
    Navbar: () => <div data-testid="navbar" />,
}));

vi.mock("@/config/env.ts", () => ({
    env: {
        API_BASE_URL: "http://api.test",
        WS_BASE_URL: "ws://ws.test",
        IS_DEV: false,
    },
}));

vi.mock("@/services/userService.ts", () => ({
    userService: {
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
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
    },
}));

const resetStores = () => {
    useUserStore.setState({
        currentUser: { id: 0 },
        recordedUsers: new Map(),
        participantId: null,
    });
    useDeviceStore.setState({
        deviceId: "device-1",
        deviceName: "MacBook",
        platform: "macos",
        registered: true,
        createdAt: 1000,
        updatedAt: null,
    });
};

const renderLogin = () =>
    render(
        <MemoryRouter initialEntries={["/login"]}>
            <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/" element={<div>Home Route</div>} />
            </Routes>
        </MemoryRouter>,
    );

describe("LoginPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStores();
        vi.mocked(chatService.initialize).mockResolvedValue(undefined);
        vi.mocked(e2eeService.ensureSessionBootstrap).mockResolvedValue(true);
    });

    it("submits an email login and starts the post-login handoff", async () => {
        vi.mocked(userService.login).mockImplementation(async () => {
            useUserStore.getState().setCurrentUser({
                id: 501,
                accountId: 42,
                token: "token-login",
                isLoggedIn: true,
            });
            return { message: "Welcome back" };
        });
        const user = userEvent.setup();
        renderLogin();

        await user.type(screen.getByLabelText(/email or account/i), "hiro@example.com");
        await user.type(screen.getByLabelText(/password/i), "correct-password");
        await user.click(screen.getByRole("button", { name: /sign in/i }));

        await waitFor(() => expect(screen.getByText("Home Route")).toBeInTheDocument());
        expect(userService.login).toHaveBeenCalledWith("hiro@example.com", "correct-password");
        expect(wsService.connect).toHaveBeenCalledWith(env.WS_BASE_URL, "token-login", "device-1");
        expect(chatService.initialize).toHaveBeenCalledTimes(1);
        expect(e2eeService.ensureSessionBootstrap).toHaveBeenCalledWith("device-1");
        expect(vi.mocked(chatService.initialize).mock.invocationCallOrder[0])
            .toBeGreaterThan(vi.mocked(e2eeService.ensureSessionBootstrap).mock.invocationCallOrder[0]);
        expect(vi.mocked(wsService.connect).mock.invocationCallOrder[0])
            .toBeGreaterThan(vi.mocked(chatService.initialize).mock.invocationCallOrder[0]);
    });

    it("submits an account identifier without requiring an email shape", async () => {
        vi.mocked(userService.login).mockImplementation(async () => {
            useUserStore.getState().setCurrentUser({
                id: 502,
                accountId: 43,
                token: "token-account",
                isLoggedIn: true,
            });
            return {};
        });
        const user = userEvent.setup();
        renderLogin();

        await user.type(screen.getByLabelText(/email or account/i), "hiro-account");
        await user.type(screen.getByLabelText(/password/i), "correct-password");
        await user.click(screen.getByRole("button", { name: /sign in/i }));

        await waitFor(() => expect(userService.login).toHaveBeenCalledWith("hiro-account", "correct-password"));
        expect(wsService.connect).toHaveBeenCalledWith(env.WS_BASE_URL, "token-account", "device-1");
    });

    it("shows the login error and skips chat, websocket, and E2EE handoff on failure", async () => {
        vi.mocked(userService.login).mockRejectedValue(new Error("invalid credentials"));
        const user = userEvent.setup();
        renderLogin();

        await user.type(screen.getByLabelText(/email or account/i), "hiro@example.com");
        await user.type(screen.getByLabelText(/password/i), "wrong-password");
        await user.click(screen.getByRole("button", { name: /sign in/i }));

        expect(await screen.findByText("invalid credentials")).toBeInTheDocument();
        expect(wsService.connect).not.toHaveBeenCalled();
        expect(chatService.initialize).not.toHaveBeenCalled();
        expect(e2eeService.ensureSessionBootstrap).not.toHaveBeenCalled();
    });
});
