import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/utils/logger.ts";
import {
    formatVerificationRemaining,
    getVerificationRemainingMs,
    warnOnSuspiciousVerificationExpiry,
} from "./verificationExpiry.ts";

vi.mock("@/utils/logger.ts", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

describe("verificationExpiry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("formats a normal verification window as minutes and seconds", () => {
        expect(getVerificationRemainingMs(1_180_000, 1_000_000)).toBe(180_000);
        expect(formatVerificationRemaining(180_000)).toBe("3:00");
        expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
    });

    it("clamps expired windows to zero", () => {
        const remainingMs = getVerificationRemainingMs(999_999, 1_000_000);

        warnOnSuspiciousVerificationExpiry(999_999, 1_000_000);

        expect(remainingMs).toBe(0);
        expect(formatVerificationRemaining(remainingMs)).toBe("0:00");
        expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
    });

    it("formats suspiciously long verification windows as hours and logs a warning", () => {
        const expiresAtMs = 86_381_000;
        const now = 0;

        warnOnSuspiciousVerificationExpiry(expiresAtMs, now);

        expect(formatVerificationRemaining(getVerificationRemainingMs(expiresAtMs, now))).toBe("23:59:41");
        expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
            "Verification countdown looks longer than the expected verification window",
            expect.objectContaining({
                expiresAtMs,
                now,
                remainingMs: 86_381_000,
            }),
        );
    });
});
