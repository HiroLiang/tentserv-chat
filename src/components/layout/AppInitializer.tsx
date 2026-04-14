import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { isTauri } from '@tauri-apps/api/core';
import { logger } from "@/utils/logger.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import { useE2eeStore } from "@/stores/e2eeStore.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { Overlay } from "@/components/ui/overlay.tsx";
import { deviceService } from "@/services/deviceService.ts";
import { networkService } from "@/services/networkService.ts";
import { userService } from "@/services/userService.ts";
import { chatService } from "@/services/chatService.ts";
import { e2eeService } from "@/services/e2eeService.ts";
import { toast } from "sonner";
import { SelfSenderKeySyncDialogs } from "@/components/layout/SelfSenderKeySyncDialogs.tsx";

type InitStatus = 'loading' | 'ready' | 'error';

interface InitError {
    message: string;
}

interface Props {
    children: React.ReactNode;
}

// [EN] AppInitializer orchestrates the startup sequence. Runs once on mount; blocks rendering with an overlay until ready or on error.
// [中] AppInitializer 負責啟動流程，掛載後只執行一次，未完成前以遮罩阻擋畫面。
// [日] AppInitializer は起動シーケンスを調整し、マウント後に一度だけ実行、完了までオーバーレイで画面をブロックする。
export const AppInitializer = ({ children }: Props) => {
    const initialized = useRef(false);
    const [status, setStatus] = useState<InitStatus>('loading');
    const [initError, setInitError] = useState<InitError | null>(null);

    // [EN] Main initialization function. Steps run sequentially; early exit on critical failure.
    // [中] 主初始化函式：各步驟依序執行，關鍵步驟失敗時提前結束並顯示錯誤覆蓋。
    // [日] メイン初期化関数：各ステップを順番に実行し、致命的エラー時は早期終了してエラーオーバーレイを表示する。
    const initialize = async () => {
        setStatus('loading');

        if (!isTauri()) {
            setStatus('error');
            setInitError({ message: 'This application requires the Tauri desktop runtime.' });
            return;
        }

        // 1. Network: health check + polling (non-blocking on failure)
        await networkService.initialize().catch(err => {
            logger.warn('Network initialization failed', err);
            toast.warning('Unable to reach server. Some features may be unavailable.');
        });

        // 2. Device registration (blocking — required to continue)
        await deviceService.initializeDevice();
        const deviceState = useDeviceStore.getState();
        if (!deviceState.registered) {
            setStatus('error');
            setInitError({ message: 'Unable to register device' });
            return;
        }

        // 3. Restore auth session from the keyring
        useE2eeStore.getState().resetBootstrapState();
        const restored = await userService.tryRestoreSession().catch(err => {
            logger.warn('Session restore failed', err);
            return false;
        });

        const isLoggedIn = restored || useUserStore.getState().currentUser?.isLoggedIn === true;

        // 4. If no cached session can be restored, stop on the public home route
        if (!isLoggedIn) {
            setStatus('ready');
            return;
        }

        // 5. Complete login-time E2EE bootstrap before chat becomes available
        const deviceId = useDeviceStore.getState().deviceId;
        const bootstrapReady = deviceId
            ? await e2eeService.ensureSessionBootstrap(deviceId)
            : false;
        if (!bootstrapReady) {
            setStatus('ready');
            return;
        }

        // 6. Chat bootstrap runs only after E2EE succeeds
        await chatService.initialize().catch(err => {
            logger.warn('Chat runtime initialization failed', err);
        });

        // 7. Done
        setStatus('ready');
    };

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;

        initialize().catch(error => {
            logger.error('Uncaught initialization error', error);
        });
    }, []);

    return (
        <>
            {status === 'ready' ? (
                <>
                    {children}
                    <SelfSenderKeySyncDialogs />
                </>
            ) : null}
            {status !== 'ready' && (
                <Overlay
                    status={status}
                    loading={{ message: 'Initializing...' }}
                    error={initError ? {
                        message: initError.message,
                        onRetry: async () => await initialize(),
                    } : undefined}
                />
            )}
        </>
    );
};
