import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar.tsx';
import { ChatSidebar } from '@/components/chat/ChatSidebar.tsx';
import type { ChatGroups } from '@/components/chat/ChatSidebar.tsx';
import { ChatRoom } from '@/components/chat/ChatRoom.tsx';
import { mockChatGroups, mockMessages } from '@/mock/chat.ts';
import type { ChatGroup, ChatMessage } from '@/mock/chat';
import { MessageSquare } from 'lucide-react';

// TODO: set to false / remove when API is stable
const USE_MOCK = true;

function buildMockGroups(): ChatGroups {
    return {
        DIRECT: mockChatGroups.filter(c => c.type === 'DIRECT'),
        GROUP: mockChatGroups.filter(c => c.type === 'GROUP'),
        CHANNEL: mockChatGroups.filter(c => c.type === 'CHANNEL'),
        BOT: mockChatGroups.filter(c => c.type === 'BOT'),
    };
}

export const ChatPage = () => {
    // searchParams.get('user_id') — TODO: use to auto-select or create direct room
    const [searchParams] = useSearchParams();
    void searchParams;

const [chatGroups, _setChatGroups] = useState<ChatGroups>(USE_MOCK ? buildMockGroups() : {
        DIRECT: [],
        GROUP: [],
        CHANNEL: [],
        BOT: []
    });
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [messages, setMessages] = useState<Record<string, ChatMessage[]>>(USE_MOCK ? mockMessages : {});

    const handleSelectChat = (id: string) => {
        setSelectedChatId(id);
        setSidebarCollapsed(true);
    };

    const handleSendMessage = (content: string) => {
        if (!selectedChatId) return;
        const newMsg: ChatMessage = {
            id: `msg-${Date.now()}`,
            chatId: selectedChatId,
            senderId: 'me',
            senderName: 'Me',
            content,
            timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
            isMe: true,
        };
        setMessages(prev => ({
            ...prev,
            [selectedChatId]: [...(prev[selectedChatId] ?? []), newMsg],
        }));
    };

    const allChats: ChatGroup[] = [
        ...chatGroups.DIRECT,
        ...chatGroups.GROUP,
        ...chatGroups.CHANNEL,
        ...chatGroups.BOT,
    ];
    const selectedChat = allChats.find(c => c.id === selectedChatId) ?? null;

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
                        messages={messages[selectedChatId!] ?? []}
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
