export interface ChatGroup {
    id: string;
    type: 'DIRECT' | 'GROUP' | 'CHANNEL' | 'BOT';
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

export const mockChatGroups: ChatGroup[] = [
    {
        id: '1',
        type: 'DIRECT',
        name: 'Alice Chen',
        lastMessage: 'See you tomorrow!',
        lastMessageTime: '10:32',
        unreadCount: 2,
        isOnline: true,
    },
    {
        id: '2',
        type: 'GROUP',
        name: 'Dev Team',
        lastMessage: "Bob: Let's sync at 3pm",
        lastMessageTime: '09:15',
        unreadCount: 5,
        memberCount: 6,
    },
    {
        id: '3',
        type: 'BOT',
        name: 'Goat Assistant',
        lastMessage: 'How can I help you today?',
        lastMessageTime: 'Yesterday',
        unreadCount: 0,
        isOnline: true,
    },
    {
        id: '4',
        type: 'DIRECT',
        name: 'Bob Lin',
        lastMessage: 'Thanks!',
        lastMessageTime: 'Yesterday',
        unreadCount: 0,
        isOnline: false,
    },
    {
        id: '5',
        type: 'GROUP',
        name: 'Weekend Plan',
        lastMessage: "Diana: I'll bring the food",
        lastMessageTime: 'Mon',
        unreadCount: 0,
        memberCount: 4,
    },
];

export const mockMessages: Record<string, ChatMessage[]> = {
    '1': [
        {
            id: 'm1-1',
            chatId: '1',
            senderId: 'alice',
            senderName: 'Alice Chen',
            content: 'Hey! Are you free tomorrow?',
            timestamp: '10:20',
            isMe: false
        },
        {
            id: 'm1-2',
            chatId: '1',
            senderId: 'me',
            senderName: 'Me',
            content: 'Yeah, what time works for you?',
            timestamp: '10:22',
            isMe: true
        },
        {
            id: 'm1-3',
            chatId: '1',
            senderId: 'alice',
            senderName: 'Alice Chen',
            content: 'How about 2pm at the coffee shop?',
            timestamp: '10:25',
            isMe: false
        },
        {
            id: 'm1-4',
            chatId: '1',
            senderId: 'me',
            senderName: 'Me',
            content: 'Sounds perfect!',
            timestamp: '10:28',
            isMe: true
        },
        {
            id: 'm1-5',
            chatId: '1',
            senderId: 'alice',
            senderName: 'Alice Chen',
            content: 'Great!',
            timestamp: '10:30',
            isMe: false
        },
        {
            id: 'm1-6',
            chatId: '1',
            senderId: 'alice',
            senderName: 'Alice Chen',
            content: 'See you tomorrow!',
            timestamp: '10:32',
            isMe: false
        },
    ],
    '2': [
        {
            id: 'm2-1',
            chatId: '2',
            senderId: 'bob',
            senderName: 'Bob Lin',
            content: 'Morning everyone! Sprint review at 10am',
            timestamp: '09:00',
            isMe: false
        },
        {
            id: 'm2-2',
            chatId: '2',
            senderId: 'carol',
            senderName: 'Carol Wu',
            content: 'On it 👍',
            timestamp: '09:02',
            isMe: false
        },
        {
            id: 'm2-3',
            chatId: '2',
            senderId: 'me',
            senderName: 'Me',
            content: "I'll have the demo ready",
            timestamp: '09:05',
            isMe: true
        },
        {
            id: 'm2-4',
            chatId: '2',
            senderId: 'bob',
            senderName: 'Bob Lin',
            content: 'Also, reminder to push your branches before EOD',
            timestamp: '09:10',
            isMe: false
        },
        {
            id: 'm2-5',
            chatId: '2',
            senderId: 'bob',
            senderName: 'Bob Lin',
            content: "Let's sync at 3pm",
            timestamp: '09:15',
            isMe: false
        },
    ],
    '3': [
        {
            id: 'm3-1',
            chatId: '3',
            senderId: 'bot',
            senderName: 'Goat Assistant',
            content: "Hello! I'm Goat Assistant. How can I help you today?",
            timestamp: 'Yesterday',
            isMe: false
        },
        {
            id: 'm3-2',
            chatId: '3',
            senderId: 'me',
            senderName: 'Me',
            content: 'What can you do?',
            timestamp: 'Yesterday',
            isMe: true
        },
        {
            id: 'm3-3',
            chatId: '3',
            senderId: 'bot',
            senderName: 'Goat Assistant',
            content: 'I can answer questions, help with tasks, and have conversations. Just ask me anything!',
            timestamp: 'Yesterday',
            isMe: false
        },
    ],
    '4': [
        {
            id: 'm4-1',
            chatId: '4',
            senderId: 'me',
            senderName: 'Me',
            content: 'Hey Bob, did you get the files I sent?',
            timestamp: 'Yesterday',
            isMe: true
        },
        {
            id: 'm4-2',
            chatId: '4',
            senderId: 'bob',
            senderName: 'Bob Lin',
            content: 'Thanks!',
            timestamp: 'Yesterday',
            isMe: false
        },
    ],
    '5': [
        {
            id: 'm5-1',
            chatId: '5',
            senderId: 'eric',
            senderName: 'Eric Ho',
            content: "Who's coming this weekend?",
            timestamp: 'Mon',
            isMe: false
        },
        { id: 'm5-2', chatId: '5', senderId: 'me', senderName: 'Me', content: "I'm in!", timestamp: 'Mon', isMe: true },
        {
            id: 'm5-3',
            chatId: '5',
            senderId: 'diana',
            senderName: 'Diana Liu',
            content: "I'll bring the food",
            timestamp: 'Mon',
            isMe: false
        },
    ],
};
