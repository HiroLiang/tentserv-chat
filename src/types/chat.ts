export type RoomType = 'direct' | 'group' | 'channel' | 'bot';
export type RoomStatus = 'active' | 'deleted';
export type PresenceStatus = 'online' | 'offline';
export type DirectKeyStatus = 'loading' | 'locked' | 'unlocked';
export type DeliveryStatus = 'sent' | 'pending' | 'failed';

// Matches backend ChatRoomSummaryResponse (GET /chat/rooms)
export interface RoomSummary {
    room_id: number;
    room_type: RoomType;
    display_name: string;
    avatar_url?: string;
    peer_user_id?: number;
    presence_status?: PresenceStatus;
    last_seen_at?: string;
    status?: RoomStatus;
    latest_message?: string;
    latest_message_id?: number;
    latest_message_created_at?: string;
    latest_message_sender_id?: number;
    latest_message_sender_device_id?: string;
    latest_message_sender_key_version?: number;
    unread_count: number;
    blocked_by_peer?: boolean;
    blocked_by_me?: boolean;
    direct_key_status?: DirectKeyStatus;
    member_count?: number;
}

// Matches backend ChatRoomMemberInfoResponse
export interface RoomMember {
    member_id: number;
    participant_id: number;
    user_id?: number;
    display_name: string;
    avatar_url?: string;
    role: string;
    last_read_at?: string;
    joined_at: string;
}

export type MessageType = 'text' | 'image' | 'file';

// Matches backend ChatMessageInfoResponse
export interface Message {
    client_message_id: string;
    message_id?: number | null;
    sender_id: number;
    sender_device_id: string;
    sender_key_version: number;
    type: MessageType;
    content: string;
    reply_to_id?: number;
    is_edited: boolean;
    is_deleted?: boolean;
    created_at: string;
    sort_key: number;
    delivery_status: DeliveryStatus;
    delivery_error?: string;
    is_local_echo?: boolean;
}

// Matches backend GetChatRoomDetailResponse (GET /chat/room/{id})
export interface RoomDetail {
    room_id: number;
    room_type: RoomType;
    name: string;
    description?: string;
    avatar_url?: string;
    blocked_by_peer?: boolean;
    blocked_by_me?: boolean;
    status?: RoomStatus;
    members: RoomMember[];
    messages: Message[];
    has_more?: boolean;
    pending_invitation?: PendingInvitation | null;
    direct_key_status?: DirectKeyStatus;
    member_count?: number;
}

// Matches backend GetUserChatRoomsResponse (GET /chat/rooms)
export interface GetUserRoomsResponse {
    direct: RoomSummary[];
    group: RoomSummary[];
    channel: RoomSummary[];
    bot: RoomSummary[];
}

export interface PendingInvitation {
    found: boolean;
    invitation_id?: number;
    role?: 'inviter' | 'invitee';
    inviter_name?: string;
    inviter_avatar?: string;
    inviter_user_id?: number;
}
