import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { e2eeService } from "@/services/e2eeService.ts";
import { chatService } from "@/services/chatService.ts";
import { userService } from "@/services/userService.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { LoginPage } from "./LoginPage.tsx";

vi.mock("@/components/layout/Navbar.tsx", () => ({
    Navbar: () => <div data-testid="navbar" />,
}));

vi.mock("@/services/userService.ts", () => ({
    userService: {
        login: vi.fn(),
        verifyLoginDevice: vi.fn(),
        resendLoginDeviceVerification: vi.fn(),
        hydrateAuthenticatedSession: vi.fn(),
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
        vi.mocked(userService.hydrateAuthenticatedSession).mockResolvedValue({
            id: 501,
            accountId: 42,
            name: "Hiro",
            email: "hiro@example.com",
            avatar_url: "avatar.png",
            roles: ["user"],
        });
    });

    it("submits an email login and starts the post-login handoff", async () => {
        vi.mocked(userService.login).mockImplementation(async () => {
            useUserStore.getState().setCurrentUser({
                id: 501,
                accountId: 42,
                token: "token-login",
                isLoggedIn: true,
            });
            return { loginStatus: "authenticated" };
        });
        const user = userEvent.setup();
        renderLogin();

        await user.type(screen.getByLabelText(/email or account/i), "hiro@example.com");
        await user.type(screen.getByLabelText(/^password$/i, { selector: "input" }), "correct-password");
        await user.click(screen.getByRole("button", { name: /sign in/i }));

        await waitFor(() => expect(screen.getByText("Home Route")).toBeInTheDocument());
        expect(userService.login).toHaveBeenCalledWith("hiro@example.com", "correct-password");
        expect(chatService.initialize).toHaveBeenCalledTimes(1);
        expect(e2eeService.ensureSessionBootstrap).toHaveBeenCalledWith("device-1");
        expect(vi.mocked(chatService.initialize).mock.invocationCallOrder[0])
            .toBeGreaterThan(vi.mocked(e2eeService.ensureSessionBootstrap).mock.invocationCallOrder[0]);
    });

    it("focuses the identifier field after a short delay instead of relying on native autofocus", async () => {
        renderLogin();

        const identifierInput = screen.getByLabelText(/email or account/i);
        expect(identifierInput).not.toHaveAttribute("autofocus");
        await new Promise((resolve) => window.setTimeout(resolve, 220));
        expect(identifierInput).not.toHaveFocus();
    });

    it("still focuses the identifier field automatically on non-macos platforms", async () => {
        useDeviceStore.setState({
            deviceId: "device-1",
            deviceName: "Workstation",
            platform: "windows",
            registered: true,
            createdAt: 1000,
            updatedAt: null,
        });

        renderLogin();

        const identifierInput = screen.getByLabelText(/email or account/i);
        expect(identifierInput).not.toHaveAttribute("autofocus");
        await waitFor(() => expect(identifierInput).toHaveFocus());
    });

    it("submits an account identifier without requiring an email shape", async () => {
        vi.mocked(userService.login).mockImplementation(async () => {
            useUserStore.getState().setCurrentUser({
                id: 502,
                accountId: 43,
                token: "token-account",
                isLoggedIn: true,
            });
            return { loginStatus: "authenticated" };
        });
        const user = userEvent.setup();
        renderLogin();

        await user.type(screen.getByLabelText(/email or account/i), "hiro-account");
        await user.type(screen.getByLabelText(/^password$/i, { selector: "input" }), "correct-password");
        await user.click(screen.getByRole("button", { name: /sign in/i }));

        await waitFor(() => expect(userService.login).toHaveBeenCalledWith("hiro-account", "correct-password"));
        expect(chatService.initialize).toHaveBeenCalledTimes(1);
    });

    it("shows the login error and skips chat/runtime bootstrap on failure", async () => {
        vi.mocked(userService.login).mockRejectedValue(new Error("invalid credentials"));
        const user = userEvent.setup();
        renderLogin();

        await user.type(screen.getByLabelText(/email or account/i), "hiro@example.com");
        await user.type(screen.getByLabelText(/^password$/i, { selector: "input" }), "wrong-password");
        await user.click(screen.getByRole("button", { name: /sign in/i }));

        expect(await screen.findByText("invalid credentials")).toBeInTheDocument();
        expect(chatService.initialize).not.toHaveBeenCalled();
        expect(e2eeService.ensureSessionBootstrap).not.toHaveBeenCalled();
    });

    it("uses the shared password reveal control and shows the corrected sign-up copy", async () => {
        const user = userEvent.setup();
        renderLogin();

        const passwordInput = screen.getByLabelText(/^password$/i);
        const revealButton = screen.getByRole("button", { name: /show password while pressed/i });

        expect(screen.getByText("Don't have an account?")).toBeInTheDocument();

        await user.type(passwordInput, "correct-password");
        expect(passwordInput).toHaveAttribute("type", "password");

        fireEvent.pointerDown(revealButton);
        expect(passwordInput).toHaveAttribute("type", "text");

        fireEvent.pointerUp(revealButton);
        expect(passwordInput).toHaveAttribute("type", "password");
    });

    it("opens device verification, completes the challenge, then continues bootstrap", async () => {
        vi.mocked(userService.login).mockResolvedValue({
            loginStatus: "device_verification_required",
            verificationToken: "verify-login-token",
            verificationExpiresAtMs: Date.now() + 180_000,
        });
        vi.mocked(userService.verifyLoginDevice).mockResolvedValue({ login_status: "authenticated" });
        vi.mocked(userService.resendLoginDeviceVerification).mockResolvedValue({
            verification_token: "verify-login-token-2",
            verification_expires_at_ms: Date.now() + 180_000,
        });
        const user = userEvent.setup();
        renderLogin();

        await user.type(screen.getByLabelText(/email or account/i), "hiro@example.com");
        await user.type(screen.getByLabelText(/^password$/i, { selector: "input" }), "correct-password");
        await user.click(screen.getByRole("button", { name: /sign in/i }));

        expect(await screen.findByRole("dialog")).toBeInTheDocument();

        const inputs = Array.from({ length: 6 }, (_, index) =>
            screen.getByLabelText(`Verification digit ${index + 1}`),
        );
        for (const [index, digit] of "123456".split("").entries()) {
            await user.type(inputs[index], digit);
        }

        await waitFor(() => expect(userService.verifyLoginDevice).toHaveBeenCalledWith({
            token: "verify-login-token",
            code: "123456",
        }));
        await waitFor(() => expect(userService.hydrateAuthenticatedSession).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        await waitFor(() => expect(screen.getByText("Home Route")).toBeInTheDocument());
        expect(e2eeService.ensureSessionBootstrap).toHaveBeenCalledWith("device-1");
        expect(chatService.initialize).toHaveBeenCalledTimes(1);
    });

    it("closes the verification dialog and shows a general login error when post-verify hydration fails", async () => {
        vi.mocked(userService.login).mockResolvedValue({
            loginStatus: "device_verification_required",
            verificationToken: "verify-login-token",
            verificationExpiresAtMs: Date.now() + 180_000,
        });
        vi.mocked(userService.verifyLoginDevice).mockResolvedValue({ login_status: "authenticated" });
        vi.mocked(userService.hydrateAuthenticatedSession).mockRejectedValue(new Error("profile load failed"));

        const user = userEvent.setup();
        renderLogin();

        await user.type(screen.getByLabelText(/email or account/i), "hiro@example.com");
        await user.type(screen.getByLabelText(/^password$/i, { selector: "input" }), "correct-password");
        await user.click(screen.getByRole("button", { name: /sign in/i }));

        expect(await screen.findByRole("dialog")).toBeInTheDocument();

        const inputs = Array.from({ length: 6 }, (_, index) =>
            screen.getByLabelText(`Verification digit ${index + 1}`),
        );
        for (const [index, digit] of "123456".split("").entries()) {
            await user.type(inputs[index], digit);
        }

        await waitFor(() => expect(userService.verifyLoginDevice).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(await screen.findByText("Failed to finish signing in on this device.")).toBeInTheDocument();
        expect(screen.queryByText("profile load failed")).not.toBeInTheDocument();
        expect(e2eeService.ensureSessionBootstrap).not.toHaveBeenCalled();
        expect(chatService.initialize).not.toHaveBeenCalled();
    });
});
