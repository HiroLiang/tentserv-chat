import { type ClipboardEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import { toast } from "sonner";
import type { PendingVerificationState } from "@/types/user.ts";
import {
    formatVerificationRemaining,
    getVerificationRemainingMs,
    warnOnSuspiciousVerificationExpiry,
} from "@/utils/verificationExpiry.ts";

interface VerificationCodeDialogProps {
    session: PendingVerificationState | null;
    onSessionChange: (session: PendingVerificationState) => void;
    onSubmit: (payload: { token: string; code: string }) => Promise<unknown>;
    onResend: (token: string) => Promise<{
        verification_token: string;
        verification_expires_at_ms: number;
    }>;
    onVerified: () => void;
    onFailed: () => void;
    title?: string;
    description?: string;
    resendSuccessMessage?: string;
    exhaustedErrorMessage?: string;
}

function emptyDigits(): string[] {
    return ["", "", "", "", "", ""];
}

function sanitizeDigit(rawValue: string) {
    return rawValue.replace(/\D/g, "").slice(-1);
}

function pastedDigits(text: string) {
    return text.replace(/\D/g, "").slice(0, 6).split("");
}

export const VerificationCodeDialog = ({
    session,
    onSessionChange,
    onSubmit,
    onResend,
    onVerified,
    onFailed,
    title,
    description,
    resendSuccessMessage = "A new verification code has been sent.",
    exhaustedErrorMessage = "Verification failed",
}: VerificationCodeDialogProps) => {
    const [digits, setDigits] = useState<string[]>(emptyDigits);
    const [now, setNow] = useState(() => Date.now());
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isResending, setIsResending] = useState(false);
    const [hasInputError, setHasInputError] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

    const open = session !== null;
    const verificationCode = digits.join("");
    const remainingMs = getVerificationRemainingMs(session?.verificationExpiresAtMs ?? 0, now);
    const canResend = open && remainingMs === 0 && !isSubmitting && !isResending;
    const remainingLabel = formatVerificationRemaining(remainingMs);

    const focusInput = (index: number) => {
        window.setTimeout(() => inputRefs.current[index]?.focus(), 0);
    };

    const clearErrorState = () => {
        setHasInputError(false);
        setErrorMessage("");
    };

    useEffect(() => {
        if (!open) {
            return;
        }

        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [open]);

    useEffect(() => {
        if (!open) {
            setDigits(emptyDigits());
            clearErrorState();
            return;
        }

        setDigits(emptyDigits());
        clearErrorState();
        focusInput(0);
    }, [open, session?.verificationToken]);

    useEffect(() => {
        if (!open || !session) {
            return;
        }

        warnOnSuspiciousVerificationExpiry(session.verificationExpiresAtMs, Date.now());
    }, [open, session?.verificationExpiresAtMs, session?.verificationToken]);

    useEffect(() => {
        if (!open || verificationCode.length !== 6 || digits.some((digit) => digit === "") || isSubmitting || !session) {
            return;
        }

        void (async () => {
            setIsSubmitting(true);
            try {
                await onSubmit({
                    token: session.verificationToken,
                    code: verificationCode,
                });
                onVerified();
            } catch (err: any) {
                const remainingAttempts = Number(err?.details?.remaining_attempts ?? 0);
                setHasInputError(true);
                setDigits(emptyDigits());
                focusInput(0);

                if (err?.code === "VERIFY_CODE_INVALID") {
                    setErrorMessage(`${remainingAttempts} attempt${remainingAttempts === 1 ? "" : "s"} remaining.`);
                    return;
                }

                if (err?.code === "VERIFY_ATTEMPTS_EXCEEDED") {
                    toast.error(exhaustedErrorMessage);
                    onFailed();
                    return;
                }

                if (err?.code === "TOKEN_INVALID") {
                    toast.error("Verification code expired. Please request a new code.");
                    onFailed();
                    return;
                }

                toast.error("Unable to verify this code right now. Please try again.");
                setErrorMessage("Unable to verify this code right now. Please try again.");
            } finally {
                setIsSubmitting(false);
            }
        })();
    }, [digits, isSubmitting, onFailed, onVerified, open, session, verificationCode]);

    if (!open || !session) {
        return null;
    }

    const updateDigit = (index: number, rawValue: string) => {
        const nextValue = sanitizeDigit(rawValue);
        clearErrorState();
        setDigits((prev) => {
            const next = [...prev];
            next[index] = nextValue;
            return next;
        });

        if (nextValue && index < inputRefs.current.length - 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Backspace") {
            return;
        }

        if (digits[index]) {
            clearErrorState();
            setDigits((prev) => {
                const next = [...prev];
                next[index] = "";
                return next;
            });
            return;
        }

        if (index > 0) {
            inputRefs.current[index - 1]?.focus();
            setDigits((prev) => {
                const next = [...prev];
                next[index - 1] = "";
                return next;
            });
        }
    };

    const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
        const digitsFromPaste = pastedDigits(event.clipboardData.getData("text"));
        if (digitsFromPaste.length === 0) {
            return;
        }

        event.preventDefault();
        clearErrorState();
        setDigits([
            digitsFromPaste[0] ?? "",
            digitsFromPaste[1] ?? "",
            digitsFromPaste[2] ?? "",
            digitsFromPaste[3] ?? "",
            digitsFromPaste[4] ?? "",
            digitsFromPaste[5] ?? "",
        ]);
        const focusIndex = Math.min(Math.max(digitsFromPaste.length - 1, 0), 5);
        focusInput(focusIndex);
    };

    const handleResend = async () => {
        if (!canResend) {
            return;
        }

        setIsResending(true);
        try {
            const response = await onResend(session.verificationToken);
            onSessionChange({
                ...session,
                verificationToken: response.verification_token,
                verificationExpiresAtMs: response.verification_expires_at_ms,
            });
            toast.success(resendSuccessMessage);
        } catch {
            toast.error("Failed to resend verification code");
        } finally {
            setIsResending(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/15 px-4 py-6 backdrop-blur-sm">
            <div
                className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl sm:p-8"
                onPaste={handlePaste}
                role="dialog"
                aria-modal="true"
                aria-label="Verification code"
            >
                <div className="space-y-4">
                    {(title || description) && (
                        <div className="space-y-1 text-left">
                            {title && (
                                <h2 className="text-lg font-semibold text-foreground">{title}</h2>
                            )}
                            {description && (
                                <p className="text-sm text-muted-foreground">{description}</p>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-6 gap-2 sm:gap-3">
                        {digits.map((digit, index) => (
                            <input
                                key={index}
                                ref={(node) => {
                                    inputRefs.current[index] = node;
                                }}
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={1}
                                value={digit}
                                disabled={isSubmitting || isResending}
                                onChange={(event) => updateDigit(index, event.target.value)}
                                onKeyDown={(event) => handleKeyDown(index, event)}
                                className={cn(
                                    "h-14 rounded-xl border bg-background text-center text-2xl font-semibold text-foreground outline-none transition-colors sm:h-16",
                                    hasInputError
                                        ? "border-destructive bg-destructive/5 text-destructive focus:border-destructive"
                                        : "border-border focus:border-primary"
                                )}
                                aria-label={`Verification digit ${index + 1}`}
                            />
                        ))}
                    </div>

                    {errorMessage && (
                        <p className="min-h-5 text-sm font-medium text-destructive">{errorMessage}</p>
                    )}

                    <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
                        <span className="font-medium tabular-nums text-foreground">{remainingLabel}</span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="px-0 text-sm text-primary hover:bg-transparent hover:text-primary/80"
                            disabled={!canResend}
                            onClick={() => void handleResend()}
                        >
                            Resend Code
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
