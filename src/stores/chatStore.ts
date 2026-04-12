import { create } from 'zustand';
import type { Message, PendingInvitation, PresenceStatus, RoomDetail, RoomSummary } from '@/types/chat.ts';
import { normalizeRoomSummaryPreview } from '@/utils/chatCopy.ts';

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

const updateRoomSummariesForMessage = (
    rooms: RoomsState,
    roomId: number,
    msg: Message,
    isCurrentRoom: boolean,
): RoomsState => {
    const nextSections = ROOM_SECTION_KEYS.reduce((acc, key) => {
        const updated = rooms[key].map((room) => {
            if (room.room_id !== roomId) return room;
            if (room.status === 'deleted') return room;

            return {
                ...room,
                latest_message: normalizeRoomSummaryPreview(room.room_type, msg.content),
                latest_message_created_at: msg.created_at,
                latest_message_sender_id: msg.sender_id,
                unread_count: isCurrentRoom ? room.unread_count : room.unread_count + 1,
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

    setRooms: (rooms: RoomsState) => void;
    setCurrentRoomId: (id: number | null) => void;
    setRoomDetail: (detail: RoomDetail | null) => void;
    setMessages: (roomId: number, msgs: Message[], hasMore: boolean) => void;
    prependMessages: (roomId: number, msgs: Message[], hasMore: boolean) => void;
    appendMessage: (roomId: number, msg: Message) => void;
    clearUnreadCount: (roomId: number) => void;
    setLoadingRooms: (v: boolean) => void;
    setLoadingMessages: (v: boolean) => void;
    setPendingInvitation: (inv: PendingInvitation | null) => void;
    setDirectKeyStatus: (roomId: number, status: DirectKeyStatus) => void;
    updateDirectRoomPresence: (peerUserId: number, status: PresenceStatus, lastSeenAt?: string) => void;
    markRoomDeleted: (roomId: number) => void;
    resetChat: () => void;
}

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

    setRooms: (rooms) => set({ rooms: sortRoomsState(rooms) }),

    setCurrentRoomId: (id) => set({ currentRoomId: id }),

    setRoomDetail: (detail) => set({ currentRoomDetail: detail }),

    setMessages: (roomId, msgs, hasMore) =>
        set((state) => ({
            messages: {
                ...state.messages,
                [roomId]: [...msgs],
            },
            hasMore: {
                ...state.hasMore,
                [roomId]: hasMore,
            },
        })),

    prependMessages: (roomId, msgs, hasMore) =>
        set((state) => ({
            messages: {
                ...state.messages,
                [roomId]: [...msgs, ...(state.messages[roomId] ?? [])],
            },
            hasMore: {
                ...state.hasMore,
                [roomId]: hasMore,
            },
        })),

    appendMessage: (roomId, msg) =>
        set((state) => ({
            messages: {
                ...state.messages,
                [roomId]: [...(state.messages[roomId] ?? []), msg],
            },
            rooms: updateRoomSummariesForMessage(
                state.rooms,
                roomId,
                msg,
                state.currentRoomId === roomId,
            ),
        })),

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
    }),
}));
