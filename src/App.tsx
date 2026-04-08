import { Toaster } from "sonner";
import Routes from "./routes";
import { AppInitializer } from "@/components/layout/AppInitializer.tsx";
import { NetworkOverlay } from "@/components/layout/NetworkOverlay.tsx";

// [EN] Root component: wraps the app in AppInitializer (startup orchestration), NetworkOverlay, Toaster, and Routes.
// [中] 根組件：以 AppInitializer（啟動流程）、NetworkOverlay（網路遮罩）、Toaster（通知）包裹整個應用。
// [日] ルートコンポーネント：AppInitializer（起動オーケストレーション）、NetworkOverlay、Toaster、Routes でアプリ全体をラップする。
function App() {

    return (
        <AppInitializer>
            <NetworkOverlay/>
            <Toaster
                position="bottom-right"
                richColors
                toastOptions={{
                    classNames: {
                        toast: "bg-zinc-900 text-zinc-100 border border-zinc-700",
                        success: "bg-emerald-600 border-emerald-500",
                        error: "bg-red-600 border-red-500",
                        warning: "bg-orange-600 border-orange-500",
                        info: "bg-blue-600 border-blue-500",
                    },
                }}
            />
            <Routes/>
        </AppInitializer>
    );
}

export default App;