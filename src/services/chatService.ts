import { wsService } from "./wsService.ts";
import { logger } from "@/utils/logger.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import { chatParticipantService } from "./chatParticipantService.ts";
import { e2eeService } from "./e2eeService.ts";
import type { Message, MessageType } from "@/types/chat.ts";

type WsMessagePayload = {
    message_id: number;
    room_id: number;
    sender_id: number; // chat_members.id — matches RoomMember.member_id
    content: string;
    type: string;
    reply_to_id?: number;
    is_edited: boolean;
    is_deleted: boolean;
    created_at: string;
};

// [EN] ChatService is a thin bridge: ensures the participant record exists, then registers
//      'chat.message' and 'typing_indicator' WebSocket handlers to update the chat store.
// [中] ChatService 為薄橋接層：確保 participant 記錄存在後，註冊 'chat.message' 與 'typing_indicator' WS 事件。
// [日] ChatService は薄いブリッジ層：participant レコードの存在を確認し、
//      'chat.message' と 'typing_indicator' の WebSocket ハンドラを登録してチャットストアを更新する。
class ChatService {
    private handlersRegistered = false;

    // [EN] initialize: create participant record if missing, then wire WS event handlers.
    //      Handler registration is idempotent — handlers are only added once regardless of
    //      how many times initialize() is called (e.g. once at startup, once per manual login).
    // [中] initialize：若缺少 participant 記錄則建立，再綁定 WS 事件處理器。
    //      處理器只會註冊一次，多次呼叫 initialize() 不會造成重複。
    // [日] initialize：participant レコードが未存在なら作成し、WS イベントハンドラを接続する。
    //      ハンドラは一度だけ登録される（何度 initialize() を呼んでも重複しない）。
    async initialize(): Promise<void> {
        await chatParticipantService.ensureParticipant();

        if (this.handlersRegistered) return;
        this.handlersRegistered = true;

        wsService.on('chat.message', async (payload) => {
            logger.info('New message received:', payload);
            const raw = payload as WsMessagePayload;
            if (raw?.room_id === undefined) return;
            const content = await e2eeService.decryptMessage(raw.content, raw.sender_id).catch(() => raw.content);
            const msg: Message = {
                message_id: raw.message_id,
                sender_id: raw.sender_id,
                type: raw.type as MessageType,
                content,
                reply_to_id: raw.reply_to_id,
                is_edited: raw.is_edited ?? false,
                created_at: raw.created_at,
            };
            useChatStore.getState().appendMessage(raw.room_id, msg);
        });

        wsService.on('typing_indicator', (payload) => {
            logger.info('Typing indicator received:', payload);
        });
    }

    sendTyping(roomId: number) {
        wsService.send('typing', { roomId });
    }
}

export const chatService = new ChatService();
