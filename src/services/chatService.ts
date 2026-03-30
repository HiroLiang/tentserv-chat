import { wsService } from "./wsService.ts";
import { logger } from "@/utils/logger.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import { chatParticipantService } from "./chatParticipantService.ts";
import type { Message } from "@/types/chat.ts";

class ChatService {
    async initialize(): Promise<void> {
        await chatParticipantService.ensureParticipant();

        wsService.on('new_message', (payload) => {
            logger.info('New message received:', payload);
            const msg = payload as Message;
            if (msg?.room_id !== undefined) {
                useChatStore.getState().appendMessage(msg.room_id, msg);
            }
        });

        wsService.on('typing_indicator', (payload) => {
            logger.info('Typing indicator received:', payload);
        });
    }

    sendMessage(roomId: number, content: string) {
        wsService.send('chat_message', { roomId, content });
    }

    sendTyping(roomId: number) {
        wsService.send('typing', { roomId });
    }
}

export const chatService = new ChatService();
