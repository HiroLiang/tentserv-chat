import { Navbar } from "@/components/layout/Navbar.tsx";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { userService } from "@/services/userService.ts";
import { VerificationCodeDialog } from "@/components/auth/VerificationCodeDialog.tsx";
import type { PendingVerificationState } from "@/types/user.ts";
import { PasswordField } from "@/components/auth/PasswordField.tsx";
import {
    focusAuthField,
    noteAuthFocusInteraction,
    resetAuthFocusInteraction,
} from "@/utils/authFocus.ts";

export const RegisterPage = () => {
    const navigate = useNavigate();

    const [email, setEmail] = useState('');
    const [account, setAccount] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [confirmPasswordError, setConfirmPasswordError] = useState('');
    const [pendingVerification, setPendingVerification] = useState<PendingVerificationState | null>(null);
    const emailInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        resetAuthFocusInteraction();
    }, []);

    useEffect(() => {
        if (isLoading || pendingVerification) {
            return;
        }
        const timeoutId = window.setTimeout(() => {
            focusAuthField(emailInputRef.current);
        }, 180);
        return () => window.clearTimeout(timeoutId);
    }, [isLoading, pendingVerification]);

    const handleSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        noteAuthFocusInteraction();
        setError('');
        setConfirmPasswordError('');

        if (password !== confirmPassword) {
            setConfirmPasswordError('Passwords do not match.');
            return;
        }

        setIsLoading(true);

        try {
            const response = await userService.register({ account, email, name, password, confirmPassword });
            toast.success("Verification code sent to your email.");
            setPendingVerification({
                kind: 'register',
                verificationToken: response.verification_token,
                verificationExpiresAtMs: response.verification_expires_at_ms,
            });
        } catch (err) {
            const errorCode = (
                typeof err === 'object'
                && err !== null
                && 'code' in err
                && typeof (err as { code?: unknown }).code === 'string'
            )
                ? (err as { code: string }).code
                : null;

            if (errorCode === 'PASSWORD_CONFIRM_MISMATCH') {
                setConfirmPasswordError('Passwords do not match.');
                return;
            }
            setError(err instanceof Error ? err.message : 'Registration failed');
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="flex flex-col h-screen">
            <Navbar/>

            <div className="flex-1 flex items-center justify-center bg-background p-4">
                <div className="w-full max-w-md">
                    <div className="bg-card border border-border rounded-lg shadow-lg p-8">

                        {/* Header */}
                        <div className="text-center mb-6">
                            <h1 className="text-2xl font-bold text-card-foreground">Create Account</h1>
                            <p className="text-card-foreground text-sm mt-2">
                                Fill in your information to get started
                            </p>
                        </div>

                        {/* Form */}
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Email */}
                            <div className="space-y-2">
                                <label htmlFor="email" className="block text-sm font-medium text-card-foreground mb-2">
                                    Email Address
                                </label>
                                <Input
                                    id="email"
                                    ref={emailInputRef}
                                    type="email"
                                    placeholder="example@email.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    disabled={isLoading}
                                    autoComplete="email"
                                />
                            </div>

                            {/* Account */}
                            <div className="space-y-2">
                                <label htmlFor="account" className="block text-sm font-medium text-card-foreground mb-2">
                                    Account Name
                                </label>
                                <Input
                                    id="account"
                                    type="text"
                                    placeholder="your_account"
                                    value={account}
                                    onChange={(e) => setAccount(e.target.value)}
                                    required
                                    disabled={isLoading}
                                    autoComplete="username"
                                />
                            </div>

                            {/* Name */}
                            <div className="space-y-2">
                                <label htmlFor="name" className="block text-sm font-medium text-card-foreground mb-2">
                                    Display Name
                                </label>
                                <Input
                                    id="name"
                                    type="text"
                                    placeholder="Your name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    required
                                    disabled={isLoading}
                                    autoComplete="name"
                                />
                            </div>

                            {/* Password */}
                            <PasswordField
                                id="password"
                                label="Password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => {
                                    setPassword(e.target.value);
                                    if (confirmPasswordError) {
                                        setConfirmPasswordError('');
                                    }
                                }}
                                required
                                disabled={isLoading}
                                autoComplete="new-password"
                            />

                            <PasswordField
                                id="confirm-password"
                                label="Confirm Password"
                                placeholder="••••••••"
                                value={confirmPassword}
                                onChange={(e) => {
                                    setConfirmPassword(e.target.value);
                                    if (confirmPasswordError) {
                                        setConfirmPasswordError('');
                                    }
                                }}
                                error={confirmPasswordError}
                                required
                                disabled={isLoading}
                                autoComplete="new-password"
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
                                {isLoading ? 'Creating account...' : 'Sign up'}
                            </Button>
                        </form>

                        {/* Footer */}
                        <div className="mt-6 text-center flex justify-center items-center gap-2 flex-shrink-0">
                            <p className="text-muted-foreground text-sm">
                                Already have an account?{' '}
                            </p>
                            <p
                                className="text-sm text-primary hover:underline font-medium"
                                onClick={() => navigate('/login')}
                            >
                                Sign in
                            </p>
                        </div>

                    </div>
                </div>
            </div>
            <VerificationCodeDialog
                session={pendingVerification}
                onSessionChange={setPendingVerification}
                onSubmit={userService.verifyEmail}
                onResend={userService.resendVerifyEmail}
                onVerified={() => {
                    setPendingVerification(null);
                    navigate("/register/verified", { replace: true });
                }}
                onFailed={() => setPendingVerification(null)}
                exhaustedErrorMessage="Registration failed"
            />
        </div>
    );
}
