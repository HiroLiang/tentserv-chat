import { Navbar } from "@/components/layout/Navbar.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useNavigate } from "react-router-dom";

export const RegisterVerifiedPage = () => {
    const navigate = useNavigate();

    return (
        <div className="flex min-h-screen flex-col bg-background">
            <Navbar />
            <div className="flex flex-1 items-center justify-center px-4 py-10">
                <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-8 text-center shadow-xl">
                    <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full border border-primary text-lg font-semibold text-primary">
                        OK
                    </div>
                    <h1 className="text-3xl font-semibold text-card-foreground">Email verified</h1>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        Your account is ready. Continue to the login page and sign in with your new credentials.
                    </p>
                    <Button
                        type="button"
                        className="mt-8 w-full"
                        onClick={() => navigate("/login", { replace: true })}
                    >
                        Go to Login
                    </Button>
                </div>
            </div>
        </div>
    );
};
