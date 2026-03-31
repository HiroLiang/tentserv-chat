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
import type { RoomSummary, Message, RoomMember } from '@/types/chat.ts';
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
        id: String(room.room_id),
        type: room.room_type,
        name: room.display_name,
        unreadCount: room.unread_count,
        lastMessage: lastMsg?.content ?? room.latest_message,
        lastMessageTime: lastMsg ? formatTime(lastMsg.created_at) : undefined,
    };
}

function messageToUi(msg: Message, currentParticipantId: number | null, members: RoomMember[]): ChatMessage {
    const myMember = members.find(m => m.participant_id === currentParticipantId);
    const senderMember = members.find(m => m.member_id === msg.sender_id);
    return {
        id: String(msg.message_id),
        chatId: '',
        senderId: String(msg.sender_id),
        senderName: senderMember?.display_name ?? '',
        content: msg.content,
        timestamp: formatTime(msg.created_at),
        isMe: myMember !== undefined && msg.sender_id === myMember.member_id,
    };
}

export const ChatPage = () => {
    const [searchParams] = useSearchParams();
    const roomIdParam = searchParams.get('room_id');

    const { rooms, messages } = useChatStore();
    const currentRoomMembers = useChatStore(s => s.currentRoomDetail?.members ?? []);
    const currentUser = useUserStore(s => s.currentUser);
    const currentParticipantId = useUserStore(s => s.participantId);

    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    useEffect(() => {
        chatRoomService.loadRooms().catch(() => {});
    }, []);

    // Auto-select room from URL param once rooms are loaded
    useEffect(() => {
        if (!roomIdParam) return;
        const allRooms = [...rooms.direct, ...rooms.group, ...rooms.channel, ...rooms.bot];
        const match = allRooms.find(r => String(r.room_id) === roomIdParam);
        if (match) {
            setSelectedChatId(String(match.room_id));
            setSidebarCollapsed(true);
        }
    }, [rooms, roomIdParam]);

    useEffect(() => {
        if (!selectedChatId) return;
        const roomId = Number(selectedChatId);
        chatRoomService.loadRoomDetail(roomId).catch(() => {});
        if (!messages[roomId]) {
            chatRoomService.loadMessages(roomId).catch(() => {});
        }
    }, [selectedChatId]);

    const toGroups = (arr: RoomSummary[]): ChatGroup[] =>
        arr.map(room => {
            const roomMsgs = messages[room.room_id];
            const lastMsg = roomMsgs?.[roomMsgs.length - 1];
            return roomToGroup(room, lastMsg);
        });

    const chatGroups: ChatGroups = {
        direct: toGroups(rooms.direct),
        group: toGroups(rooms.group),
        channel: toGroups(rooms.channel),
        bot: toGroups(rooms.bot),
    };

    const selectedRoomId = selectedChatId ? Number(selectedChatId) : null;

    const currentMessages: ChatMessage[] = selectedRoomId && messages[selectedRoomId]
        ? messages[selectedRoomId].map(m => messageToUi(m, currentParticipantId, currentRoomMembers))
        : [];

    const allChats: ChatGroup[] = [
        ...chatGroups.direct,
        ...chatGroups.group,
        ...chatGroups.channel,
        ...chatGroups.bot,
    ];
    const selectedChat = allChats.find(c => c.id === selectedChatId) ?? null;

    const handleSelectChat = (id: string) => {
        setSelectedChatId(id);
        setSidebarCollapsed(true);
    };

    const handleSendMessage = (content: string) => {
        if (!selectedRoomId || !currentUser) return;
        const myMember = currentRoomMembers.find(m => m.participant_id === currentParticipantId);
        const optimistic: Message = {
            message_id: Date.now(),
            sender_id: myMember?.member_id ?? 0,
            type: 'text',
            content,
            is_edited: false,
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
