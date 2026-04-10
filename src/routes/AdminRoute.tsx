import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { userService } from '@/services/userService.ts';
import { Loader2 } from 'lucide-react';
import type { CurrentUserResponse } from "@/types/user.ts";
import { useUserStore } from "@/stores/userStore.ts";

type Status = 'checking' | 'authorized' | 'denied' | 'unauthenticated';

const ADMIN_ROLES = new Set(['admin']);

/**
 * AdminRoute — server-side role verification guard.
 *
 * Security design:
 * - Never relies on the client-side store alone; always calls the API for a
 *   fresh role check after the session store says a user is logged in.
 * - Logged-out users go to "/login"; signed-in non-admin users go to "/".
 * - The AdminPage component is lazy-loaded in routes/index.tsx, so its
 *   bundle chunk is never downloaded unless this guard passes.
 */
export const AdminRoute = () => {
    const [status, setStatus] = useState<Status>('checking');
    const isLoggedIn = useUserStore((state) => state.currentUser?.isLoggedIn === true);

    useEffect(() => {
        let cancelled = false;

        if (!isLoggedIn) {
            setStatus('unauthenticated');
            return () => {
                cancelled = true;
            };
        }

        setStatus('checking');
        userService.fetchCurrentUser()
            .then((user) => {
                if (cancelled) return;
                setStatus(isAdmin(user) ? 'authorized' : 'denied');
            })
            .catch(() => {
                if (!cancelled) setStatus('denied');
            });

        return () => {
            cancelled = true;
        };
    }, [isLoggedIn]);

    if (status === 'checking') {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground"/>
            </div>
        );
    }

    if (status === 'denied') {
        // Redirect to home — intentionally not "/login" to avoid
        // revealing that this path exists to unauthorized users.
        return <Navigate to="/" replace/>;
    }

    if (status === 'unauthenticated') {
        return <Navigate to="/login" replace/>;
    }

    return <Outlet/>;
};

const isAdmin = (user: CurrentUserResponse) => {
    for (const role of user.roles ?? []) {
        if (ADMIN_ROLES.has(role)) {
            return true;
        }
    }
    return false;
}
