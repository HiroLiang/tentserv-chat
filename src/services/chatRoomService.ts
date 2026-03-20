import { chatApi } from '@/api/index.ts';
import { useChatStore } from '@/stores/chatStore.ts';
import { logger } from '@/utils/logger.ts';
import type { CreateRoomRequest, SendMessageRequest } from '@/api/types.ts';
import type { Message } from '@/types/chat.ts';

class ChatRoomService {
    async loadRooms(): Promise<void> {
        const store = useChatStore.getState();
        store.setLoadingRooms(true);
        try {
            const rooms = await chatApi.getRooms();
            store.setRooms(rooms);
        } catch (err) {
            logger.error('Failed to load rooms', err);
            throw err;
        } finally {
            store.setLoadingRooms(false);
        }
    }

    async loadRoomDetail(roomId: number): Promise<void> {
        const store = useChatStore.getState();
        try {
            const detail = await chatApi.getRoomDetail(roomId);
            store.setRoomDetail(detail);
        } catch (err) {
            logger.error(`Failed to load room detail for ${roomId}`, err);
            throw err;
        }
    }

    async loadMessages(roomId: number, beforeId?: number): Promise<void> {
        const store = useChatStore.getState();
        store.setLoadingMessages(true);
        try {
            const { messages, has_more } = await chatApi.getMessages(roomId, beforeId);
            const mapped: Message[] = messages.map((m) => ({
                id: m.id,
                room_id: m.room_id,
                sender_id: m.sender_id,
                sender_name: m.sender_name,
                sender_avatar: m.sender_avatar,
                type: m.type,
                content: m.content,
                reply_to_id: m.reply_to_id,
                created_at: m.created_at,
            }));
            store.prependMessages(roomId, mapped, has_more);
        } catch (err) {
            logger.error(`Failed to load messages for room ${roomId}`, err);
            throw err;
        } finally {
            store.setLoadingMessages(false);
        }
    }

    async sendMessage(roomId: number, content: string, type: SendMessageRequest['type'] = 'text'): Promise<void> {
        try {
            await chatApi.sendMessage(roomId, { type, content });
        } catch (err) {
            logger.error(`Failed to send message to room ${roomId}`, err);
            throw err;
        }
    }

    async createRoom(req: CreateRoomRequest): Promise<number> {
        try {
            const result = await chatApi.createRoom(req);
            return result.id;
        } catch (err) {
            logger.error('Failed to create room', err);
            throw err;
        }
    }

    async joinRoom(roomId: number): Promise<void> {
        try {
            await chatApi.joinRoom(roomId);
        } catch (err) {
            logger.error(`Failed to join room ${roomId}`, err);
            throw err;
        }
    }

    async markAsRead(roomId: number): Promise<void> {
        try {
            await chatApi.markAsRead(roomId);
        } catch (err) {
            logger.error(`Failed to mark room ${roomId} as read`, err);
            throw err;
        }
    }
}

export const chatRoomService = new ChatRoomService();
