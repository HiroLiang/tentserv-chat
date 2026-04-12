import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChatGroup } from '@/types/ui';
import { Bot, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MessageSquare, Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.tsx';
import { env } from '@/config/env.ts';

export interface ChatGroups {
    direct: ChatGroup[];
    group: ChatGroup[];
    channel: ChatGroup[];
    bot: ChatGroup[];
}

interface ChatSidebarProps {
    chatGroups: ChatGroups;
    selectedChatId: string | null;
    onSelectChat: (id: string) => void;
    collapsed: boolean;
    onToggleCollapse: () => void;
}

const avatarBgClass: Record<ChatGroup['type'], string> = {
    direct: 'bg-primary text-primary-foreground',
    group: 'bg-blue-500 text-white',
    channel: 'bg-purple-500 text-white',
    bot: 'bg-amber-500 text-white',
};

const SECTION_LABELS: Record<ChatGroup['type'], string> = {
    direct: 'Direct',
    group: 'Groups',
    channel: 'Channels',
    bot: 'Bots',
};

const SECTION_ORDER: ChatGroup['type'][] = ['direct', 'group', 'channel', 'bot'];
const SIDEBAR_ACTIVITY_ANIMATION_MS = 420;
const SIDEBAR_REORDER_TRANSITION = 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)';

const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

function ChatAvatar({ chat }: { chat: ChatGroup }) {
    const isDeleted = chat.status === 'deleted';
    const directAvatarUrl = chat.type === 'direct' && !isDeleted && chat.avatarUrl
        ? `${env.API_BASE_URL}/static/${chat.avatarUrl}`
        : undefined;

    return (
        <div className="relative h-10 w-10 flex-shrink-0">
            <Avatar className="h-10 w-10">
                {directAvatarUrl && (
                    <AvatarImage
                        src={directAvatarUrl}
                        alt={`${chat.name} avatar`}
                        className="object-cover"
                    />
                )}
                <AvatarFallback className={cn(
                    'font-semibold text-sm',
                    isDeleted ? 'bg-zinc-300 text-zinc-600' : avatarBgClass[chat.type],
                )}>
                    {chat.type === 'group'
                        ? <Users className="h-5 w-5"/>
                        : chat.type === 'bot'
                            ? <Bot className="h-5 w-5"/>
                            : getInitials(chat.name)}
                </AvatarFallback>
            </Avatar>

            {chat.type === 'direct' && !isDeleted && (
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
    const itemRefs = useRef(new Map<string, HTMLDivElement>());
    const previousRectsRef = useRef(new Map<string, DOMRect>());
    const previousActivityRef = useRef(new Map<string, string | undefined>());
    const activityTimeoutsRef = useRef(new Map<string, number>());
    const [activeChatIds, setActiveChatIds] = useState<string[]>([]);
    const [expanded, setExpanded] = useState<Record<ChatGroup['type'], boolean>>({
        direct: true,
        group: true,
        channel: true,
        bot: true,
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

    const visibleChats = useMemo(() => (
        collapsed
            ? allChats.map((chat) => ({ id: chat.id, activityAt: chat.lastActivityAt }))
            : SECTION_ORDER.flatMap((type) =>
                expanded[type]
                    ? filteredBySection(type).map((chat) => ({ id: chat.id, activityAt: chat.lastActivityAt }))
                    : []
            )
    ), [allChats, collapsed, expanded, searchQuery, chatGroups]);

    const visibleSignature = visibleChats
        .map((chat, index) => `${index}:${chat.id}:${chat.activityAt ?? ''}`)
        .join('|');

    const registerItemRef = (chatId: string) => (node: HTMLDivElement | null) => {
        if (node) {
            itemRefs.current.set(chatId, node);
            return;
        }
        itemRefs.current.delete(chatId);
    };

    useEffect(() => () => {
        activityTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        activityTimeoutsRef.current.clear();
    }, []);

    useLayoutEffect(() => {
        const nextRects = new Map<string, DOMRect>();
        visibleChats.forEach((chat) => {
            const node = itemRefs.current.get(chat.id);
            if (node) {
                nextRects.set(chat.id, node.getBoundingClientRect());
            }
        });

        nextRects.forEach((rect, chatId) => {
            const previousRect = previousRectsRef.current.get(chatId);
            if (!previousRect) return;
            const deltaY = previousRect.top - rect.top;
            if (Math.abs(deltaY) < 1) return;

            const node = itemRefs.current.get(chatId);
            if (!node) return;

            node.style.transition = 'none';
            node.style.transform = `translateY(${deltaY}px)`;
            node.style.zIndex = '1';

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    node.style.transition = SIDEBAR_REORDER_TRANSITION;
                    node.style.transform = 'translateY(0)';
                });
            });

            window.setTimeout(() => {
                if (!itemRefs.current.has(chatId)) return;
                node.style.transition = '';
                node.style.transform = '';
                node.style.zIndex = '';
            }, 320);
        });

        const bumpedChatIds = visibleChats
            .filter((chat) => {
                const previousActivityAt = previousActivityRef.current.get(chat.id);
                return previousActivityAt !== undefined
                    && chat.activityAt !== undefined
                    && previousActivityAt !== chat.activityAt;
            })
            .map((chat) => chat.id);

        if (bumpedChatIds.length > 0) {
            setActiveChatIds((currentIds) => Array.from(new Set([...currentIds, ...bumpedChatIds])));
            bumpedChatIds.forEach((chatId) => {
                const existingTimeout = activityTimeoutsRef.current.get(chatId);
                if (existingTimeout !== undefined) {
                    window.clearTimeout(existingTimeout);
                }
                const timeoutId = window.setTimeout(() => {
                    setActiveChatIds((currentIds) => currentIds.filter((currentId) => currentId !== chatId));
                    activityTimeoutsRef.current.delete(chatId);
                }, SIDEBAR_ACTIVITY_ANIMATION_MS);
                activityTimeoutsRef.current.set(chatId, timeoutId);
            });
        }

        previousRectsRef.current = nextRects;
        previousActivityRef.current = new Map(
            visibleChats.map((chat) => [chat.id, chat.activityAt]),
        );
    }, [visibleSignature]);

    const renderChatItem = (chat: ChatGroup, compact = false) => {
        const isActive = activeChatIds.includes(chat.id);

        if (compact) {
            return (
                <div
                    key={chat.id}
                    ref={registerItemRef(chat.id)}
                    className="sidebar-chat-item"
                >
                    <button
                        onClick={() => onSelectChat(chat.id)}
                        title={chat.name}
                        data-chat-card-id={chat.id}
                        data-activity-state={isActive ? 'active' : 'idle'}
                        className={cn(
                            'sidebar-chat-card w-full rounded-lg p-2 transition-colors text-left',
                            'hover:bg-accent flex items-center justify-center',
                            selectedChatId === chat.id && 'bg-accent',
                            isActive && 'sidebar-chat-card--active',
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
                </div>
            );
        }

        return (
            <div
                key={chat.id}
                ref={registerItemRef(chat.id)}
                className="sidebar-chat-item"
            >
                <button
                    onClick={() => onSelectChat(chat.id)}
                    data-chat-card-id={chat.id}
                    data-activity-state={isActive ? 'active' : 'idle'}
                    className={cn(
                        'sidebar-chat-card w-full rounded-lg p-2 transition-colors text-left',
                        'hover:bg-accent flex items-center gap-3',
                        selectedChatId === chat.id && 'bg-accent',
                        isActive && 'sidebar-chat-card--active',
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
            </div>
        );
    };

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
                    allChats.map((chat) => renderChatItem(chat, true))
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

                                {expanded[type] && items.map((chat) => renderChatItem(chat))}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
