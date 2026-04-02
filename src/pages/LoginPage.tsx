import { Navbar } from "@/components/layout/Navbar.tsx";
import { type SubmitEvent, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { userService } from "@/services/userService.ts";
import { chatService } from "@/services/chatService.ts";
import { wsService } from "@/services/wsService.ts";
import { e2eeService } from "@/services/e2eeService.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import { env } from "@/config/env.ts";

export const LoginPage = () => {
    const navigate = useNavigate();

    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {

            // Try to sign in
            const response = await userService.login(identifier, password);
            toast.success(response.message ?? "Login successfully");

            // connect to websocket
            const token = useUserStore.getState().currentUser?.token;
            const deviceId = useDeviceStore.getState().deviceId ?? undefined;
            wsService.connect(env.WS_BASE_URL, token ?? '', deviceId);
            chatService.initialize();
            if (deviceId) {
                e2eeService.ensureInitialized(deviceId).catch(() => {});
            }
            navigate("/");
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
                                        type="text"
                                        placeholder="email or account name"
                                        value={identifier}
                                        onChange={(e) => setIdentifier(e.target.value)}
                                        required
                                        disabled={isLoading}
                                        autoComplete="username"
                                        autoFocus
                                    />
                                </div>

                                {/* Password */}
                                <div className="space-y-2">
                                    <label
                                        htmlFor="password"
                                        className="block text-sm font-medium text-card-foreground mb-2"
                                    >
                                        Password
                                    </label>
                                    <Input
                                        id="password"
                                        type="password"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        disabled={isLoading}
                                        autoComplete="current-password"
                                    />
                                </div>

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
                                    Don't nave an account?{' '}
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
        </>
    );
}
