import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { userService } from "@/services/userService.ts";
import { logger } from "@/utils/logger.ts";
import { RegisterPage } from "./RegisterPage.tsx";
import { RegisterVerifiedPage } from "./RegisterVerifiedPage.tsx";

vi.mock("@/components/layout/Navbar.tsx", () => ({
    Navbar: () => <div data-testid="navbar" />,
}));

vi.mock("@/services/userService.ts", () => ({
    userService: {
        register: vi.fn(),
        verifyEmail: vi.fn(),
        resendVerifyEmail: vi.fn(),
    },
}));

vi.mock("sonner", () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock("@/utils/logger.ts", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

const registerResponse = {
    verification_token: "token-1",
    verification_expires_at_ms: Date.now() + 180_000,
};

const fillRegisterForm = async (
    user: ReturnType<typeof userEvent.setup>,
    overrides?: { password?: string; confirmPassword?: string },
) => {
    const password = overrides?.password ?? "redacted-password";
    const confirmPassword = overrides?.confirmPassword ?? password;
    await user.type(screen.getByLabelText(/email address/i), "new@example.com");
    await user.type(screen.getByLabelText(/account name/i), "new_account");
    await user.type(screen.getByLabelText(/display name/i), "New Display");
    await user.type(screen.getByLabelText(/^password$/i), password);
    await user.type(
        screen.getByLabelText(/^confirm password$/i, { selector: "input" }),
        confirmPassword,
    );
};

const enterVerificationCode = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
    const inputs = Array.from({ length: 6 }, (_, index) =>
        screen.getByLabelText(`Verification digit ${index + 1}`),
    );

    for (const [index, digit] of code.split("").entries()) {
        await user.type(inputs[index], digit);
    }
};

const renderRegisterPage = () =>
    render(
        <MemoryRouter initialEntries={["/register"]}>
            <Routes>
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/register/verified" element={<RegisterVerifiedPage />} />
                <Route path="/login" element={<div>Login Route</div>} />
            </Routes>
        </MemoryRouter>,
    );

describe("RegisterPage verification flow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
        vi.mocked(userService.register).mockResolvedValue(registerResponse);
        vi.mocked(userService.verifyEmail).mockResolvedValue({});
        vi.mocked(userService.resendVerifyEmail).mockResolvedValue({
            verification_token: "token-2",
            verification_expires_at_ms: Date.now() + 180_000,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("opens the verification dialog after a successful registration", async () => {
        const user = userEvent.setup();
        renderRegisterPage();

        await fillRegisterForm(user);
        await user.click(screen.getByRole("button", { name: /sign up/i }));

        expect(await screen.findByRole("dialog")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Resend Code" })).toBeInTheDocument();
        expect(screen.getByText(/\d:\d{2}/)).toBeInTheDocument();
        expect(screen.queryByText("Email Verification")).not.toBeInTheDocument();
        expect(screen.queryByText("Enter your 6-digit code")).not.toBeInTheDocument();
        expect(screen.queryByText("new@example.com")).not.toBeInTheDocument();
        expect(screen.queryByText("The code will submit automatically once all six digits are filled in.")).not.toBeInTheDocument();
        expect(userService.register).toHaveBeenCalledWith({
            account: "new_account",
            email: "new@example.com",
            name: "New Display",
            password: "redacted-password",
            confirmPassword: "redacted-password",
        });
        expect(toast.success).toHaveBeenCalledWith("Verification code sent to your email.");
    });

    it("blocks submit when password confirmation does not match", async () => {
        const user = userEvent.setup();
        renderRegisterPage();

        await fillRegisterForm(user, {
            password: "redacted-password",
            confirmPassword: "different-password",
        });
        await user.click(screen.getByRole("button", { name: /sign up/i }));

        expect(userService.register).not.toHaveBeenCalled();
        expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    });

    it("debounces local password mismatch validation and clears it once the fields match", async () => {
        vi.useFakeTimers();
        renderRegisterPage();

        const passwordInput = screen.getByLabelText(/^password$/i);
        const confirmPasswordInput = screen.getByLabelText(/^confirm password$/i, { selector: "input" });

        fireEvent.change(passwordInput, { target: { value: "redacted-password" } });
        fireEvent.change(confirmPasswordInput, { target: { value: "different-password" } });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(399);
        });
        expect(screen.queryByText("Passwords do not match.")).not.toBeInTheDocument();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();

        fireEvent.change(confirmPasswordInput, { target: { value: "redacted-password" } });
        expect(screen.queryByText("Passwords do not match.")).not.toBeInTheDocument();
    });

    it("maps backend password confirmation mismatch onto the confirm-password field", async () => {
        vi.mocked(userService.register).mockRejectedValue({
            code: "PASSWORD_CONFIRM_MISMATCH",
            message: "Passwords do not match.",
        });
        const user = userEvent.setup();
        renderRegisterPage();

        await fillRegisterForm(user);
        await user.click(screen.getByRole("button", { name: /sign up/i }));

        expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
        expect(screen.queryByText("Registration failed")).not.toBeInTheDocument();
    });

    it("reveals the password only while the eye button is pressed", async () => {
        const user = userEvent.setup();
        renderRegisterPage();

        const passwordInput = screen.getByLabelText(/^password$/i);
        const revealButton = screen.getByRole("button", { name: /show password while pressed/i });

        await user.type(passwordInput, "redacted-password");
        expect(passwordInput).toHaveAttribute("type", "password");

        fireEvent.pointerDown(revealButton);
        expect(passwordInput).toHaveAttribute("type", "text");

        fireEvent.pointerUp(revealButton);
        expect(passwordInput).toHaveAttribute("type", "password");
    });

    it("formats suspiciously long countdowns as hours and logs a warning", async () => {
        vi.mocked(userService.register).mockResolvedValue({
            verification_token: "token-1",
            verification_expires_at_ms: Date.now() + 86_381_000,
        });

        const user = userEvent.setup();
        renderRegisterPage();

        await fillRegisterForm(user);
        await user.click(screen.getByRole("button", { name: /sign up/i }));

        expect(await screen.findByRole("dialog")).toBeInTheDocument();
        expect(screen.getByText(/^23:59:4\d$/)).toBeInTheDocument();
        expect(screen.queryByText(/^1439:4\d$/)).not.toBeInTheDocument();
        expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
            "Verification countdown looks longer than the expected verification window",
            expect.objectContaining({
                expiresAtMs: expect.any(Number),
                now: expect.any(Number),
                remainingMs: expect.any(Number),
            }),
        );
        const warningPayload = vi.mocked(logger.warn).mock.calls[0]?.[1] as { remainingMs?: number } | undefined;
        expect(warningPayload?.remainingMs).toBeGreaterThanOrEqual(86_380_000);
    });

    it("submits the six-digit code automatically and routes to the verified page", async () => {
        const user = userEvent.setup();
        renderRegisterPage();

        await fillRegisterForm(user);
        await user.click(screen.getByRole("button", { name: /sign up/i }));
        await screen.findByRole("dialog");

        await enterVerificationCode(user, "123456");

        await waitFor(() => expect(userService.verifyEmail).toHaveBeenCalledWith({
            token: "token-1",
            code: "123456",
        }));
        expect(await screen.findByText("Email verified")).toBeInTheDocument();
    });

    it("shows remaining attempts and highlights the inputs when the verification code is wrong", async () => {
        vi.mocked(userService.verifyEmail).mockRejectedValue({
            code: "VERIFY_CODE_INVALID",
            details: { remaining_attempts: 2 },
        });
        const user = userEvent.setup();
        renderRegisterPage();

        await fillRegisterForm(user);
        await user.click(screen.getByRole("button", { name: /sign up/i }));
        await screen.findByRole("dialog");

        await enterVerificationCode(user, "111111");

        expect(await screen.findByText("2 attempts remaining.")).toBeInTheDocument();
        expect(screen.getByLabelText("Verification digit 1")).toHaveClass("border-destructive");
    });

    it("closes the dialog and shows a failure toast after the final failed attempt", async () => {
        vi.mocked(userService.verifyEmail).mockRejectedValue({
            code: "VERIFY_ATTEMPTS_EXCEEDED",
            details: { remaining_attempts: 0 },
        });
        const user = userEvent.setup();
        renderRegisterPage();

        await fillRegisterForm(user);
        await user.click(screen.getByRole("button", { name: /sign up/i }));
        await screen.findByRole("dialog");

        await enterVerificationCode(user, "222222");

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(toast.error).toHaveBeenCalledWith("Registration failed");
    });

    it("enables resend after expiry, stores the new token, and verifies with the refreshed session", async () => {
        vi.mocked(userService.register).mockResolvedValue({
            verification_token: "token-1",
            verification_expires_at_ms: Date.now() + 1_100,
        });
        vi.mocked(userService.resendVerifyEmail).mockResolvedValue({
            verification_token: "token-2",
            verification_expires_at_ms: Date.now() + 180_000,
        });
        const user = userEvent.setup();
        renderRegisterPage();

        await fillRegisterForm(user);
        await user.click(screen.getByRole("button", { name: /sign up/i }));

        const resendButton = await screen.findByRole("button", { name: "Resend Code" });
        expect(resendButton).toBeDisabled();

        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 1_200));
        });
        await waitFor(() => expect(resendButton).toBeEnabled());
        await user.click(resendButton);

        await waitFor(() => expect(userService.resendVerifyEmail).toHaveBeenCalledWith("token-1"));
        expect(toast.success).toHaveBeenCalledWith("A new verification code has been sent.");
        await waitFor(() => expect(screen.getByText(/^2:5\d$|^3:00$/)).toBeInTheDocument());
        expect(resendButton).toBeDisabled();

        await enterVerificationCode(user, "654321");

        await waitFor(() => expect(userService.verifyEmail).toHaveBeenCalledWith({
            token: "token-2",
            code: "654321",
        }));
    });
});
