import { wsService } from "./wsService.ts";
import { logger } from "@/utils/logger.ts";
import { useChatStore } from "@/stores/chatStore.ts";
import { useE2eeStore } from "@/stores/e2eeStore.ts";
import { chatParticipantService } from "./chatParticipantService.ts";
import { chatRoomService } from "./chatRoomService.ts";
import { e2eeService } from "./e2eeService.ts";
import { e2eeApi } from "@/api/index.ts";
import type { Message, MessageType } from "@/types/chat.ts";
import type { DirectKeyReadyPayload, SenderKeyDistributionAvailablePayload } from "@/api/types.ts";

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
        if (useE2eeStore.getState().bootstrapStatus !== 'ready') {
            logger.warn('Skipping chat initialization until E2EE bootstrap is ready', {
                bootstrapStatus: useE2eeStore.getState().bootstrapStatus,
            });
            return;
        }

        await chatParticipantService.ensureParticipant();

        if (this.handlersRegistered) return;
        this.handlersRegistered = true;

        wsService.on('chat.message', async (payload) => {
            logger.info('New message received:', payload);
            const raw = payload as WsMessagePayload;
            if (raw?.room_id === undefined) return;
            const content = await e2eeService.decryptMessage(raw.content, raw.sender_id, raw.room_id).catch(() => raw.content);
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

        wsService.on('e2ee.sender_key_distribution_available', this.handleSenderKeyDistributionAvailable.bind(this));
        wsService.on('e2ee.direct_key_ready', this.handleDirectKeyReady.bind(this));

        this.fulfillPendingE2EEState().catch(() => {});
    }

    private async handleSenderKeyDistributionAvailable(payload: unknown): Promise<void> {
        const raw = payload as SenderKeyDistributionAvailablePayload;
        if (!raw?.room_id) return;
        try {
            await e2eeService.resolveMemberSenderKeys(raw.room_id);
            const unlocked = await e2eeService.resolveDirectKey(raw.room_id).catch(() => false);
            if (useChatStore.getState().directKeyStatus[raw.room_id] !== undefined) {
                useChatStore.getState().setDirectKeyStatus(raw.room_id, unlocked ? 'unlocked' : 'locked');
            }
        } catch (err) {
            logger.error(`Failed to handle e2ee.sender_key_distribution_available for room ${raw.room_id}`, err);
        }
    }

    // [EN] handleDirectKeyReady: called when the backend notifies that the provider has uploaded
    //      their sender key. Resolves the direct key and updates the room's E2EE status.
    // [中] handleDirectKeyReady：後端通知 provider 已上傳 sender key 時呼叫。
    //      重新解析 direct key 並更新房間 E2EE 狀態。
    private async handleDirectKeyReady(payload: unknown): Promise<void> {
        const raw = payload as DirectKeyReadyPayload;
        if (!raw?.room_id) return;
        try {
            const unlocked = await e2eeService.resolveDirectKey(raw.room_id);
            useChatStore.getState().setDirectKeyStatus(raw.room_id, unlocked ? 'unlocked' : 'locked');
            logger.info(`Direct key ready for room ${raw.room_id}: ${unlocked ? 'unlocked' : 'locked'}`);
        } catch (err) {
            logger.error(`Failed to handle e2ee.direct_key_ready for room ${raw.room_id}`, err);
        }
    }

    // [EN] fulfillPendingE2EEState: on startup, loads all rooms and re-initializes E2EE for any
    //      direct/group room where the local sender key is missing from the backend. This recovers
    //      the case where a sender_key_needed WS event was missed while the device was offline.
    // [中] fulfillPendingE2EEState：啟動時載入所有房間，對後端缺少本地 sender key 的 direct/group 房間
    //      重新初始化 E2EE，用於恢復離線期間遺失的 sender_key_needed 事件。
    private async fulfillPendingE2EEState(): Promise<void> {
        try {
            await chatRoomService.loadRooms();
        } catch {
            return;
        }
        const rooms = useChatStore.getState().rooms;
        const encryptedRooms = [...rooms.direct, ...rooms.group];
        for (const room of encryptedRooms) {
            try {
                const status = await e2eeApi.getSenderKeyDistributionStatus(room.room_id);
                if (!status.own_sender_key_exists) {
                    if (room.room_type === 'direct') {
                        await chatRoomService.initializeDirectRoomEncryption(room.room_id);
                    } else {
                        await chatRoomService.initializeGroupRoomEncryption(room.room_id);
                    }
                } else {
                    // Consume any available distributions first.
                    await e2eeService.resolveMemberSenderKeys(room.room_id).catch(() => {});
                    // Request sender keys from members we still don't have keys for.
                    const refreshed = await e2eeApi.getSenderKeyDistributionStatus(room.room_id).catch(() => null);
                    if (refreshed) {
                        const e2eeStore = useE2eeStore.getState();
                        for (const memberID of (refreshed.pending_from_members ?? [])) {
                            if (e2eeStore.hasSenderKeyRequest(room.room_id, memberID)) continue;
                            e2eeStore.addSenderKeyRequest(room.room_id, memberID);
                            await e2eeApi.createSenderKeyRequest(room.room_id, memberID).catch(() => {});
                        }
                    }
                }
            } catch {
                // best-effort; skip this room
            }
        }
    }

    sendTyping(roomId: number) {
        wsService.send('typing', { roomId });
    }
}

export const chatService = new ChatService();
