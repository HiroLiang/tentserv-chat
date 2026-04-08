import { useNetworkStore } from "@/stores/networkStore.ts";
import { logger } from "@/utils/logger.ts";
import { toast } from "sonner";
import { useUserStore } from "@/stores/userStore.ts";

type MessageHandler = (data: unknown) => void;

type WSStatus = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";

// [EN] WebSocketService is a singleton managing a single WebSocket connection.
//      Features: exponential-backoff reconnect (3s→30s), offline message queue (flushed on connect),
//      typed message dispatching via handlers map, and auto-ACK for delivery_id messages.
// [中] WebSocketService 是單例，管理唯一的 WebSocket 連線。
//      功能：指數退避重連（3s→30s）、離線訊息佇列（連線後自動補發）、型別化訊息分發、delivery_id 自動 ACK。
// [日] WebSocketService はシングルトンで、単一の WebSocket 接続を管理する。
//      機能：指数バックオフ再接続（3s→30s）、オフラインメッセージキュー（接続後に自動送信）、
//      型別メッセージディスパッチ、delivery_id の自動 ACK。
class WebSocketService {
    private ws: WebSocket | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    private reconnectDelay = 3000;
    private maxReconnectDelay = 30000;

    private handlers: Map<string, Set<MessageHandler>> = new Map();
    private messageQueue: string[] = [];

    private url = "";
    private token: string | null = null;
    private deviceId: string | null = null;

    private status: WSStatus = "idle";

    getStatus() {
        return this.status;
    }

    // [EN] connect: guards (user logged in + network healthy), then calls createConnection().
    // [中] connect：確認用戶已登入且網路健康後，呼叫 createConnection() 建立連線。
    // [日] connect：ユーザーログイン済みかつネットワーク正常を確認してから createConnection() を呼び出す。
    connect(url: string, token?: string, deviceId?: string) {
        this.url = url;
        this.token = token ?? null;
        this.deviceId = deviceId ?? null;

        const userState = useUserStore.getState();
        if (!userState.currentUser?.isLoggedIn) {
            logger.warn('Cannot connect to websocket server. User is not logged in.');
            toast.error('Please login first.');
            return;
        }

        if (!this.token || !this.deviceId) {
            logger.warn('Cannot connect to websocket server. Missing token or device ID.', {
                hasToken: Boolean(this.token),
                deviceId: this.deviceId,
            });
            return;
        }

        const netState = useNetworkStore.getState();
        if (netState.networkStatus !== 'healthy') {
            logger.warn('Cannot connect to websocket server. Network is not healthy.');

            switch (netState.networkStatus) {
                case "offline":
                    toast.error('Offline, please check your internet connection.');
                    break;
                case "connecting":
                    toast.error('Connecting to server... Please try again later.');
                    break;
                default:
                    toast.error('Cannot connect to websocket server. Please retry later.');
                    break;
            }

            return;
        }

        this.createConnection();
    }

    disconnect() {
        this.clearReconnectTimer();
        this.stopHeartbeat();

        this.ws?.close(1000, "manual disconnect");
        this.ws = null;
        this.status = "disconnected";

        logger.info("WebSocket disconnected");
    }

    forceReconnect() {
        logger.info("Force reconnect");
        this.disconnect();
        this.reconnectDelay = 3000;
        this.createConnection();
    }

    send(type: string, payload: unknown) {
        const message = JSON.stringify({
            type,
            payload,
            timestamp: Date.now(),
        });

        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(message);
        } else {
            logger.warn("Socket not open, queue message", { type });
            this.messageQueue.push(message);
        }
    }

    on(type: string, handler: MessageHandler) {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, new Set());
        }
        this.handlers.get(type)!.add(handler);
    }

    off(type: string, handler: MessageHandler) {
        this.handlers.get(type)?.delete(handler);
    }

    // [EN] createConnection: builds the WebSocket URL (appending token + device_id as query params),
    //      sets up onopen/onmessage/onclose/onerror handlers, and starts heartbeat on connect.
    // [中] createConnection：建立 WebSocket URL（附加 token + device_id 為 query params），
    //      設定 onopen/onmessage/onclose/onerror，並在連線成功後啟動心跳。
    // [日] createConnection：WebSocket URL を組み立て（token + device_id をクエリパラメータに付加）、
    //      onopen/onmessage/onclose/onerror を設定し、接続成功後にハートビートを開始する。
    private createConnection() {
        if (!this.url) return;
        if (this.ws?.readyState === WebSocket.OPEN) return;

        this.status = this.ws ? "reconnecting" : "connecting";

        const params = new URLSearchParams();
        if (this.token) params.set('token', this.token);
        if (this.deviceId) params.set('device_id', this.deviceId);
        const queryString = params.toString();
        const finalUrl = queryString ? `${this.url}?${queryString}` : this.url;

        logger.info('WebSocket connecting...', { url: finalUrl });

        this.ws = new WebSocket(finalUrl);

        // on connected
        this.ws.onopen = () => {
            logger.info('WebSocket connected');

            this.status = "connected";
            this.reconnectDelay = 3000;
            this.flushQueue();
            this.startHeartbeat();
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);

                // Heartbeat response
                if (message.type === "pong") return;

                // Auto-acknowledge delivery if delivery_id is present
                if (message.delivery_id !== undefined) {
                    this.send('system.ack', { delivery_id: message.delivery_id });
                }

                const handlers = this.handlers.get(message.type);
                handlers?.forEach((h) => h(message.payload));
            } catch (err) {
                logger.error("WebSocket parse error", err);
            }
        };

        this.ws.onclose = (event) => {
            this.stopHeartbeat();

            if (event.code === 1000) {
                this.status = "disconnected";
                return;
            }

            if (this.status === "connecting" || this.status === "reconnecting") {
                logger.warn("WebSocket closed during handshake; check token and device_id pairing.", {
                    code: event.code,
                    hasToken: Boolean(this.token),
                    deviceId: this.deviceId,
                });
            }

            logger.warn("WebSocket closed, reconnecting...", {
                code: event.code,
            });

            this.scheduleReconnect();
        };

        this.ws.onerror = (err) => {
            logger.error("WebSocket error", {
                err,
                hasToken: Boolean(this.token),
                deviceId: this.deviceId,
                status: this.status,
            });
        };
    }

    // [EN] scheduleReconnect: waits reconnectDelay then doubles it (max 30s) and calls createConnection().
    // [中] scheduleReconnect：等待 reconnectDelay 後將延遲翻倍（上限 30s），再呼叫 createConnection()。
    // [日] scheduleReconnect：reconnectDelay 後に遅延を 2 倍に増加（最大 30s）し、createConnection() を呼び出す。
    private scheduleReconnect() {
        this.clearReconnectTimer();

        this.reconnectTimer = setTimeout(() => {
            this.reconnectDelay = Math.min(
                this.reconnectDelay * 2,
                this.maxReconnectDelay
            );

            this.createConnection();
        }, this.reconnectDelay);
    }

    private clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private flushQueue() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            if (msg) this.ws.send(msg);
        }
    }

    private startHeartbeat() {
        // Heartbeat is handled by the server-side WebSocket protocol ping/pong (54s interval).
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
}

export const wsService = new WebSocketService();
