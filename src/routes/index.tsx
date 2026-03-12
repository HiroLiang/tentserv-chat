import * as React from 'react';
import { Suspense } from 'react';
import { useRoutes } from "react-router-dom";
import { HomePage } from "../pages/HomePage.tsx";
import { LoginPage } from "@/pages/LoginPage.tsx";
import { RegisterPage } from "@/pages/RegisterPage.tsx";
import { ProtectedRoute } from "@/routes/ProtectedRoute.tsx";
import { AdminRoute } from "@/routes/AdminRoute.tsx";
import { ChatPage } from "@/pages/ChatPage.tsx";
import { ProfilePage } from "@/pages/ProfilePage.tsx";
import { SettingsPage } from "@/pages/SettingsPage.tsx";
import { Loader2 } from 'lucide-react';

// Lazy-load the admin page so its bundle chunk is only fetched
// after the AdminRoute guard confirms the user is authorized.
const AdminPage = React.lazy(() =>
    import('@/pages/AdminPage.tsx').then((m) => ({ default: m.AdminPage }))
);

const AdminFallback = () => (
    <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
);

const Routes = () => {
    return useRoutes([
        { path: "/", element: <HomePage/> },
        { path: "/login", element: <LoginPage/> },
        { path: "/register", element: <RegisterPage/> },

        {
            element: <ProtectedRoute/>,
            children: [
                { path: "/chat", element: <ChatPage/> },
                { path: "/profile", element: <ProfilePage/> },
                { path: "/settings", element: <SettingsPage/> },
            ],
        },

        // Admin console — role verified server-side by AdminRoute on every entry.
        // AdminPage is lazy-loaded so unauthorized users never download its chunk.
        {
            path: "/console",
            element: (
                <Suspense fallback={<AdminFallback />}>
                    <AdminRoute />
                </Suspense>
            ),
            children: [
                {
                    index: true,
                    element: (
                        <Suspense fallback={<AdminFallback />}>
                            <AdminPage />
                        </Suspense>
                    ),
                },
            ],
        },
    ]);
}

export default Routes;
