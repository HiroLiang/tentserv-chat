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
import { chatRoomService } from "@/services/chatRoomService.ts";
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

// [EN] AppInitializer orchestrates the 7-step startup sequence. Runs once on mount; blocks rendering with an overlay until ready or on error.
// [中] AppInitializer 負責 7 步驟啟動流程，掛載後只執行一次，未完成前以遮罩阻擋畫面。
// [日] AppInitializer は 7 ステップの起動シーケンスを調整し、マウント後に一度だけ実行、完了までオーバーレイで画面をブロックする。
export const AppInitializer = ({ children }: Props) => {
    const navigate = useNavigate();

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
        const restored = await userService.tryRestoreSession().catch(err => {
            logger.warn('Session restore failed', err);
            return false;
        });

        const isLoggedIn = restored || useUserStore.getState().currentUser?.isLoggedIn === true;

        // 4. If not logged in: auto-login in dev, navigate to /login in prod
        if (!isLoggedIn) {
            if (env.IS_DEV) {
                const loginOk = await userService.login('hiromichi.liang@gmail.com', 'string').then(() => true).catch(err => {
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

        // 5. Ensure the participant record exists, then connect WebSocket
        await chatService.initialize().catch(err => {
            logger.warn('Participant initialization failed', err);
        });
        const token = useUserStore.getState().currentUser?.token;
        const deviceId = useDeviceStore.getState().deviceId;
        if (token && deviceId) {
            wsService.connect(env.WS_BASE_URL, token, deviceId);
        } else {
            logger.warn('Skipping websocket connection due to missing session token or device ID', {
                hasToken: Boolean(token),
                deviceId,
            });
        }

        // 6. E2EE: ensure keys are generated & uploaded, then replenish if needed
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

    // [EN] Global WS event handler: when server notifies the provider to upload their sender key for a room,
    //      performInviterKeyExchange is called. provider_member_id is included in payload so we can
    //      resolve our own member_id even when we are not currently viewing that room.
    // [中] 全域 WS 事件監聽：伺服器通知 provider 上傳某房間的 sender key 時觸發，掛載後即生效。
    //      payload 含 provider_member_id，不在當前房間時仍可正確執行。
    useEffect(() => {
        const handler = (data: unknown) => {
            const payload = data as { room_id?: number; requester_user_id?: number; provider_member_id?: number };
            if (!payload?.room_id || !payload?.requester_user_id) return;
            e2eeService.performInviterKeyExchange(payload.room_id, payload.requester_user_id, payload.provider_member_id)
                .catch(err => logger.error('performInviterKeyExchange failed', err));
        };
        wsService.on('e2ee.sender_key_needed', handler);
        return () => wsService.off('e2ee.sender_key_needed', handler);
    }, []);

    // [EN] Global WS event handler: when a new member joins a room, trigger group E2EE initialization
    //      so existing members can request the new member's sender key.
    // [中] 全域 WS 事件監聽：有新成員加入房間時，觸發 group E2EE 初始化，向新成員發送 sender key 請求。
    useEffect(() => {
        const handler = (data: unknown) => {
            const payload = data as { room_id?: number };
            if (!payload?.room_id) return;
            chatRoomService.initializeGroupRoomEncryption(payload.room_id)
                .catch(err => logger.error('initializeGroupRoomEncryption on member_joined failed', err));
        };
        wsService.on('chat.member_joined', handler);
        return () => wsService.off('chat.member_joined', handler);
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
