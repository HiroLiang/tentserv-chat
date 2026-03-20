import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { isTauri } from '@tauri-apps/api/core';
import { logger } from "@/utils/logger.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { Overlay } from "@/components/ui/overlay.tsx";
import { deviceService } from "@/services/deviceService.ts";
import { networkService } from "@/services/networkService.ts";
import { userService } from "@/services/userService.ts";
import { chatService } from "@/services/chatService.ts";
import { wsService } from "@/services/wsService.ts";
import { e2eeService } from "@/services/e2eeService.ts";
import { env } from "@/config/env.ts";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

type InitStatus = 'loading' | 'ready' | 'error';

interface InitError {
    message: string;
}

interface Props {
    children: React.ReactNode;
}

export const AppInitializer = ({ children }: Props) => {
    const navigate = useNavigate();

    const initialized = useRef(false);
    const [status, setStatus] = useState<InitStatus>('loading');
    const [initError, setInitError] = useState<InitError | null>(null);

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
        const restored = await userService.tryRestoreSession().catch(err => {
            logger.warn('Session restore failed', err);
            return false;
        });

        const isLoggedIn = restored || useUserStore.getState().currentUser?.isLoggedIn === true;

        // 4. If not logged in: auto-login in dev, navigate to /login in prod
        if (!isLoggedIn) {
            if (env.IS_DEV) {
                const loginOk = await userService.login('hiro@gmail.com', 'string').then(() => true).catch(err => {
                    toast.error(err.message);
                    return false;
                });
                if (!loginOk) {
                    navigate('/login');
                    setStatus('ready');
                    return;
                }
            } else {
                navigate('/');
                setStatus('ready');
                return;
            }
        }

        // 5. WebSocket setup (requires user logged in)
        const token = useUserStore.getState().currentUser?.token;
        chatService.initialize();
        wsService.connect(env.WS_BASE_URL, token);

        // 6. E2EE: ensure keys are generated & uploaded, then replenish if needed
        const deviceId = useDeviceStore.getState().deviceId;
        if (deviceId) {
            await e2eeService.ensureInitialized(deviceId).catch(err => {
                logger.error('E2EE initialization failed', err);
            });
        }

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
            {children}
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
