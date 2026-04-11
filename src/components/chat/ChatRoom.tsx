import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChatGroup, ChatMessage } from '@/types/ui';
import { Bot, Lock, Send, Users } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { chatRoomService } from '@/services/chatRoomService';
import { e2eeService, WAITING_FOR_SENDER_KEY } from '@/services/e2eeService';
import { wsService } from '@/services/wsService';
import { logger } from '@/utils/logger';
import { toast } from 'sonner';
import {
    DIRECT_ROOM_WAITING_HINT,
    DIRECT_ROOM_WAITING_TITLE,
    formatDirectPresenceLabel,
    WAITING_FOR_PEER_KEY_LABEL,
} from '@/utils/chatCopy.ts';
import { InvitationBanner } from './InvitationBanner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.tsx';
import { env } from '@/config/env.ts';

interface ChatRoomProps {
    chat: ChatGroup;
    messages: ChatMessage[];
    onSendMessage: (content: string) => void;
}

const avatarBgClass: Record<ChatGroup['type'], string> = {
    direct: 'bg-primary text-primary-foreground',
    group: 'bg-blue-500 text-white',
    channel: 'bg-purple-500 text-white',
    bot: 'bg-amber-500 text-white',
};

const typeLabel: Record<ChatGroup['type'], string> = {
    direct: 'Direct',
    group: 'Group',
    channel: 'Channel',
    bot: 'Bot',
};

const typeBadgeClass: Record<ChatGroup['type'], string> = {
    direct: 'bg-primary/10 text-primary',
    group: 'bg-blue-500/10 text-blue-600',
    channel: 'bg-purple-500/10 text-purple-600',
    bot: 'bg-amber-500/10 text-amber-600',
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

const getDirectBlockMessage = (blockedByMe: boolean, blockedByPeer: boolean) => {
    if (blockedByMe && blockedByPeer) return 'You cannot send messages in this conversation.';
    if (blockedByMe) return 'You blocked this user.';
    if (blockedByPeer) return 'You have been blocked by this user.';
    return '';
};

function MessageAvatar({ message, chat }: { message: ChatMessage; chat: ChatGroup }) {
    if (chat.type === 'bot') {
        return (
            <div
                className="h-8 w-8 rounded-full bg-amber-500 text-white flex items-center justify-center flex-shrink-0 self-end">
                <Bot className="h-4 w-4"/>
            </div>
        );
    }
    const colorClass = chat.type === 'group'
        ? getSenderColor(message.senderId)
        : avatarBgClass[chat.type];
    const avatarUrl = message.senderAvatarUrl
        ? `${env.API_BASE_URL}/static/${message.senderAvatarUrl}`
        : undefined;
    return (
        <Avatar className="h-8 w-8 flex-shrink-0 self-end">
            {avatarUrl && (
                <AvatarImage
                    src={avatarUrl}
                    alt={`${message.senderName} avatar`}
                    className="object-cover"
                />
            )}
            <AvatarFallback className={cn('text-xs font-semibold', colorClass)}>
                {getInitials(message.senderName)}
            </AvatarFallback>
        </Avatar>
    );
}

function MessageBubble({ message, chat }: { message: ChatMessage; chat: ChatGroup }) {
    const showSenderName = !message.isMe && chat.type === 'group';

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
                    {message.content === WAITING_FOR_SENDER_KEY
                        ? <span className="italic text-muted-foreground flex items-center gap-1">
                            <Lock className="h-3 w-3"/> {WAITING_FOR_PEER_KEY_LABEL}
                          </span>
                        : message.content
                    }
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
    const isDeleted = chat.status === 'deleted';
    const isBlockedByMe = chat.type === 'direct' && !isDeleted && chat.blockedByMe === true;
    const isBlockedByPeer = chat.type === 'direct' && !isDeleted && chat.blockedByPeer === true;
    const hasDirectBlock = chat.type === 'direct' && !isDeleted && (isBlockedByMe || isBlockedByPeer);
    const directBlockMessage = getDirectBlockMessage(isBlockedByMe, isBlockedByPeer);
    const isDirectLocked = chat.type === 'direct' && !isDeleted && !hasDirectBlock && directKeyStatus !== 'unlocked';
    const inputDisabled = isDeleted || hasDirectBlock || (chat.type === 'group' && pendingInvitation?.found === true) || isDirectLocked;
    const directAvatarUrl = chat.type === 'direct' && !isDeleted && chat.avatarUrl
        ? `${env.API_BASE_URL}/static/${chat.avatarUrl}`
        : undefined;

    // Load pending invitation for GROUP; resolve direct key for DIRECT
    useEffect(() => {
        let active = true;
        const setDirectStatus = (status: 'loading' | 'locked' | 'unlocked') => {
            if (!active) return;
            useChatStore.getState().setDirectKeyStatus(Number(chat.id), status);
        };

        if (isDeleted || hasDirectBlock) {
            useChatStore.getState().setPendingInvitation(null);
            setDirectStatus('locked');
        } else if (chat.type === 'group') {
            const roomId = Number(chat.id);
            void (async () => {
                const invitation = await chatRoomService.loadMyRoomInvitation(roomId);
                useChatStore.getState().setDirectKeyStatus(roomId, 'unlocked');
                if (!invitation?.found) {
                    chatRoomService.initializeGroupRoomEncryption(roomId).catch(err =>
                        logger.warn(`Group E2EE init failed for room ${roomId}`, err)
                    );
                }
            })();
        } else if (chat.type === 'direct') {
            const roomId = Number(chat.id);
            void chatRoomService.prepareDirectRoom(roomId).catch((err) => {
                logger.error(`Failed to initialize direct chat state for room ${roomId}`, err);
                toast.error('Unable to verify chat invitation status.', {
                    id: `direct-chat-init-${roomId}`,
                });
                setDirectStatus('locked');
            });
        } else {
            useChatStore.getState().setPendingInvitation(null);
            useChatStore.getState().setDirectKeyStatus(Number(chat.id), 'unlocked');
        }
        return () => {
            active = false;
        };
    }, [chat.id, chat.type, isDeleted, hasDirectBlock]);

    // Subscribe to WS e2ee.direct_key_ready to auto-unlock when invitee completes handshake
    useEffect(() => {
        if (chat.type !== 'direct' || isDeleted || hasDirectBlock) return;
        const roomId = Number(chat.id);
        const handler = (data: unknown) => {
            const payload = data as { room_id?: number };
            if (payload?.room_id === roomId) {
                useChatStore.getState().setDirectKeyStatus(roomId, 'loading');
                void e2eeService.resolveDirectKey(roomId)
                    .then((unlocked) => {
                        useChatStore.getState().setDirectKeyStatus(roomId, unlocked ? 'unlocked' : 'locked');
                        if (unlocked) {
                            e2eeService.resolveMemberSenderKeys(roomId).catch(err =>
                                logger.warn(`Failed to resolve sender keys after unlock for room ${roomId}`, err)
                            );
                        }
                    })
                    .catch((err) => {
                        logger.error(`Failed to refresh direct key status for room ${roomId}`, err);
                        useChatStore.getState().setDirectKeyStatus(roomId, 'locked');
                    });
            }
        };
        wsService.on('e2ee.direct_key_ready', handler);
        return () => wsService.off('e2ee.direct_key_ready', handler);
    }, [chat.id, chat.type, isDeleted, hasDirectBlock]);

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
        if (!text || inputDisabled) return;
        onSendMessage(text);
        setInput('');
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
        textareaRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
        const isComposing = nativeEvent.isComposing || nativeEvent.keyCode === 229;
        if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
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
                <Avatar className="h-9 w-9 flex-shrink-0">
                    {directAvatarUrl && (
                        <AvatarImage
                            src={directAvatarUrl}
                            alt={`${chat.name} avatar`}
                            className="object-cover"
                        />
                    )}
                    <AvatarFallback className={cn(
                        'text-sm font-semibold',
                        isDeleted ? 'bg-zinc-300 text-zinc-600' : avatarBgClass[chat.type],
                    )}>
                        {chat.type === 'bot'
                            ? <Bot className="h-5 w-5"/>
                            : chat.type === 'group'
                                ? <Users className="h-5 w-5"/>
                                : getInitials(chat.name)}
                    </AvatarFallback>
                </Avatar>

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
                        {chat.type === 'group' && `${chat.memberCount} members`}
                        {chat.type === 'direct' && (isDeleted ? 'Deleted' : formatDirectPresenceLabel(chat.presenceStatus, chat.lastSeenAt))}
                        {chat.type === 'bot' && 'AI Assistant'}
                        {chat.type === 'channel' && 'Channel'}
                    </p>
                </div>
            </div>

            {/* Invitation Banner (GROUP) */}
            {chat.type === 'group' && pendingInvitation?.found && (
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
            {chat.type === 'direct' && !isDeleted && !hasDirectBlock && pendingInvitation?.found && pendingInvitation.role === 'invitee' && (
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

            {hasDirectBlock && (
                <div className="px-4 py-2 border-b border-border bg-destructive/10 text-destructive text-sm">
                    {directBlockMessage}
                </div>
            )}

            {/* Direct chat locked overlay */}
            {chat.type === 'direct' && !isDeleted && !hasDirectBlock && directKeyStatus === 'locked' && (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-muted/30">
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                        <Lock className="h-6 w-6 text-muted-foreground"/>
                    </div>
                    <p className="text-sm text-muted-foreground">{DIRECT_ROOM_WAITING_TITLE}</p>
                    <p className="text-xs text-muted-foreground">{DIRECT_ROOM_WAITING_HINT}</p>
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
                            isDeleted
                                ? 'This chat is no longer available.'
                                : hasDirectBlock
                                ? directBlockMessage
                                : isDirectLocked
                                ? DIRECT_ROOM_WAITING_TITLE
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
                    {isDeleted
                        ? 'This chat is no longer available.'
                        : hasDirectBlock
                        ? directBlockMessage
                        : isDirectLocked
                        ? DIRECT_ROOM_WAITING_HINT
                        : inputDisabled
                            ? 'You cannot send messages until the invitation is accepted'
                            : 'Enter to send · Shift+Enter for newline'}
                </p>
            </div>
        </div>
    );
}
