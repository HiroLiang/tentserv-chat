import { Navbar } from "@/components/layout/Navbar.tsx";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { userService } from "@/services/userService.ts";
import { chatService } from "@/services/chatService.ts";
import { e2eeService } from "@/services/e2eeService.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import { logger } from "@/utils/logger.ts";
import {
    focusAuthField,
    noteAuthFocusInteraction,
    resetAuthFocusInteraction,
} from "@/utils/authFocus.ts";
import { PasswordField } from "@/components/auth/PasswordField.tsx";
import { VerificationCodeDialog } from "@/components/auth/VerificationCodeDialog.tsx";
import type { PendingVerificationState } from "@/types/user.ts";

export const LoginPage = () => {
    const navigate = useNavigate();

    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [pendingVerification, setPendingVerification] = useState<PendingVerificationState | null>(null);
    const identifierInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        resetAuthFocusInteraction();
    }, []);

    useEffect(() => {
        if (isLoading || pendingVerification) {
            return;
        }
        const timeoutId = window.setTimeout(() => {
            focusAuthField(identifierInputRef.current);
        }, 180);
        return () => window.clearTimeout(timeoutId);
    }, [isLoading, pendingVerification]);

    const completeAuthenticatedLogin = async () => {
        const deviceId = useDeviceStore.getState().deviceId ?? undefined;
        const bootstrapReady = deviceId
            ? await e2eeService.ensureSessionBootstrap(deviceId)
            : false;

        if (bootstrapReady) {
            await chatService.initialize().catch(err => {
                logger.warn('Chat runtime initialization failed on login', err);
            });
        }
        navigate("/");
    };

    const finalizeVerifiedLogin = () => {
        setPendingVerification(null);
        setIsLoading(true);
        setError('');

        void (async () => {
            try {
                await userService.hydrateAuthenticatedSession();
                toast.success("Device verified successfully.");
                await completeAuthenticatedLogin();
            } catch (err) {
                logger.error('Device verification post-authentication flow failed', err);
                setError('Failed to finish signing in on this device.');
                toast.error("Device verified, but we couldn't finish signing you in.");
            } finally {
                setIsLoading(false);
            }
        })();
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        noteAuthFocusInteraction();
        setIsLoading(true);
        setError('');

        try {
            const response = await userService.login(identifier, password);
            if (response.loginStatus === 'device_verification_required') {
                toast.success("Verification code sent to your email.");
                setPendingVerification({
                    kind: 'device_login',
                    verificationToken: response.verificationToken ?? '',
                    verificationExpiresAtMs: response.verificationExpiresAtMs ?? 0,
                });
                return;
            }

            toast.success("Login successfully");
            await completeAuthenticatedLogin();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Login failed';
            setError(message);
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <>
            <div className="flex flex-col h-screen">
                <Navbar/>

                {/* Login Form */}
                <div className="flex-1 flex items-center justify-center bg-background p-4">
                    <div className="w-full max-w-md">

                        {/* Card */}
                        <div className="bg-card border border-border rounded-lg shadow-lg p-8">
                            {/* Header */}
                            <div className="text-center mb-6">
                                <h1 className="text-2xl font-bold text-card-foreground">Login</h1>
                                <p className="text-card-foreground text-sm mt-2">
                                    Enter your account information to continue
                                </p>
                            </div>

                            {/* Form */}
                            <form onSubmit={handleSubmit} className="space-y-4">
                                {/* Email */}
                                <div className="space-y-2">
                                    <label
                                        htmlFor="identifier"
                                        className="block text-sm font-medium text-card-foreground mb-2"
                                    >
                                        Email or Account
                                    </label>
                                    <Input
                                        id="identifier"
                                        ref={identifierInputRef}
                                        type="text"
                                        placeholder="email or account name"
                                        value={identifier}
                                        onChange={(e) => setIdentifier(e.target.value)}
                                        required
                                        disabled={isLoading}
                                        autoComplete="username"
                                    />
                                </div>

                                {/* Password */}
                                <PasswordField
                                    id="password"
                                    label="Password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    disabled={isLoading}
                                    autoComplete="current-password"
                                />

                                {/* Error Message */}
                                {error && (
                                    <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                                        <p className="text-destructive text-sm">{error}</p>
                                    </div>
                                )}

                                {/* Submit Button */}
                                <Button
                                    type="submit"
                                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                                    disabled={isLoading}
                                >
                                    {isLoading ? 'Loading...' : 'Sign in'}
                                </Button>
                            </form>

                            {/* Footer */}
                            <div className="mt-6 text-center flex justify-center items-center gap-2">
                                <p className="text-muted-foreground text-sm">
                                    Don't have an account?{' '}
                                </p>
                                <p
                                    onClick={() => navigate('/register')}
                                    className="text-primary text-sm hover:underline font-medium cursor-pointer"
                                >
                                    Sign up and get started!
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <VerificationCodeDialog
                session={pendingVerification}
                onSessionChange={setPendingVerification}
                onSubmit={({ token, code }) => userService.verifyLoginDevice({ token, code })}
                onResend={(token) => userService.resendLoginDeviceVerification(token)}
                onVerified={finalizeVerifiedLogin}
                onFailed={() => setPendingVerification(null)}
                title="Verify this device"
                description="Enter the 6-digit code from your login security email to finish signing in on this device."
                exhaustedErrorMessage="Device verification failed"
            />
        </>
    );
}
