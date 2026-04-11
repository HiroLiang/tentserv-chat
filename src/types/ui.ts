import type { PresenceStatus, RoomStatus } from '@/types/chat.ts';

export interface ChatGroup {
    id: string;
    type: 'direct' | 'group' | 'channel' | 'bot';
    name: string;
    avatarUrl?: string;
    status?: RoomStatus;
    lastMessage?: string;
    lastMessageTime?: string;
    unreadCount?: number;
    peerUserId?: number;
    presenceStatus?: PresenceStatus;
    lastSeenAt?: string;
    memberCount?: number;
    isOnline?: boolean;
    blockedByPeer?: boolean;
    blockedByMe?: boolean;
}

export interface ChatMessage {
    id: string;
    chatId: string;
    senderId: string;
    senderName: string;
    senderAvatarUrl?: string;
    content: string;
    timestamp: string;
    isMe: boolean;
}
