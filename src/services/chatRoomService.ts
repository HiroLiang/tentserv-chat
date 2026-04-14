import { chatApi } from '@/api/index.ts';
import {
    chatGetRoomSnapshot,
    chatMarkRoomRead,
    chatRetryMessage,
    chatSendMessage,
    chatSetActiveRoom,
    type ChatRoomSnapshot,
} from '@/bridge/chat.ts';
import { useChatStore } from '@/stores/chatStore.ts';
import { logger } from '@/utils/logger.ts';
import { LATEST_MESSAGE_FALLBACK } from '@/utils/chatCopy.ts';
import type { CreateRoomRequest, CreateRoomResponse, GetMyRoomInvitationResponse, SendMessageRequest } from '@/api/types.ts';
import type { RoomDetail } from '@/types/chat.ts';
import { chatService } from '@/services/chatService.ts';

export { LATEST_MESSAGE_FALLBACK };

type DirectRoomBlockState = 'none' | 'blocked_by_me' | 'blocked_by_peer' | 'blocked_both';
type LoadRoomDetailOptions = {
    persist?: boolean;
    hydrateMessages?: boolean;
    forceRefresh?: boolean;
};

class ChatRoomService {
    private loadRoomsPromise: Promise<void> | null = null;
    private roomDetailFetchPromises = new Map<string, Promise<ChatRoomSnapshot | null>>();

    private isRoomDeleted(roomId: number): boolean {
        const store = useChatStore.getState();
        if (store.currentRoomDetail?.room_id === roomId) {
            return store.currentRoomDetail.status === 'deleted';
        }

        return [
            ...store.rooms.direct,
            ...store.rooms.group,
            ...store.rooms.channel,
            ...store.rooms.bot,
        ].some(room => room.room_id === roomId && room.status === 'deleted');
    }

    private resolveDirectRoomBlockState(roomId: number, roomDetail?: RoomDetail): DirectRoomBlockState {
        const store = useChatStore.getState();
        const currentRoomDetail = store.currentRoomDetail?.room_id === roomId
            ? store.currentRoomDetail
            : null;
        const summary = store.rooms.direct.find(room => room.room_id === roomId);
        const blockedByPeer = roomDetail?.blocked_by_peer === true
            || currentRoomDetail?.blocked_by_peer === true
            || summary?.blocked_by_peer === true;
        const blockedByMe = roomDetail?.blocked_by_me === true
            || currentRoomDetail?.blocked_by_me === true
            || summary?.blocked_by_me === true;

        if (blockedByPeer && blockedByMe) return 'blocked_both';
        if (blockedByPeer) return 'blocked_by_peer';
        if (blockedByMe) return 'blocked_by_me';
        return 'none';
    }

    private isDirectRoomBlocked(roomId: number, roomDetail?: RoomDetail): boolean {
        return this.resolveDirectRoomBlockState(roomId, roomDetail) !== 'none';
    }

    private blockedDirectRoomError(roomId: number, roomDetail?: RoomDetail): Error {
        const state = this.resolveDirectRoomBlockState(roomId, roomDetail);
        switch (state) {
            case 'blocked_by_me':
                return new Error('You blocked this user.');
            case 'blocked_by_peer':
                return new Error('You have been blocked by this user.');
            case 'blocked_both':
                return new Error('You cannot send messages in this conversation.');
            default:
                return new Error('You cannot send messages in this conversation.');
        }
    }

    async loadRooms(forceRefresh = false): Promise<void> {
        if (forceRefresh) {
            await chatService.refreshRooms(true);
            return;
        }

        if (this.loadRoomsPromise) {
            return this.loadRoomsPromise;
        }

        const store = useChatStore.getState();
        let promise!: Promise<void>;
        promise = (async () => {
            store.setLoadingRooms(true);
            try {
                await chatService.refreshRooms(false);
            } catch (error) {
                logger.error('Failed to load rooms', error);
                throw error;
            } finally {
                store.setLoadingRooms(false);
                if (this.loadRoomsPromise === promise) {
                    this.loadRoomsPromise = null;
                }
            }
        })();

        this.loadRoomsPromise = promise;
        return promise;
    }

    async setActiveRoom(roomId: number | null): Promise<void> {
        useChatStore.getState().setCurrentRoomId(roomId);
        if (roomId === null) {
            useChatStore.getState().setRoomDetail(null);
            useChatStore.getState().setPendingInvitation(null);
        } else {
            await chatService.ensureRuntimeReady();
            if (!this.isRoomDeleted(roomId)) {
                useChatStore.getState().clearUnreadCount(roomId);
                try {
                    await chatMarkRoomRead(roomId);
                } catch (error) {
                    logger.warn(`Failed to mark room ${roomId} as read during activation`, error);
                }
            }
        }
        await chatSetActiveRoom(roomId);
    }

    async loadRoomDetail(roomId: number, options?: LoadRoomDetailOptions): Promise<RoomDetail> {
        await chatService.ensureRuntimeReady();
        const store = useChatStore.getState();
        const persist = options?.persist !== false;
        const hydrateMessages = options?.hydrateMessages !== false;
        const snapshot = await this.fetchRoomSnapshot(roomId, options?.forceRefresh === true);

        if (!snapshot) {
            throw new Error(`Room ${roomId} is not available.`);
        }

        if (persist) {
            if (hydrateMessages) {
                chatService.hydrateRoomSnapshot(snapshot, { persistDetail: true, replaceMessages: true });
            } else {
                store.setRoomDetail(snapshot);
                store.setDirectKeyStatus(roomId, snapshot.direct_key_status);
            }
        }

        return snapshot;
    }

    async loadMessages(roomId: number, beforeSortKey?: number): Promise<void> {
        await chatService.ensureRuntimeReady();
        const store = useChatStore.getState();
        const cursor = beforeSortKey ?? store.messages[roomId]?.[0]?.sort_key;

        store.setLoadingMessages(true);
        try {
            const snapshot = await this.fetchRoomSnapshot(roomId, false, cursor);
            if (!snapshot) {
                return;
            }

            chatService.hydrateRoomSnapshot(snapshot, {
                persistDetail: store.currentRoomId === roomId || store.currentRoomDetail?.room_id === roomId,
                replaceMessages: false,
            });
        } catch (error) {
            logger.error(`Failed to load messages for room ${roomId}`, error);
            throw error;
        } finally {
            store.setLoadingMessages(false);
        }
    }

    async sendMessage(roomId: number, content: string, type: SendMessageRequest['type'] = 'text'): Promise<void> {
        await chatService.ensureRuntimeReady();
        const store = useChatStore.getState();
        if (this.isRoomDeleted(roomId)) {
            throw new Error('This chat is no longer available.');
        }
        if (this.isDirectRoomBlocked(roomId)) {
            throw this.blockedDirectRoomError(roomId);
        }

        try {
            const pending = await chatSendMessage({ room_id: roomId, content, type });
            store.appendMessage(roomId, pending);
        } catch (error) {
            logger.error(`Failed to send message to room ${roomId}`, error);
            throw error;
        }
    }

    async retryMessage(roomId: number, clientMessageId: string): Promise<void> {
        await chatService.ensureRuntimeReady();
        try {
            const message = await chatRetryMessage({ client_message_id: clientMessageId });
            if (message) {
                useChatStore.getState().updateMessageDelivery(
                    roomId,
                    clientMessageId,
                    message.delivery_status,
                    message.delivery_error,
                    message.message_id,
                );
            }
        } catch (error) {
            logger.error(`Failed to retry message ${clientMessageId}`, error);
            throw error;
        }
    }

    async createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
        try {
            await chatService.ensureRuntimeReady();
            const room = await chatApi.createRoom(req);
            await this.loadRooms(true);
            return room;
        } catch (error) {
            logger.error('Failed to create room', error);
            throw error;
        }
    }

    async joinRoom(roomId: number): Promise<void> {
        try {
            await chatApi.joinRoom(roomId);
            await this.loadRooms(true);
        } catch (error) {
            logger.error(`Failed to join room ${roomId}`, error);
            throw error;
        }
    }

    async markAsRead(roomId: number): Promise<void> {
        if (this.isRoomDeleted(roomId)) return;

        await chatService.ensureRuntimeReady();
        useChatStore.getState().clearUnreadCount(roomId);
        try {
            await chatMarkRoomRead(roomId);
        } catch (error) {
            logger.error(`Failed to mark room ${roomId} as read`, error);
            throw error;
        }
    }

    async loadMyRoomInvitation(roomId: number): Promise<GetMyRoomInvitationResponse | null> {
        await chatService.ensureRuntimeReady();
        try {
            const snapshot = await this.fetchRoomSnapshot(roomId, false);
            const invitation = snapshot?.pending_invitation ?? null;
            useChatStore.getState().setPendingInvitation(invitation?.found ? invitation : null);
            return invitation;
        } catch (error) {
            logger.error(`Failed to load invitation for room ${roomId}`, error);
            useChatStore.getState().setPendingInvitation(null);
            throw error;
        }
    }

    async prepareDirectRoom(roomId: number): Promise<void> {
        await chatService.ensureRuntimeReady();
        const detail = await this.loadRoomDetail(roomId, { persist: true, hydrateMessages: false });
        useChatStore.getState().setDirectKeyStatus(roomId, detail.direct_key_status ?? 'loading');
    }

    async initializeDirectRoomEncryption(roomId: number): Promise<void> {
        await chatService.ensureRuntimeReady();
        const detail = await this.loadRoomDetail(roomId, {
            persist: useChatStore.getState().currentRoomId === roomId,
            hydrateMessages: false,
            forceRefresh: true,
        });
        useChatStore.getState().setDirectKeyStatus(roomId, detail.direct_key_status ?? 'loading');
    }

    async initializeGroupRoomEncryption(roomId: number): Promise<void> {
        await chatService.ensureRuntimeReady();
        await this.loadRoomDetail(roomId, {
            persist: useChatStore.getState().currentRoomId === roomId,
            hydrateMessages: false,
            forceRefresh: true,
        });
    }

    async respondToInvitation(
        invId: number,
        action: 'accept' | 'reject' | 'block',
        ctx?: { roomId: number; roomType: string; inviterUserId?: number },
    ): Promise<void> {
        try {
            await chatApi.respondInvitation(invId, action);
            useChatStore.getState().setPendingInvitation(null);
            await this.loadRooms(true);
            if (ctx?.roomId) {
                await this.loadRoomDetail(ctx.roomId, {
                    persist: useChatStore.getState().currentRoomId === ctx.roomId,
                    hydrateMessages: useChatStore.getState().currentRoomId === ctx.roomId,
                    forceRefresh: true,
                }).catch((error) => {
                    logger.warn(`Failed to refresh room ${ctx.roomId} after invitation response`, error);
                });
            }
        } catch (error) {
            logger.error(`Failed to respond to invitation ${invId}`, error);
            throw error;
        }
    }

    markRoomDeleted(roomId: number): void {
        useChatStore.getState().markRoomDeleted(roomId);
    }

    private async fetchRoomSnapshot(
        roomId: number,
        forceRefresh: boolean,
        beforeSortKey?: number,
    ): Promise<ChatRoomSnapshot | null> {
        const key = `${roomId}:${beforeSortKey ?? 'latest'}:${forceRefresh ? 'force' : 'local'}`;
        const existing = this.roomDetailFetchPromises.get(key);
        if (existing) {
            return existing;
        }

        const request = {
            room_id: roomId,
            ...(beforeSortKey !== undefined ? { before_sort_key: beforeSortKey } : {}),
            ...(forceRefresh ? { force_refresh: true } : {}),
        };

        const promise = (async () => {
            const snapshot = await chatGetRoomSnapshot(request);
            if (!snapshot && !forceRefresh) {
                return chatGetRoomSnapshot({ ...request, force_refresh: true });
            }
            return snapshot;
        })();

        this.roomDetailFetchPromises.set(key, promise);
        try {
            return await promise;
        } finally {
            if (this.roomDetailFetchPromises.get(key) === promise) {
                this.roomDetailFetchPromises.delete(key);
            }
        }
    }
}

export const chatRoomService = new ChatRoomService();
