export type RoomType = 'direct' | 'group' | 'channel' | 'bot';
export type RoomStatus = 'active' | 'deleted';

// Matches backend ChatRoomSummaryResponse (GET /chat/rooms)
export interface RoomSummary {
    room_id: number;
    room_type: RoomType;
    display_name: string;
    avatar_url?: string;
    status?: RoomStatus;
    latest_message?: string;
    latest_message_sender_id?: number;
    unread_count: number;
    blocked_by_peer?: boolean;
    blocked_by_me?: boolean;
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
    message_id: number;
    sender_id: number;
    type: MessageType;
    content: string;
    reply_to_id?: number;
    is_edited: boolean;
    created_at: string;
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
