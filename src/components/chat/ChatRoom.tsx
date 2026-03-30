import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChatGroup, ChatMessage } from '@/types/ui';
import { Bot, Lock, Send, Users } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { chatRoomService } from '@/services/chatRoomService';
import { e2eeService } from '@/services/e2eeService';
import { wsService } from '@/services/wsService';
import { InvitationBanner } from './InvitationBanner';

interface ChatRoomProps {
    chat: ChatGroup;
    messages: ChatMessage[];
    onSendMessage: (content: string) => void;
}

const avatarBgClass: Record<ChatGroup['type'], string> = {
    DIRECT: 'bg-primary text-primary-foreground',
    GROUP: 'bg-blue-500 text-white',
    CHANNEL: 'bg-purple-500 text-white',
    BOT: 'bg-amber-500 text-white',
};

const typeLabel: Record<ChatGroup['type'], string> = {
    DIRECT: 'Direct',
    GROUP: 'Group',
    CHANNEL: 'Channel',
    BOT: 'Bot',
};

const typeBadgeClass: Record<ChatGroup['type'], string> = {
    DIRECT: 'bg-primary/10 text-primary',
    GROUP: 'bg-blue-500/10 text-blue-600',
    CHANNEL: 'bg-purple-500/10 text-purple-600',
    BOT: 'bg-amber-500/10 text-amber-600',
};

// Stable color palette for group sender avatars
const senderPalette = [
    'bg-blue-500 text-white',
    'bg-purple-500 text-white',
    'bg-emerald-500 text-white',
    'bg-rose-500 text-white',
    'bg-cyan-500 text-white',
];

const getSenderColor = (senderId: string) => {
    const hash = senderId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return senderPalette[hash % senderPalette.length];
};

const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

function MessageAvatar({ message, chat }: { message: ChatMessage; chat: ChatGroup }) {
    if (chat.type === 'BOT') {
        return (
            <div
                className="h-8 w-8 rounded-full bg-amber-500 text-white flex items-center justify-center flex-shrink-0 self-end">
                <Bot className="h-4 w-4"/>
            </div>
        );
    }
    const colorClass = chat.type === 'GROUP'
        ? getSenderColor(message.senderId)
        : avatarBgClass[chat.type];
    return (
        <div className={cn(
            'h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold self-end',
            colorClass,
        )}>
            {getInitials(message.senderName)}
        </div>
    );
}

function MessageBubble({ message, chat }: { message: ChatMessage; chat: ChatGroup }) {
    const showSenderName = !message.isMe && chat.type === 'GROUP';

    return (
        <div className={cn('flex items-end gap-2', message.isMe ? 'flex-row-reverse' : 'flex-row')}>
            {!message.isMe && <MessageAvatar message={message} chat={chat}/>}

            <div className={cn('flex flex-col max-w-[65%]', message.isMe ? 'items-end' : 'items-start')}>
                {showSenderName && (
                    <span className="text-xs text-muted-foreground mb-1 px-1">{message.senderName}</span>
                )}
                <div className={cn(
                    'px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words',
                    message.isMe
                        ? 'bg-primary text-primary-foreground rounded-tl-2xl rounded-tr-sm rounded-bl-2xl'
                        : 'bg-muted text-foreground rounded-tr-2xl rounded-tl-sm rounded-br-2xl',
                )}>
                    {message.content}
                </div>
                <span className="text-[11px] text-muted-foreground mt-1 px-1">{message.timestamp}</span>
            </div>

            {/* Spacer to mirror avatar width on my side */}
            {message.isMe && <div className="w-8 flex-shrink-0"/>}
        </div>
    );
}

export function ChatRoom({ chat, messages, onSendMessage }: ChatRoomProps) {
    const [input, setInput] = useState('');
    const bottomRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const pendingInvitation = useChatStore((s) => s.pendingInvitation);
    const directKeyStatus = useChatStore((s) => s.directKeyStatus[Number(chat.id)]);
    const isDirectLocked = chat.type === 'DIRECT' && directKeyStatus !== 'unlocked';
    const inputDisabled = (chat.type === 'GROUP' && pendingInvitation?.found === true) || isDirectLocked;

    // Load pending invitation for GROUP; resolve direct key for DIRECT
    useEffect(() => {
        if (chat.type === 'GROUP') {
            void chatRoomService.loadMyRoomInvitation(Number(chat.id));
            useChatStore.getState().setDirectKeyStatus(Number(chat.id), 'unlocked');
        } else if (chat.type === 'DIRECT') {
            useChatStore.getState().setPendingInvitation(null);
            const roomId = Number(chat.id);
            useChatStore.getState().setDirectKeyStatus(roomId, 'loading');
            void e2eeService.resolveDirectKey(roomId).then((unlocked) => {
                useChatStore.getState().setDirectKeyStatus(roomId, unlocked ? 'unlocked' : 'locked');
            });
        } else {
            useChatStore.getState().setPendingInvitation(null);
            useChatStore.getState().setDirectKeyStatus(Number(chat.id), 'unlocked');
        }
    }, [chat.id, chat.type]);

    // Subscribe to WS e2ee.direct_key_ready to auto-unlock when invitee completes handshake
    useEffect(() => {
        if (chat.type !== 'DIRECT') return;
        const roomId = Number(chat.id);
        const handler = (data: unknown) => {
            const payload = data as { room_id?: number };
            if (payload?.room_id === roomId) {
                useChatStore.getState().setDirectKeyStatus(roomId, 'loading');
                void e2eeService.resolveDirectKey(roomId).then((unlocked) => {
                    useChatStore.getState().setDirectKeyStatus(roomId, unlocked ? 'unlocked' : 'locked');
                });
            }
        };
        wsService.on('e2ee.direct_key_ready', handler);
        return () => wsService.off('e2ee.direct_key_ready', handler);
    }, [chat.id, chat.type]);

    // Jump to the bottom instantly when switching chats
    useEffect(() => {
        bottomRef.current?.scrollIntoView();
    }, [chat.id]);

    // Smooth scroll when a new message arrives
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length]);

    const send = () => {
        const text = input.trim();
        if (!text) return;
        onSendMessage(text);
        setInput('');
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
        textareaRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    };

    return (
        <div className="flex flex-col flex-1 min-w-0 h-full">
            {/* Header */}
            <div className="h-14 px-4 flex items-center gap-3 border-b border-border flex-shrink-0 bg-background">
                <div className={cn(
                    'h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-semibold',
                    avatarBgClass[chat.type],
                )}>
                    {chat.type === 'BOT'
                        ? <Bot className="h-5 w-5"/>
                        : chat.type === 'GROUP'
                            ? <Users className="h-5 w-5"/>
                            : getInitials(chat.name)}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate">{chat.name}</span>
                        <span className={cn(
                            'text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0',
                            typeBadgeClass[chat.type],
                        )}>
                            {typeLabel[chat.type]}
                        </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {chat.type === 'GROUP' && `${chat.memberCount} members`}
                        {chat.type === 'DIRECT' && (chat.isOnline ? 'Online' : 'Offline')}
                        {chat.type === 'BOT' && 'AI Assistant'}
                        {chat.type === 'CHANNEL' && 'Channel'}
                    </p>
                </div>
            </div>

            {/* Invitation Banner (GROUP) */}
            {chat.type === 'GROUP' && pendingInvitation?.found && (
                <InvitationBanner
                    invitation={pendingInvitation}
                    onAccept={() => pendingInvitation.invitation_id !== undefined &&
                        void chatRoomService.respondToInvitation(pendingInvitation.invitation_id, 'accept')}
                    onReject={() => pendingInvitation.invitation_id !== undefined &&
                        void chatRoomService.respondToInvitation(pendingInvitation.invitation_id, 'reject')}
                    onBlock={() => pendingInvitation.invitation_id !== undefined &&
                        void chatRoomService.respondToInvitation(pendingInvitation.invitation_id, 'block')}
                />
            )}

            {/* Invitation Banner (DIRECT) */}
            {chat.type === 'DIRECT' && pendingInvitation?.found && pendingInvitation.role === 'invitee' && (
                <InvitationBanner
                    invitation={pendingInvitation}
                    onAccept={() => pendingInvitation.invitation_id !== undefined &&
                        void chatRoomService.respondToInvitation(
                            pendingInvitation.invitation_id,
                            'accept',
                            {
                                roomId: Number(chat.id),
                                roomType: chat.type,
                                inviterUserId: pendingInvitation.inviter_user_id,
                            },
                        )}
                    onReject={() => pendingInvitation.invitation_id !== undefined &&
                        void chatRoomService.respondToInvitation(pendingInvitation.invitation_id, 'reject')}
                    onBlock={() => pendingInvitation.invitation_id !== undefined &&
                        void chatRoomService.respondToInvitation(pendingInvitation.invitation_id, 'block')}
                />
            )}

            {/* Direct chat locked overlay */}
            {chat.type === 'DIRECT' && directKeyStatus === 'locked' && (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-muted/30">
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                        <Lock className="h-6 w-6 text-muted-foreground"/>
                    </div>
                    <p className="text-sm text-muted-foreground">等待對方上線解鎖</p>
                </div>
            )}

            {/* Messages (hidden while locked) */}
            {(!isDirectLocked || directKeyStatus === 'loading') && (
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
                <div className="flex flex-col gap-3">
                    {messages.map((msg) => (
                        <MessageBubble key={msg.id} message={msg} chat={chat}/>
                    ))}
                    <div ref={bottomRef}/>
                </div>
            </div>
            )}

            {/* Input area */}
            <div className="flex-shrink-0 px-4 py-3 border-t border-border bg-background">
                <div className="flex items-end gap-2 bg-muted rounded-2xl px-4 py-2.5">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        placeholder={
                            isDirectLocked
                                ? '等待對方上線解鎖...'
                                : inputDisabled
                                    ? 'Accept the invitation to start chatting...'
                                    : `Message ${chat.name}...`
                        }
                        rows={1}
                        disabled={inputDisabled}
                        className="flex-1 bg-transparent resize-none outline-none text-sm text-foreground placeholder:text-muted-foreground min-h-[24px] max-h-[120px] leading-6 py-1 disabled:cursor-not-allowed"
                    />
                    <button
                        onClick={send}
                        disabled={!input.trim() || inputDisabled}
                        className={cn(
                            'h-8 w-8 self-end inline-flex items-center justify-center rounded-xl transition-colors flex-shrink-0',
                            input.trim() && !inputDisabled
                                ? 'bg-primary text-primary-foreground hover:opacity-90'
                                : 'text-muted-foreground cursor-not-allowed opacity-40',
                        )}
                    >
                        <Send className="h-4 w-4"/>
                    </button>
                </div>
                <p className="text-[11px] text-muted-foreground text-center mt-2">
                    {isDirectLocked
                        ? '聊天室尚未解鎖，請等待對方上線'
                        : inputDisabled
                            ? 'You cannot send messages until the invitation is accepted'
                            : 'Enter to send · Shift+Enter for newline'}
                </p>
            </div>
        </div>
    );
}
