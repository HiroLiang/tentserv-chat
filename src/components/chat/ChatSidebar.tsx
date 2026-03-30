import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChatGroup } from '@/types/ui';
import { Bot, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MessageSquare, Users } from 'lucide-react';

export interface ChatGroups {
    DIRECT: ChatGroup[];
    GROUP: ChatGroup[];
    CHANNEL: ChatGroup[];
    BOT: ChatGroup[];
}

interface ChatSidebarProps {
    chatGroups: ChatGroups;
    selectedChatId: string | null;
    onSelectChat: (id: string) => void;
    collapsed: boolean;
    onToggleCollapse: () => void;
}

const avatarBgClass: Record<ChatGroup['type'], string> = {
    DIRECT: 'bg-primary text-primary-foreground',
    GROUP: 'bg-blue-500 text-white',
    CHANNEL: 'bg-purple-500 text-white',
    BOT: 'bg-amber-500 text-white',
};

const SECTION_LABELS: Record<ChatGroup['type'], string> = {
    DIRECT: 'Direct',
    GROUP: 'Groups',
    CHANNEL: 'Channels',
    BOT: 'Bots',
};

const SECTION_ORDER: ChatGroup['type'][] = ['DIRECT', 'GROUP', 'CHANNEL', 'BOT'];

const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

function ChatAvatar({ chat }: { chat: ChatGroup }) {
    return (
        <div className={cn(
            'h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-sm relative',
            avatarBgClass[chat.type],
        )}>
            {chat.type === 'GROUP'
                ? <Users className="h-5 w-5"/>
                : chat.type === 'BOT'
                    ? <Bot className="h-5 w-5"/>
                    : getInitials(chat.name)}

            {chat.type !== 'GROUP' && (
                <span className={cn(
                    'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background',
                    chat.isOnline ? 'bg-green-500' : 'bg-zinc-400',
                )}/>
            )}
        </div>
    );
}

export function ChatSidebar({
    chatGroups,
    selectedChatId,
    onSelectChat,
    collapsed,
    onToggleCollapse,
}: ChatSidebarProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [expanded, setExpanded] = useState<Record<ChatGroup['type'], boolean>>({
        DIRECT: true,
        GROUP: true,
        CHANNEL: true,
        BOT: true,
    });

    const toggleSection = (type: ChatGroup['type']) => {
        setExpanded(prev => ({ ...prev, [type]: !prev[type] }));
    };

    // All chats flattened for collapsed avatar-only mode
    const allChats = SECTION_ORDER.flatMap(type => chatGroups[type]);

    const filteredBySection = (type: ChatGroup['type']) =>
        chatGroups[type].filter(chat =>
            chat.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
        );

    return (
        <div className={cn(
            'flex flex-col h-full border-r border-border bg-sidebar-bg flex-shrink-0',
            'transition-[width] duration-300 ease-in-out overflow-hidden',
            collapsed ? 'w-16' : 'w-72',
        )}>
            {/* Header */}
            <div className={cn(
                'h-14 flex items-center border-b border-border flex-shrink-0',
                collapsed ? 'justify-center px-2' : 'px-4 justify-between',
            )}>
                {!collapsed && (
                    <div className="flex items-center gap-2 text-foreground">
                        <MessageSquare className="h-4 w-4"/>
                        <span className="font-semibold text-sm">Chats</span>
                    </div>
                )}
                <button
                    onClick={onToggleCollapse}
                    className="rounded-md p-1.5 hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    {collapsed
                        ? <ChevronRight className="h-4 w-4"/>
                        : <ChevronLeft className="h-4 w-4"/>}
                </button>
            </div>

            {!collapsed && (
                <div className="px-2 py-2 border-b border-border">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search chats..."
                        className="w-full rounded-md border border-input bg-background px-3 py-2
                        text-sm text-foreground placeholder:text-muted-foreground
                        outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                </div>
            )}

            {/* Chat list */}
            <div className="flex-1 min-h-0 overflow-y-auto py-2 px-2">
                {collapsed ? (
                    // Collapsed: show all avatars flat
                    allChats.map((chat) => (
                        <button
                            key={chat.id}
                            onClick={() => onSelectChat(chat.id)}
                            title={chat.name}
                            className={cn(
                                'w-full rounded-lg p-2 transition-colors text-left',
                                'hover:bg-accent flex items-center justify-center',
                                selectedChatId === chat.id && 'bg-accent',
                            )}
                        >
                            <div className="relative">
                                <ChatAvatar chat={chat}/>
                                {!!chat.unreadCount && chat.unreadCount > 0 && (
                                    <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                                        {chat.unreadCount > 9 ? '9+' : chat.unreadCount}
                                    </span>
                                )}
                            </div>
                        </button>
                    ))
                ) : (
                    // Expanded: collapsible sections per type
                    SECTION_ORDER.map((type) => {
                        const items = filteredBySection(type);
                        if (items.length === 0) return null;
                        return (
                            <div key={type} className="mb-1">
                                <button
                                    onClick={() => toggleSection(type)}
                                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-xs font-semibold uppercase tracking-wide">
                                            {SECTION_LABELS[type]}
                                        </span>
                                        <span className="text-[10px] font-medium bg-muted rounded-full px-1.5 py-0.5">
                                            {items.length}
                                        </span>
                                    </div>
                                    {expanded[type]
                                        ? <ChevronUp className="h-3 w-3"/>
                                        : <ChevronDown className="h-3 w-3"/>}
                                </button>

                                {expanded[type] && items.map((chat) => (
                                    <button
                                        key={chat.id}
                                        onClick={() => onSelectChat(chat.id)}
                                        className={cn(
                                            'w-full rounded-lg p-2 transition-colors text-left',
                                            'hover:bg-accent flex items-center gap-3',
                                            selectedChatId === chat.id && 'bg-accent',
                                        )}
                                    >
                                        <ChatAvatar chat={chat}/>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-1">
                                                <span className="font-medium text-sm truncate">{chat.name}</span>
                                                <span className="text-xs text-muted-foreground flex-shrink-0">{chat.lastMessageTime}</span>
                                            </div>
                                            <div className="flex items-center justify-between gap-1 mt-0.5">
                                                <span className="text-xs text-muted-foreground truncate">{chat.lastMessage}</span>
                                                {!!chat.unreadCount && chat.unreadCount > 0 && (
                                                    <span className="h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                                                        {chat.unreadCount}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
