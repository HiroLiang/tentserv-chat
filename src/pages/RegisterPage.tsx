import { Navbar } from "@/components/layout/Navbar.tsx";
import { type SubmitEvent, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { userService } from "@/services/userService.ts";

export const RegisterPage = () => {
    const navigate = useNavigate();

    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            const response = await userService.register({ email, name, password });
            toast.success(response.message ?? "Account created successfully");
            navigate("/login");
        } catch (err) {
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
                                    type="email"
                                    placeholder="example@email.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    disabled={isLoading}
                                    autoComplete="email"
                                    autoFocus
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
                            <div className="space-y-2">
                                <label htmlFor="password"
                                       className="block text-sm font-medium text-card-foreground mb-2">
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
                                    autoComplete="new-password"
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
        </div>
    );
}
