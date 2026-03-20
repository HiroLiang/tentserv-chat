export type RoomType = 'DIRECT' | 'GROUP' | 'CHANNEL' | 'BOT';

export interface RoomSummary {
    id: number;
    type: RoomType;
    name: string;
    description?: string;
    avatar_url?: string;
    member_count?: number;
    allow_agent: boolean;
    created_at: string;
}

export interface RoomMember {
    member_id: number;
    user_id: number;
    name: string;
    avatar?: string;
    role: string;
    last_read_at?: string;
}

export type MessageType = 'text' | 'image' | 'file';

export interface Message {
    id: number;
    room_id: number;
    sender_id: number;
    sender_name: string;
    sender_avatar?: string;
    type: MessageType;
    content: string;
    reply_to_id?: number;
    created_at: string;
}

export interface RoomDetail extends RoomSummary {
    members: RoomMember[];
    messages: Message[];
}

export interface GetUserRoomsResponse {
    direct: RoomSummary[];
    group: RoomSummary[];
    channel: RoomSummary[];
    bot: RoomSummary[];
}
