import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar.tsx';
import { ChatSidebar } from '@/components/chat/ChatSidebar.tsx';
import type { ChatGroups } from '@/components/chat/ChatSidebar.tsx';
import { ChatRoom } from '@/components/chat/ChatRoom.tsx';
import { useChatStore } from '@/stores/chatStore.ts';
import { useUserStore } from '@/stores/userStore.ts';
import { chatRoomService } from '@/services/chatRoomService.ts';
import type { ChatGroup, ChatMessage } from '@/types/ui.ts';
import type { RoomSummary, Message } from '@/types/chat.ts';
import { MessageSquare } from 'lucide-react';

function formatTime(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    if (diffDays < 7) {
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function roomToGroup(room: RoomSummary, lastMsg?: Message): ChatGroup {
    return {
        id: String(room.id),
        type: room.type,
        name: room.name,
        memberCount: room.member_count,
        lastMessage: lastMsg?.content,
        lastMessageTime: lastMsg ? formatTime(lastMsg.created_at) : undefined,
    };
}

function messageToUi(msg: Message, currentUserId: number): ChatMessage {
    return {
        id: String(msg.id),
        chatId: String(msg.room_id),
        senderId: String(msg.sender_id),
        senderName: msg.sender_name,
        content: msg.content,
        timestamp: formatTime(msg.created_at),
        isMe: msg.sender_id === currentUserId,
    };
}

export const ChatPage = () => {
    const [searchParams] = useSearchParams();
    const roomIdParam = searchParams.get('room_id');

    const { rooms, messages } = useChatStore();
    const currentUser = useUserStore(s => s.currentUser);

    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    useEffect(() => {
        chatRoomService.loadRooms().catch(() => {});
    }, []);

    // Auto-select room from URL param once rooms are loaded
    useEffect(() => {
        if (!roomIdParam) return;
        const allRooms = [...rooms.direct, ...rooms.group, ...rooms.channel, ...rooms.bot];
        const match = allRooms.find(r => String(r.id) === roomIdParam);
        if (match) {
            setSelectedChatId(String(match.id));
            setSidebarCollapsed(true);
        }
    }, [rooms, roomIdParam]);

    useEffect(() => {
        if (!selectedChatId) return;
        const roomId = Number(selectedChatId);
        if (!messages[roomId]) {
            chatRoomService.loadMessages(roomId).catch(() => {});
        }
    }, [selectedChatId]);

    const toGroups = (arr: RoomSummary[]): ChatGroup[] =>
        arr.map(room => {
            const roomMsgs = messages[room.id];
            const lastMsg = roomMsgs?.[roomMsgs.length - 1];
            return roomToGroup(room, lastMsg);
        });

    const chatGroups: ChatGroups = {
        DIRECT: toGroups(rooms.direct),
        GROUP: toGroups(rooms.group),
        CHANNEL: toGroups(rooms.channel),
        BOT: toGroups(rooms.bot),
    };

    const selectedRoomId = selectedChatId ? Number(selectedChatId) : null;

    const currentMessages: ChatMessage[] = selectedRoomId && messages[selectedRoomId]
        ? messages[selectedRoomId].map(m => messageToUi(m, currentUser?.id ?? 0))
        : [];

    const allChats: ChatGroup[] = [
        ...chatGroups.DIRECT,
        ...chatGroups.GROUP,
        ...chatGroups.CHANNEL,
        ...chatGroups.BOT,
    ];
    const selectedChat = allChats.find(c => c.id === selectedChatId) ?? null;

    const handleSelectChat = (id: string) => {
        setSelectedChatId(id);
        setSidebarCollapsed(true);
    };

    const handleSendMessage = (content: string) => {
        if (!selectedRoomId || !currentUser) return;
        const optimistic: Message = {
            id: Date.now(),
            room_id: selectedRoomId,
            sender_id: currentUser.id,
            sender_name: currentUser.name ?? 'Me',
            type: 'text',
            content,
            created_at: new Date().toISOString(),
        };
        useChatStore.getState().appendMessage(selectedRoomId, optimistic);
        chatRoomService.sendMessage(selectedRoomId, content).catch(() => {});
    };

    return (
        <div className="flex flex-col h-screen overflow-hidden">
            <Navbar/>
            <div className="flex flex-1 overflow-hidden">
                <ChatSidebar
                    chatGroups={chatGroups}
                    selectedChatId={selectedChatId}
                    onSelectChat={handleSelectChat}
                    collapsed={sidebarCollapsed}
                    onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
                />
                {selectedChat ? (
                    <ChatRoom
                        chat={selectedChat}
                        messages={currentMessages}
                        onSendMessage={handleSendMessage}
                    />
                ) : (
                    <div
                        className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground select-none">
                        <MessageSquare className="h-12 w-12 opacity-20"/>
                        <p className="text-sm">Select a conversation to start</p>
                    </div>
                )}
            </div>
        </div>
    );
};
