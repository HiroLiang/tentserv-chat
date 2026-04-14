import { create } from 'zustand';
import type { Message, PendingInvitation, PresenceStatus, RoomDetail, RoomSummary } from '@/types/chat.ts';
import {
    normalizeRoomSummaryPreview,
    WAITING_FOR_PEER_KEY_LABEL,
    WAITING_FOR_SENDER_KEY_LABEL,
    WAITING_FOR_SENDER_KEY_SENTINEL,
} from '@/utils/chatCopy.ts';
import type { ChatSyncState } from '@/bridge/chat.ts';

type StructuredSelfSenderKeySyncState = NonNullable<ChatSyncState['self_sender_key_sync']>;

interface RoomsState {
    direct: RoomSummary[];
    group: RoomSummary[];
    channel: RoomSummary[];
    bot: RoomSummary[];
}

type DirectKeyStatus = 'loading' | 'locked' | 'unlocked';

const ROOM_SECTION_KEYS: Array<keyof RoomsState> = ['direct', 'group', 'channel', 'bot'];

const getRoomActivityTime = (room: RoomSummary): number => {
    if (!room.latest_message_created_at) return Number.NEGATIVE_INFINITY;
    const timestamp = Date.parse(room.latest_message_created_at);
    return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
};

const sortRoomSummaries = (rooms: RoomSummary[]): RoomSummary[] =>
    [...rooms].sort((left, right) => getRoomActivityTime(right) - getRoomActivityTime(left));

const sortRoomsState = (rooms: RoomsState): RoomsState => ({
    direct: sortRoomSummaries(rooms.direct),
    group: sortRoomSummaries(rooms.group),
    channel: sortRoomSummaries(rooms.channel),
    bot: sortRoomSummaries(rooms.bot),
});

const hasText = (value?: string | null): value is string =>
    typeof value === 'string' && value.trim().length > 0;

const isWaitingRoomPreview = (value?: string | null): boolean =>
    value === WAITING_FOR_SENDER_KEY_SENTINEL
    || value === WAITING_FOR_SENDER_KEY_LABEL
    || value === WAITING_FOR_PEER_KEY_LABEL;

const flattenRoomsState = (rooms: RoomsState): Map<number, RoomSummary> => {
    const entries = new Map<number, RoomSummary>();
    for (const key of ROOM_SECTION_KEYS) {
        for (const room of rooms[key]) {
            entries.set(room.room_id, room);
        }
    }
    return entries;
};

const normalizeIncomingRoomSummary = (room: RoomSummary): RoomSummary => ({
    ...room,
    latest_message: hasText(room.latest_message)
        ? normalizeRoomSummaryPreview(room.room_type, room.latest_message)
        : room.latest_message,
});

const mergeRoomSummary = (
    previous: RoomSummary | undefined,
    incoming: RoomSummary,
): RoomSummary => {
    const normalized = normalizeIncomingRoomSummary(incoming);
    const incomingLatestMessage = hasText(normalized.latest_message)
        ? normalized.latest_message
        : previous?.latest_message;
    const shouldPreservePreviousDecryptedPreview = Boolean(
        previous
        && normalized.latest_message_id !== undefined
        && previous.latest_message_id === normalized.latest_message_id
        && hasText(previous.latest_message)
        && !isWaitingRoomPreview(previous.latest_message)
        && isWaitingRoomPreview(incomingLatestMessage),
    );

    return {
        ...previous,
        ...normalized,
        display_name: hasText(normalized.display_name)
            ? normalized.display_name.trim()
            : previous?.display_name ?? normalized.display_name,
        avatar_url: normalized.avatar_url ?? previous?.avatar_url,
        latest_message: shouldPreservePreviousDecryptedPreview
            ? previous?.latest_message
            : incomingLatestMessage,
        latest_message_id: normalized.latest_message_id ?? previous?.latest_message_id,
        latest_message_created_at: normalized.latest_message_created_at ?? previous?.latest_message_created_at,
        latest_message_sender_id: normalized.latest_message_sender_id ?? previous?.latest_message_sender_id,
        latest_message_sender_device_id: normalized.latest_message_sender_device_id ?? previous?.latest_message_sender_device_id,
        latest_message_sender_key_version: normalized.latest_message_sender_key_version ?? previous?.latest_message_sender_key_version,
        presence_status: normalized.presence_status ?? previous?.presence_status,
        last_seen_at: normalized.last_seen_at ?? previous?.last_seen_at,
        direct_key_status: normalized.direct_key_status ?? previous?.direct_key_status,
        member_count: normalized.member_count ?? previous?.member_count,
        blocked_by_peer: normalized.blocked_by_peer ?? previous?.blocked_by_peer,
        blocked_by_me: normalized.blocked_by_me ?? previous?.blocked_by_me,
    };
};

const mergeRoomsState = (previous: RoomsState, next: RoomsState): RoomsState => {
    const previousById = flattenRoomsState(previous);
    return ROOM_SECTION_KEYS.reduce((acc, key) => {
        acc[key] = next[key].map((room) => mergeRoomSummary(previousById.get(room.room_id), room));
        return acc;
    }, {} as RoomsState);
};

const updateRoomSummariesForMessage = (
    rooms: RoomsState,
    roomId: number,
    msg: Message,
): RoomsState => {
    const nextSections = ROOM_SECTION_KEYS.reduce((acc, key) => {
        const updated = rooms[key].map((room) => {
            if (room.room_id !== roomId) return room;
            if (room.status === 'deleted') return room;

            return {
                ...room,
                latest_message: normalizeRoomSummaryPreview(room.room_type, msg.content),
                latest_message_id: msg.message_id ?? room.latest_message_id,
                latest_message_created_at: msg.created_at,
                latest_message_sender_id: msg.sender_id,
                latest_message_sender_device_id: msg.sender_device_id,
                latest_message_sender_key_version: msg.sender_key_version,
                unread_count: room.unread_count,
            };
        });
        acc[key] = sortRoomSummaries(updated);
        return acc;
    }, {} as RoomsState);

    return nextSections;
};

interface ChatState {
    rooms: RoomsState;
    currentRoomId: number | null;
    currentRoomDetail: RoomDetail | null;
    messages: Record<number, Message[]>;
    hasMore: Record<number, boolean>;
    loadingRooms: boolean;
    loadingMessages: boolean;
    pendingInvitation: PendingInvitation | null;
    directKeyStatus: Record<number, DirectKeyStatus>;
    syncState: ChatSyncState | null;
    runtimeStatus: 'idle' | 'starting' | 'ready' | 'degraded' | 'failed';
    runtimeError: string | null;

    setRooms: (rooms: RoomsState) => void;
    setCurrentRoomId: (id: number | null) => void;
    setRoomDetail: (detail: RoomDetail | null) => void;
    setMessages: (roomId: number, msgs: Message[], hasMore: boolean) => void;
    prependMessages: (roomId: number, msgs: Message[], hasMore: boolean) => void;
    appendMessage: (roomId: number, msg: Message) => void;
    updateMessageDelivery: (
        roomId: number,
        clientMessageId: string,
        deliveryStatus: Message['delivery_status'],
        deliveryError?: string | null,
        messageId?: number | null,
    ) => void;
    clearUnreadCount: (roomId: number) => void;
    setLoadingRooms: (v: boolean) => void;
    setLoadingMessages: (v: boolean) => void;
    setPendingInvitation: (inv: PendingInvitation | null) => void;
    setDirectKeyStatus: (roomId: number, status: DirectKeyStatus) => void;
    setSyncState: (syncState: ChatSyncState | null) => void;
    setRuntimeStatus: (status: ChatState['runtimeStatus'], error?: string | null) => void;
    updateDirectRoomPresence: (peerUserId: number, status: PresenceStatus, lastSeenAt?: string) => void;
    markRoomDeleted: (roomId: number) => void;
    resetChat: () => void;
}

const messageIdentity = (message: Message): string => {
    if (message.message_id !== undefined && message.message_id !== null) {
        return `server:${message.message_id}`;
    }
    if (message.client_message_id) {
        return `client:${message.client_message_id}`;
    }
    return `${message.sender_id}:${message.created_at}:${message.content}`;
};

const sortMessages = (messages: Message[]): Message[] =>
    [...messages].sort((left, right) => {
        if (left.sort_key === right.sort_key) {
            return left.created_at.localeCompare(right.created_at);
        }
        return left.sort_key - right.sort_key;
    });

const mergeMessages = (existing: Message[], incoming: Message[]): Message[] => {
    const merged = new Map<string, Message>();
    for (const message of existing) {
        merged.set(messageIdentity(message), message);
    }
    for (const message of incoming) {
        merged.set(messageIdentity(message), message);
    }
    return sortMessages([...merged.values()]);
};

const normalizeMessages = (messages: Message[]): Message[] => mergeMessages([], messages);

const collectDirectKeyStatuses = (rooms: RoomsState): Record<number, DirectKeyStatus> => {
    const statuses: Record<number, DirectKeyStatus> = {};
    for (const room of rooms.direct) {
        if (room.direct_key_status) {
            statuses[room.room_id] = room.direct_key_status;
        }
    }
    return statuses;
};

const mergeSyncState = (
    previous: ChatSyncState | null,
    next: ChatSyncState | null,
): ChatSyncState | null => {
    if (!next) {
        return null;
    }
    if (next.self_sender_key_sync !== undefined && next.self_sender_key_sync !== null) {
        return next;
    }
    if (previous?.self_sender_key_sync) {
        return {
            ...next,
            self_sender_key_sync: {
                ...previous.self_sender_key_sync,
                status: (next.self_sender_key_sync_status as StructuredSelfSenderKeySyncState['status'])
                    || previous.self_sender_key_sync.status,
                last_error: next.self_sender_key_sync_error ?? previous.self_sender_key_sync.last_error ?? null,
            },
        };
    }
    return {
        ...next,
        self_sender_key_sync: next.self_sender_key_sync ?? null,
    };
};

// [EN] chatStore (Zustand): central chat state.
//      rooms: categorized room lists (direct/group/channel/bot).
//      messages: keyed by roomId, supports pagination via prependMessages (older) / appendMessage (new WS messages).
//      directKeyStatus: tracks E2EE key exchange state per direct room ('loading'|'locked'|'unlocked').
//      pendingInvitation: current user's pending room invitation.
// [中] chatStore（Zustand）：中央聊天狀態。
//      rooms 依類型分類（direct/group/channel/bot）；messages 以 roomId 為鍵，支援分頁（舊訊息 prepend，新 WS 訊息 append）。
//      directKeyStatus 追蹤每個直接聊天室的 E2EE 金鑰交換狀態；pendingInvitation 為當前待處理邀請。
// [日] chatStore（Zustand）：チャットの中央状態。
//      rooms はタイプ別（direct/group/channel/bot）；messages は roomId をキーにページネーション対応
//      （古いメッセージは prepend、新 WS メッセージは append）。
//      directKeyStatus は各ダイレクトルームの E2EE 鍵交換状態を追跡；pendingInvitation は保留中の招待。
export const useChatStore = create<ChatState>((set) => ({
    rooms: { direct: [], group: [], channel: [], bot: [] },
    currentRoomId: null,
    currentRoomDetail: null,
    messages: {},
    hasMore: {},
    loadingRooms: false,
    loadingMessages: false,
    pendingInvitation: null,
    directKeyStatus: {},
    syncState: null,
    runtimeStatus: 'idle',
    runtimeError: null,

    setRooms: (rooms) => set((state) => {
        const mergedRooms = mergeRoomsState(state.rooms, rooms);
        return {
            rooms: sortRoomsState(mergedRooms),
        directKeyStatus: {
            ...state.directKeyStatus,
                ...collectDirectKeyStatuses(mergedRooms),
        },
        };
    }),

    setCurrentRoomId: (id) => set({ currentRoomId: id }),

    setRoomDetail: (detail) => set((state) => ({
        currentRoomDetail: detail,
        pendingInvitation: detail?.pending_invitation ?? null,
        directKeyStatus: detail
            ? {
                ...state.directKeyStatus,
                [detail.room_id]: detail.direct_key_status ?? state.directKeyStatus[detail.room_id] ?? 'loading',
            }
            : state.directKeyStatus,
    })),

    setMessages: (roomId, msgs, hasMore) =>
        set((state) => {
            const nextMessages = normalizeMessages(msgs);
            return {
                messages: {
                    ...state.messages,
                    [roomId]: nextMessages,
                },
                hasMore: {
                    ...state.hasMore,
                    [roomId]: hasMore,
                },
                currentRoomDetail: state.currentRoomDetail?.room_id === roomId
                    ? {
                        ...state.currentRoomDetail,
                        messages: nextMessages,
                        has_more: hasMore,
                    }
                    : state.currentRoomDetail,
            };
        }),

    prependMessages: (roomId, msgs, hasMore) =>
        set((state) => {
            const nextMessages = mergeMessages(state.messages[roomId] ?? [], msgs);
            return {
                messages: {
                    ...state.messages,
                    [roomId]: nextMessages,
                },
                hasMore: {
                    ...state.hasMore,
                    [roomId]: hasMore,
                },
                currentRoomDetail: state.currentRoomDetail?.room_id === roomId
                    ? {
                        ...state.currentRoomDetail,
                        messages: nextMessages,
                        has_more: hasMore,
                    }
                    : state.currentRoomDetail,
            };
        }),

    appendMessage: (roomId, msg) =>
        set((state) => {
            const nextMessages = mergeMessages(state.messages[roomId] ?? [], [msg]);
            return {
                messages: {
                    ...state.messages,
                    [roomId]: nextMessages,
                },
                rooms: updateRoomSummariesForMessage(
                    state.rooms,
                    roomId,
                    msg,
                ),
                currentRoomDetail: state.currentRoomDetail?.room_id === roomId
                    ? {
                        ...state.currentRoomDetail,
                        messages: nextMessages,
                    }
                    : state.currentRoomDetail,
            };
        }),

    updateMessageDelivery: (roomId, clientMessageId, deliveryStatus, deliveryError, messageId) =>
        set((state) => {
            const nextMessages = normalizeMessages((state.messages[roomId] ?? []).map((message) => (
                message.client_message_id === clientMessageId
                    ? {
                        ...message,
                        delivery_status: deliveryStatus,
                        delivery_error: deliveryError ?? undefined,
                        message_id: messageId ?? message.message_id,
                        is_local_echo: deliveryStatus !== 'sent',
                    }
                    : message
            )));

            return {
                messages: {
                    ...state.messages,
                    [roomId]: nextMessages,
                },
                currentRoomDetail: state.currentRoomDetail?.room_id === roomId
                    ? {
                        ...state.currentRoomDetail,
                        messages: nextMessages,
                    }
                    : state.currentRoomDetail,
            };
        }),

    clearUnreadCount: (roomId) =>
        set((state) => {
            const updateArr = (arr: RoomSummary[]) =>
                arr.map(r => r.room_id === roomId ? { ...r, unread_count: 0 } : r);
            return {
                rooms: {
                    direct: updateArr(state.rooms.direct),
                    group: updateArr(state.rooms.group),
                    channel: updateArr(state.rooms.channel),
                    bot: updateArr(state.rooms.bot),
                },
            };
        }),

    setLoadingRooms: (v) => set({ loadingRooms: v }),

    setLoadingMessages: (v) => set({ loadingMessages: v }),

    setPendingInvitation: (inv) => set({ pendingInvitation: inv }),

    setDirectKeyStatus: (roomId, status) =>
        set((state) => ({
            directKeyStatus: { ...state.directKeyStatus, [roomId]: status },
        })),

    setSyncState: (syncState) => set((state) => ({
        syncState: mergeSyncState(state.syncState, syncState),
    })),

    setRuntimeStatus: (runtimeStatus, runtimeError = null) => set({ runtimeStatus, runtimeError }),

    updateDirectRoomPresence: (peerUserId, status, lastSeenAt) =>
        set((state) => ({
            rooms: {
                ...state.rooms,
                direct: state.rooms.direct.map((room) => (
                    room.peer_user_id === peerUserId
                        ? {
                            ...room,
                            presence_status: status,
                            last_seen_at: status === 'online' ? undefined : lastSeenAt,
                        }
                        : room
                )),
            },
        })),

    markRoomDeleted: (roomId) =>
        set((state) => {
            const markSummary = (room: RoomSummary): RoomSummary =>
                room.room_id === roomId
                    ? {
                        ...room,
                        status: 'deleted',
                        display_name: 'Deleted Contact',
                        avatar_url: undefined,
                        unread_count: 0,
                    }
                    : room;

            const currentRoomDetail = state.currentRoomDetail?.room_id === roomId
                ? {
                    ...state.currentRoomDetail,
                    status: 'deleted' as const,
                    name: 'Deleted Contact',
                    avatar_url: undefined,
                }
                : state.currentRoomDetail;

            return {
                rooms: {
                    direct: state.rooms.direct.map(markSummary),
                    group: state.rooms.group.map(markSummary),
                    channel: state.rooms.channel.map(markSummary),
                    bot: state.rooms.bot.map(markSummary),
                },
                currentRoomDetail,
                directKeyStatus: { ...state.directKeyStatus, [roomId]: 'locked' },
            };
        }),

    resetChat: () => set({
        rooms: { direct: [], group: [], channel: [], bot: [] },
        currentRoomId: null,
        currentRoomDetail: null,
        messages: {},
        hasMore: {},
        pendingInvitation: null,
        directKeyStatus: {},
        syncState: null,
        runtimeStatus: 'idle',
        runtimeError: null,
    }),
}));
