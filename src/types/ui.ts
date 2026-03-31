export interface ChatGroup {
    id: string;
    type: 'direct' | 'group' | 'channel' | 'bot';
    name: string;
    lastMessage?: string;
    lastMessageTime?: string;
    unreadCount?: number;
    memberCount?: number;
    isOnline?: boolean;
}

export interface ChatMessage {
    id: string;
    chatId: string;
    senderId: string;
    senderName: string;
    content: string;
    timestamp: string;
    isMe: boolean;
}
