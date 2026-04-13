import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Message, PendingInvitation, RoomDetail, RoomSummary } from '@/types/chat.ts';

export const CHAT_ROOMS_UPDATED_EVENT = 'chat:rooms_updated';
export const CHAT_ROOM_UPDATED_EVENT = 'chat:room_updated';
export const CHAT_MESSAGE_DELIVERY_UPDATED_EVENT = 'chat:message_delivery_updated';
export const CHAT_SYNC_STATE_CHANGED_EVENT = 'chat:sync_state_changed';

export interface ChatRuntimeSessionInput {
    api_base_url: string;
    ws_base_url: string;
    token: string;
    account_id: number;
    user_id: number;
    device_id: string;
}

export interface ChatSyncState {
    ws_status: string;
    active_room_id?: number | null;
    pending_business_jobs: number;
    pending_sync_jobs: number;
    last_rooms_sync_at?: string | null;
    last_active_room_sync_at?: string | null;
    self_sender_key_sync_status: string;
    self_sender_key_sync_error?: string | null;
    error?: string | null;
}

export interface ChatRoomsSnapshot {
    participant_id?: number | null;
    rooms: {
        direct: RoomSummary[];
        group: RoomSummary[];
        channel: RoomSummary[];
        bot: RoomSummary[];
    };
    sync_state: ChatSyncState;
}

export interface ChatRoomSnapshot extends RoomDetail {
    has_more: boolean;
    pending_invitation?: PendingInvitation | null;
    direct_key_status: 'loading' | 'locked' | 'unlocked';
    member_count: number;
}

export interface ChatRoomSnapshotRequest {
    room_id: number;
    before_sort_key?: number;
    limit?: number;
    force_refresh?: boolean;
}

export interface ChatSendMessageInput {
    room_id: number;
    content: string;
    type?: 'text' | 'image' | 'file';
}

export interface ChatRetryMessageInput {
    client_message_id: string;
}

export interface ChatDeliveryUpdate {
    room_id: number;
    client_message_id: string;
    delivery_status: 'sent' | 'pending' | 'failed';
    delivery_error?: string | null;
    server_message_id?: number | null;
}

export const chatRuntimeStart = (session: ChatRuntimeSessionInput): Promise<ChatRoomsSnapshot> =>
    invoke<ChatRoomsSnapshot>('chat_runtime_start', { session });

export const chatRuntimeStop = (): Promise<void> =>
    invoke('chat_runtime_stop');

export const chatSetActiveRoom = (roomId: number | null): Promise<void> =>
    invoke('chat_set_active_room', { roomId });

export const chatGetRoomsSnapshot = (forceRefresh = false): Promise<ChatRoomsSnapshot> =>
    invoke<ChatRoomsSnapshot>('chat_get_rooms_snapshot', { forceRefresh });

export const chatGetRoomSnapshot = (
    request: ChatRoomSnapshotRequest,
): Promise<ChatRoomSnapshot | null> =>
    invoke<ChatRoomSnapshot | null>('chat_get_room_snapshot', { request });

export const chatSendMessage = (
    input: ChatSendMessageInput,
): Promise<Message> =>
    invoke<Message>('chat_send_message', { input });

export const chatRetryMessage = (
    input: ChatRetryMessageInput,
): Promise<Message | null> =>
    invoke<Message | null>('chat_retry_message', { input });

export const chatMarkRoomRead = (roomId: number): Promise<void> =>
    invoke('chat_mark_room_read', { roomId });

export const onChatRoomsUpdated = (
    handler: (payload: ChatRoomsSnapshot) => void,
): Promise<UnlistenFn> =>
    listen<ChatRoomsSnapshot>(CHAT_ROOMS_UPDATED_EVENT, (event) => handler(event.payload));

export const onChatRoomUpdated = (
    handler: (payload: ChatRoomSnapshot) => void,
): Promise<UnlistenFn> =>
    listen<ChatRoomSnapshot>(CHAT_ROOM_UPDATED_EVENT, (event) => handler(event.payload));

export const onChatMessageDeliveryUpdated = (
    handler: (payload: ChatDeliveryUpdate) => void,
): Promise<UnlistenFn> =>
    listen<ChatDeliveryUpdate>(CHAT_MESSAGE_DELIVERY_UPDATED_EVENT, (event) => handler(event.payload));

export const onChatSyncStateChanged = (
    handler: (payload: ChatSyncState) => void,
): Promise<UnlistenFn> =>
    listen<ChatSyncState>(CHAT_SYNC_STATE_CHANGED_EVENT, (event) => handler(event.payload));
