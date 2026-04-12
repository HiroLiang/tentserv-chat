import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar.tsx';
import { ChatSidebar } from '@/components/chat/ChatSidebar.tsx';
import type { ChatGroups } from '@/components/chat/ChatSidebar.tsx';
import { ChatRoom } from '@/components/chat/ChatRoom.tsx';
import { Button } from '@/components/ui/button.tsx';
import { useChatStore } from '@/stores/chatStore.ts';
import { useUserStore } from '@/stores/userStore.ts';
import { chatRoomService } from '@/services/chatRoomService.ts';
import type { ChatGroup, ChatMessage } from '@/types/ui.ts';
import type { RoomSummary, Message, RoomMember } from '@/types/chat.ts';
import { logger } from '@/utils/logger.ts';
import { MessageSquare } from 'lucide-react';

const EMPTY_ROOM_MEMBERS: RoomMember[] = [];

interface ChatPageErrorBoundaryProps {
    children: ReactNode;
}

interface ChatPageErrorBoundaryState {
    hasError: boolean;
}

class ChatPageErrorBoundary extends Component<ChatPageErrorBoundaryProps, ChatPageErrorBoundaryState> {
    state: ChatPageErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(): ChatPageErrorBoundaryState {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        logger.error('Chat page render failed', {
            message: error.message,
            stack: error.stack,
            componentStack: info.componentStack,
        });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col h-screen overflow-hidden">
                    <Navbar/>
                    <div className="flex flex-1 items-center justify-center px-6">
                        <div className="max-w-md text-center space-y-3">
                            <h2 className="text-lg font-semibold text-foreground">Chat room failed to load</h2>
                            <p className="text-sm text-muted-foreground">
                                Something went wrong. Reload the page and try again.
                            </p>
                            <div className="flex items-center justify-center gap-3">
                                <Button onClick={() => window.location.reload()}>
                                    Reload Page
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

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
    const isDeleted = room.status === 'deleted';
    const lastActivityAt = lastMsg?.created_at ?? room.latest_message_created_at;
    return {
        id: String(room.room_id),
        type: room.room_type,
        name: isDeleted ? 'Deleted Contact' : room.display_name,
        avatarUrl: isDeleted ? undefined : room.avatar_url,
        peerUserId: room.peer_user_id,
        presenceStatus: room.presence_status,
        lastSeenAt: room.last_seen_at,
        status: room.status ?? 'active',
        unreadCount: isDeleted ? 0 : room.unread_count,
        lastMessage: lastMsg?.content ?? room.latest_message,
        lastMessageTime: lastActivityAt ? formatTime(lastActivityAt) : undefined,
        lastActivityAt,
        isOnline: room.room_type === 'direct' ? room.presence_status === 'online' : undefined,
        blockedByPeer: room.blocked_by_peer === true,
        blockedByMe: room.blocked_by_me === true,
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
        senderAvatarUrl: senderMember?.avatar_url,
        content: msg.content,
        timestamp: formatTime(msg.created_at),
        isMe: myMember !== undefined && msg.sender_id === myMember.member_id,
    };
}

const ChatPageContent = () => {
    const [searchParams] = useSearchParams();
    const roomIdParam = searchParams.get('room_id');

    const { rooms, messages } = useChatStore();
    const currentRoomDetail = useChatStore((s) => s.currentRoomDetail);
    const setCurrentRoomId = useChatStore((s) => s.setCurrentRoomId);
    const currentUser = useUserStore(s => s.currentUser);
    const currentParticipantId = useUserStore(s => s.participantId);
    const currentRoomMembers = currentRoomDetail?.members ?? EMPTY_ROOM_MEMBERS;

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

    const selectedRoomStatus = selectedChatId
        ? [
            ...rooms.direct,
            ...rooms.group,
            ...rooms.channel,
            ...rooms.bot,
        ].find(room => room.room_id === Number(selectedChatId))?.status ?? 'active'
        : undefined;

    useEffect(() => {
        if (!selectedChatId) return;
        const roomId = Number(selectedChatId);
        if (selectedRoomStatus === 'deleted') return;

        chatRoomService.loadRoomDetail(roomId, { persist: true, hydrateMessages: true }).catch(() => {});
        chatRoomService.markAsRead(roomId).catch(() => {});
    }, [selectedChatId, selectedRoomStatus]);

    useEffect(() => {
        setCurrentRoomId(selectedChatId ? Number(selectedChatId) : null);
        return () => setCurrentRoomId(null);
    }, [selectedChatId, setCurrentRoomId]);

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
        if (selectedChat?.status === 'deleted') return;
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

export const ChatPage = () => (
    <ChatPageErrorBoundary>
        <ChatPageContent/>
    </ChatPageErrorBoundary>
);
