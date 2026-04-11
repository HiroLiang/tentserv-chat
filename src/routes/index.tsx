import * as React from 'react';
import { Suspense } from 'react';
import { useRoutes } from "react-router-dom";
import { HomePage } from "../pages/HomePage.tsx";
import { LoginPage } from "@/pages/LoginPage.tsx";
import { RegisterPage } from "@/pages/RegisterPage.tsx";
import { RegisterVerifiedPage } from "@/pages/RegisterVerifiedPage.tsx";
import { ChatAvailabilityRoute } from "@/routes/ChatAvailabilityRoute.tsx";
import { ProtectedRoute } from "@/routes/ProtectedRoute.tsx";
import { AdminRoute } from "@/routes/AdminRoute.tsx";
import { ChatPage } from "@/pages/ChatPage.tsx";
import { ProfilePage } from "@/pages/ProfilePage.tsx";
import { SettingsPage } from "@/pages/SettingsPage.tsx";
import { FriendsPage } from "@/pages/FriendsPage.tsx";
import { Loader2 } from 'lucide-react';

// [EN] Routing config: public routes (/, /login, /register), protected routes (ProtectedRoute checks isLoggedIn),
//      and /console (AdminRoute verifies role server-side; AdminPage is lazy-loaded so unauthorized users
//      never download its JS bundle).
// [中] 路由設定：公開路由（/, /login, /register）、受保護路由（ProtectedRoute 檢查登入狀態）
//      及 /console（AdminRoute 在伺服器端驗證角色；AdminPage 懶載入，未授權使用者不會下載其 JS bundle）。
// [日] ルーティング設定：公開ルート（/, /login, /register）、保護ルート（ProtectedRoute がログイン確認）、
//      /console（AdminRoute がサーバー側でロールを検証；AdminPage は遅延読み込みで未認可ユーザーには JS バンドルを配信しない）。

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
        { path: "/register/verified", element: <RegisterVerifiedPage/> },

        {
            element: <ProtectedRoute/>,
            children: [
                {
                    path: "/chat",
                    element: (
                        <ChatAvailabilityRoute>
                            <ChatPage/>
                        </ChatAvailabilityRoute>
                    ),
                },
                { path: "/profile", element: <ProfilePage/> },
                { path: "/settings", element: <SettingsPage/> },
                { path: "/friends", element: <FriendsPage/> },
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
