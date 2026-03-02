import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { logger } from "@/utils/logger.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import { Overlay } from "@/components/ui/overlay.tsx";
import { deviceService } from "@/services/deviceService.ts";
import { networkService } from "@/services/networkService.ts";
import { env } from "@/config/env.ts";
import { userService } from "@/services/userService.ts";
import { useUserStore } from "@/stores/userStore.ts";
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
        setStatus("loading");

        // Initialize network state
        await networkService.initialize();

        // Initialize device state
        await deviceService.initializeDevice();

        const deviceState = useDeviceStore.getState();
        if (!deviceState.registered) {
            setStatus('error')
            setInitError({
                message: 'Unable to register device',
            });
            return;
        }

        const user = useUserStore.getState().currentUser;
        if ((!user || !user.isLoggedIn) && env.IS_DEV) {
            await userService.login('jack@gmail.com', 'string').catch(err => {
                toast.error(err.message);
                navigate('/login');
            });
        }

        setStatus("ready");
    }

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;

        initialize().catch((error) => {
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
}