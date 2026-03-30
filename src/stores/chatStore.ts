import { create } from 'zustand';
import type { RoomSummary, RoomDetail, Message, PendingInvitation } from '@/types/chat.ts';

interface RoomsState {
    direct: RoomSummary[];
    group: RoomSummary[];
    channel: RoomSummary[];
    bot: RoomSummary[];
}

type DirectKeyStatus = 'loading' | 'locked' | 'unlocked';

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
    prependMessages: (roomId: number, msgs: Message[], hasMore: boolean) => void;
    appendMessage: (roomId: number, msg: Message) => void;
    setLoadingRooms: (v: boolean) => void;
    setLoadingMessages: (v: boolean) => void;
    setPendingInvitation: (inv: PendingInvitation | null) => void;
    setDirectKeyStatus: (roomId: number, status: DirectKeyStatus) => void;
}

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

    setRooms: (rooms) => set({ rooms }),

    setCurrentRoomId: (id) => set({ currentRoomId: id }),

    setRoomDetail: (detail) => set({ currentRoomDetail: detail }),

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
        })),

    setLoadingRooms: (v) => set({ loadingRooms: v }),

    setLoadingMessages: (v) => set({ loadingMessages: v }),

    setPendingInvitation: (inv) => set({ pendingInvitation: inv }),

    setDirectKeyStatus: (roomId, status) =>
        set((state) => ({
            directKeyStatus: { ...state.directKeyStatus, [roomId]: status },
        })),
}));
