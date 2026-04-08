import { NetworkState, useNetworkStore } from "@/stores/networkStore.ts";
import { logger } from "@/utils/logger.ts";
import { toast } from "sonner";
import { wsService } from "@/services/wsService.ts";

// [EN] NetworkService monitors connectivity: registers browser online/offline events and polls /api/health every 30s.
//      On reconnect, it also triggers a WebSocket force-reconnect.
// [中] NetworkService 監控網路狀態：監聽瀏覽器 online/offline 事件並每 30 秒輪詢 /api/health；重新上線時觸發 WebSocket 強制重連。
// [日] NetworkService はネットワーク監視：ブラウザの online/offline イベントを登録し、30 秒ごとに /api/health をポーリングする。
//      再接続時は WebSocket の強制再接続もトリガーする。
class NetworkService {
    private initialized: boolean = false;
    private pollingInterval: ReturnType<typeof setInterval> | null = null;

    async initialize(): Promise<void> {
        const store: NetworkState = useNetworkStore.getState();

        if (!this.initialized) {
            window.addEventListener('online', () => {
                logger.info('Browser went online');
                store.setBrowserOnline(true);
                toast.success('Network connection restored', { duration: 3000 });
                store.checkConnection();

                logger.info("Reconnecting websocket...");
                wsService.forceReconnect();
            });

            window.addEventListener('offline', () => {
                logger.info('Browser went offline');
                store.setBrowserOnline(false);
                toast.error('Network connection lost');
            });

            this.startPolling();
            this.initialized = true;
        }

        await this.checkInitialConnection();
    }

    async recheck(): Promise<boolean> {
        const store = useNetworkStore.getState();

        const toastId = toast.loading('Checking network connection...');
        const isOnline = await store.checkConnection();
        toast.dismiss(toastId);

        if (isOnline) {
            toast.success('Network connection restored');
        } else {
            toast.error('Cannot connect to server');
        }

        return isOnline;
    }

    private async checkInitialConnection(): Promise<void> {
        const store: NetworkState = useNetworkStore.getState();

        logger.info('Checking initial connection...');

        const isOnline = await store.checkConnection();
        if (!isOnline) {
            toast.error('Failed to connect to server', {
                description: 'Please check your internet connection and try again',
                duration: 3000
            });
        } else {
            logger.info('Connected to server');
        }
    }

    startPolling(intervalMs = 30_000) {
        const store = useNetworkStore.getState();
        this.stopPolling();
        this.pollingInterval = setInterval(async () => {
            await store.checkConnection();
        }, intervalMs);
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }
}

export const networkService = new NetworkService();