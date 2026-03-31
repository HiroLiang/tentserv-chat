import { wsService } from "./wsService.ts";
import { logger } from "@/utils/logger.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import { chatParticipantService } from "./chatParticipantService.ts";
import type { Message, MessageType } from "@/types/chat.ts";

type WsMessagePayload = {
    message_id: number;
    room_id: number;
    sender_id: number;
    content: string;
    type: string;
    reply_to_id?: number;
    created_at: string;
};

class ChatService {
    async initialize(): Promise<void> {
        await chatParticipantService.ensureParticipant();

        wsService.on('chat.message', (payload) => {
            logger.info('New message received:', payload);
            const raw = payload as WsMessagePayload;
            if (raw?.room_id === undefined) return;
            const msg: Message = {
                message_id: raw.message_id,
                sender_id: raw.sender_id,
                type: raw.type as MessageType,
                content: raw.content,
                reply_to_id: raw.reply_to_id,
                is_edited: false,
                created_at: raw.created_at,
            };
            useChatStore.getState().appendMessage(raw.room_id, msg);
        });

        wsService.on('typing_indicator', (payload) => {
            logger.info('Typing indicator received:', payload);
        });
    }

    sendMessage(roomId: number, content: string) {
        wsService.send('chat.send', { room_id: String(roomId), content, type: 'text' });
    }

    sendTyping(roomId: number) {
        wsService.send('typing', { roomId });
    }
}

export const chatService = new ChatService();
