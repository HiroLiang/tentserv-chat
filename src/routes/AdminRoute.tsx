import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { userService } from '@/services/userService.ts';
import { Loader2 } from 'lucide-react';
import { CurrentUserResponse } from "@/types/user.ts";

type Status = 'checking' | 'authorized' | 'denied';

const ADMIN_ROLES = new Set(['admin']);

/**
 * AdminRoute — server-side role verification guard.
 *
 * Security design:
 * - Never relies on the client-side store alone; always calls the API for a
 *   fresh role check. Manipulating localStorage/Zustand has no effect.
 * - On failure, redirects to "/" (not "/login") to avoid revealing the
 *   route exists or leaking the admin path pattern.
 * - The AdminPage component is lazy-loaded in routes/index.tsx, so its
 *   bundle chunk is never downloaded unless this guard passes.
 */
export const AdminRoute = () => {
    const [status, setStatus] = useState<Status>('checking');

    useEffect(() => {
        let cancelled = false;

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
    }, []);

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
