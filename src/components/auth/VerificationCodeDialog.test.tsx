import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VerificationCodeDialog } from "./VerificationCodeDialog.tsx";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import {
    noteAuthFocusInteraction,
    resetAuthFocusInteraction,
} from "@/utils/authFocus.ts";

const baseSession = {
    kind: "device_login" as const,
    verificationToken: "verify-token",
    verificationExpiresAtMs: Date.now() + 180_000,
};

describe("VerificationCodeDialog", () => {
    beforeEach(() => {
        resetAuthFocusInteraction();
        useDeviceStore.setState({
            deviceId: "device-1",
            deviceName: "MacBook",
            platform: "macos",
            registered: true,
            createdAt: 1000,
            updatedAt: null,
        });
    });

    it("does not auto focus the first verification digit on macos without prior user interaction", async () => {
        render(
            <VerificationCodeDialog
                session={baseSession}
                onSessionChange={vi.fn()}
                onSubmit={vi.fn().mockResolvedValue(undefined)}
                onResend={vi.fn().mockResolvedValue({
                    verification_token: "verify-token-2",
                    verification_expires_at_ms: Date.now() + 180_000,
                })}
                onVerified={vi.fn()}
                onFailed={vi.fn()}
            />,
        );

        const firstDigit = screen.getByLabelText("Verification digit 1");
        await new Promise((resolve) => window.setTimeout(resolve, 20));
        expect(firstDigit).not.toHaveFocus();
    });

    it("focuses the first verification digit on macos after a user interaction has been recorded", async () => {
        noteAuthFocusInteraction();

        render(
            <VerificationCodeDialog
                session={baseSession}
                onSessionChange={vi.fn()}
                onSubmit={vi.fn().mockResolvedValue(undefined)}
                onResend={vi.fn().mockResolvedValue({
                    verification_token: "verify-token-2",
                    verification_expires_at_ms: Date.now() + 180_000,
                })}
                onVerified={vi.fn()}
                onFailed={vi.fn()}
            />,
        );

        await waitFor(() => expect(screen.getByLabelText("Verification digit 1")).toHaveFocus());
    });
});
