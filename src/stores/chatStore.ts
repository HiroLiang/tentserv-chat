import { create } from 'zustand';
import type { RoomSummary, RoomDetail, Message } from '@/types/chat.ts';

interface RoomsState {
    direct: RoomSummary[];
    group: RoomSummary[];
    channel: RoomSummary[];
    bot: RoomSummary[];
}

interface ChatState {
    rooms: RoomsState;
    currentRoomId: number | null;
    currentRoomDetail: RoomDetail | null;
    messages: Record<number, Message[]>;
    hasMore: Record<number, boolean>;
    loadingRooms: boolean;
    loadingMessages: boolean;

    setRooms: (rooms: RoomsState) => void;
    setCurrentRoomId: (id: number | null) => void;
    setRoomDetail: (detail: RoomDetail | null) => void;
    prependMessages: (roomId: number, msgs: Message[], hasMore: boolean) => void;
    appendMessage: (roomId: number, msg: Message) => void;
    setLoadingRooms: (v: boolean) => void;
    setLoadingMessages: (v: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
    rooms: { direct: [], group: [], channel: [], bot: [] },
    currentRoomId: null,
    currentRoomDetail: null,
    messages: {},
    hasMore: {},
    loadingRooms: false,
    loadingMessages: false,

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
}));
