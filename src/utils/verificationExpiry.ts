import { logger } from "@/utils/logger.ts";

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

export const SUSPICIOUS_VERIFICATION_WINDOW_MS = 60 * MINUTES_PER_HOUR * MILLISECONDS_PER_SECOND;

function toTotalSeconds(remainingMs: number) {
    return Math.max(0, Math.ceil(remainingMs / MILLISECONDS_PER_SECOND));
}

export function getVerificationRemainingMs(expiresAtMs: number, now = Date.now()) {
    return Math.max(0, expiresAtMs - now);
}

export function formatVerificationRemaining(remainingMs: number) {
    const totalSeconds = toTotalSeconds(remainingMs);
    const seconds = totalSeconds % SECONDS_PER_MINUTE;
    const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);

    if (remainingMs < SUSPICIOUS_VERIFICATION_WINDOW_MS) {
        return `${totalMinutes}:${seconds.toString().padStart(2, "0")}`;
    }

    const minutes = totalMinutes % MINUTES_PER_HOUR;
    const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function warnOnSuspiciousVerificationExpiry(expiresAtMs: number, now = Date.now()) {
    const remainingMs = getVerificationRemainingMs(expiresAtMs, now);
    if (remainingMs < SUSPICIOUS_VERIFICATION_WINDOW_MS) {
        return;
    }

    logger.warn("Verification countdown looks longer than the expected verification window", {
        expiresAtMs,
        now,
        remainingMs,
    });
}
