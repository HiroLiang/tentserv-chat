import { env } from '@/config/env.ts';
import {
    CHAT_MESSAGE_DELIVERY_UPDATED_EVENT,
    CHAT_ROOM_UPDATED_EVENT,
    CHAT_ROOMS_UPDATED_EVENT,
    CHAT_SYNC_STATE_CHANGED_EVENT,
    chatGetRoomsSnapshot,
    chatRuntimeStart,
    chatRuntimeStop,
    onChatMessageDeliveryUpdated,
    onChatRoomUpdated,
    onChatRoomsUpdated,
    onChatSyncStateChanged,
    type ChatRoomSnapshot,
    type ChatRoomsSnapshot,
} from '@/bridge/chat.ts';
import { useChatStore } from '@/stores/chatStore.ts';
import { useDeviceStore } from '@/stores/deviceStore.ts';
import { useE2eeStore } from '@/stores/e2eeStore.ts';
import { useUserStore } from '@/stores/userStore.ts';
import { CHAT_RUNTIME_UNAVAILABLE_MESSAGE } from '@/utils/chatCopy.ts';
import { logger } from '@/utils/logger.ts';

type UnlistenFn = () => void;
const LIVE_UPDATES_DELAYED_MESSAGE = 'Live updates are temporarily delayed. Chats will keep refreshing automatically.';

interface HydrateRoomOptions {
    persistDetail?: boolean;
    replaceMessages?: boolean;
}

class ChatService {
    private initPromise: Promise<void> | null = null;
    private listenersRegistered = false;
    private unlisteners: UnlistenFn[] = [];

    async initialize(): Promise<void> {
        if (useE2eeStore.getState().bootstrapStatus !== 'ready') {
            logger.warn('Skipping chat runtime startup until E2EE bootstrap is ready', {
                bootstrapStatus: useE2eeStore.getState().bootstrapStatus,
            });
            return;
        }

        const runtimeStatus = useChatStore.getState().runtimeStatus;
        if (runtimeStatus === 'ready' || runtimeStatus === 'degraded') {
            return;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        useChatStore.getState().setRuntimeStatus('starting');
        this.initPromise = this.doInitialize().finally(() => {
            this.initPromise = null;
        });
        return this.initPromise;
    }

    async ensureRuntimeReady(): Promise<void> {
        const runtimeStatus = useChatStore.getState().runtimeStatus;
        if (runtimeStatus === 'ready' || runtimeStatus === 'degraded') {
            return;
        }

        if (useE2eeStore.getState().bootstrapStatus !== 'ready') {
            throw new Error('Chat is unavailable until end-to-end encryption is ready.');
        }

        await this.initialize();

        const nextStatus = useChatStore.getState().runtimeStatus;
        if (nextStatus !== 'ready' && nextStatus !== 'degraded') {
            throw new Error(CHAT_RUNTIME_UNAVAILABLE_MESSAGE);
        }
    }

    async stop(): Promise<void> {
        await Promise.all(this.unlisteners.map(async (unlisten) => {
            try {
                unlisten();
            } catch (error) {
                logger.warn('Failed to dispose chat runtime listener', error);
            }
        }));
        this.unlisteners = [];
        this.listenersRegistered = false;

        try {
            await chatRuntimeStop();
        } catch (error) {
            logger.warn('Failed to stop chat runtime', error);
        }

        useUserStore.getState().setParticipantId(null);
        useChatStore.getState().setSyncState(null);
        useChatStore.getState().setRuntimeStatus('idle', null);
    }

    async refreshRooms(forceRefresh = false): Promise<ChatRoomsSnapshot> {
        await this.ensureRuntimeReady();
        const snapshot = await chatGetRoomsSnapshot(forceRefresh);
        this.hydrateRoomsSnapshot(snapshot);
        return snapshot;
    }

    hydrateRoomSnapshot(snapshot: ChatRoomSnapshot, options: HydrateRoomOptions = {}): void {
        const store = useChatStore.getState();
        const persistDetail = options.persistDetail ?? true;
        const replaceMessages = options.replaceMessages ?? true;

        store.setDirectKeyStatus(snapshot.room_id, snapshot.direct_key_status);

        if (persistDetail) {
            store.setRoomDetail(snapshot);
        }

        if (replaceMessages) {
            store.setMessages(snapshot.room_id, snapshot.messages, snapshot.has_more);
        } else {
            store.prependMessages(snapshot.room_id, snapshot.messages, snapshot.has_more);
        }
    }

    private async doInitialize(): Promise<void> {
        try {
            const session = this.resolveSession();
            const snapshot = await chatRuntimeStart(session);
            this.hydrateRoomsSnapshot(snapshot);

            const listenerError = await this.ensureListeners();
            if (listenerError) {
                useChatStore.getState().setRuntimeStatus('degraded', listenerError);
                logger.warn('Chat runtime listener registration is degraded', { error: listenerError });
                return;
            }

            useChatStore.getState().setRuntimeStatus('ready', null);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to start chat runtime.';
            useChatStore.getState().setRuntimeStatus('failed', message);
            throw error instanceof Error ? error : new Error(message);
        }
    }

    private resolveSession() {
        const currentUser = useUserStore.getState().currentUser;
        const deviceId = useDeviceStore.getState().deviceId;

        if (!currentUser?.token || !currentUser.accountId || !currentUser.id || !deviceId) {
            throw new Error('Chat runtime requires an authenticated session, account id, user id, and device id.');
        }

        return {
            api_base_url: env.API_BASE_URL,
            ws_base_url: env.WS_BASE_URL,
            token: currentUser.token,
            account_id: currentUser.accountId,
            user_id: currentUser.id,
            device_id: deviceId,
        };
    }

    private hydrateRoomsSnapshot(snapshot: ChatRoomsSnapshot): void {
        const store = useChatStore.getState();
        store.setRooms(snapshot.rooms);
        store.setSyncState(snapshot.sync_state);
        if (snapshot.participant_id !== undefined && snapshot.participant_id !== null) {
            useUserStore.getState().setParticipantId(snapshot.participant_id);
        }
    }

    private async ensureListeners(): Promise<string | null> {
        if (this.listenersRegistered) {
            return null;
        }

        const unlisteners: UnlistenFn[] = [];
        const errors: string[] = [];

        const register = async (
            eventName: string,
            subscribe: () => Promise<UnlistenFn>,
        ): Promise<void> => {
            try {
                unlisteners.push(await subscribe());
            } catch (error) {
                logger.warn(`Failed to register ${eventName} listener`, error);
                errors.push(eventName);
            }
        };

        await register(CHAT_ROOMS_UPDATED_EVENT, () => onChatRoomsUpdated((snapshot) => {
                this.hydrateRoomsSnapshot(snapshot);
            }));
        await register(CHAT_ROOM_UPDATED_EVENT, () => onChatRoomUpdated((snapshot) => {
                const store = useChatStore.getState();
                const shouldPersistDetail = store.currentRoomId === snapshot.room_id
                    || store.currentRoomDetail?.room_id === snapshot.room_id;
                this.hydrateRoomSnapshot(snapshot, {
                    persistDetail: shouldPersistDetail,
                    replaceMessages: false,
                });
            }));
        await register(CHAT_MESSAGE_DELIVERY_UPDATED_EVENT, () => onChatMessageDeliveryUpdated((update) => {
                useChatStore.getState().updateMessageDelivery(
                    update.room_id,
                    update.client_message_id,
                    update.delivery_status,
                    update.delivery_error,
                    update.server_message_id,
                );
            }));
        await register(CHAT_SYNC_STATE_CHANGED_EVENT, () => onChatSyncStateChanged((syncState) => {
                useChatStore.getState().setSyncState(syncState);
            }));

        this.unlisteners = unlisteners;
        this.listenersRegistered = errors.length === 0;
        if (errors.length > 0 && unlisteners.length > 0) {
            this.listenersRegistered = true;
            return LIVE_UPDATES_DELAYED_MESSAGE;
        }
        if (errors.length > 0) {
            return LIVE_UPDATES_DELAYED_MESSAGE;
        }
        return null;
    }
}

export const chatService = new ChatService();
