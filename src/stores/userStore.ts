import { create } from 'zustand';
import { User } from "@/types/user.ts";

interface UserState {
    currentUser: User | null;
    recordedUsers: Map<number, User>;
    participantId: number | null;

    setCurrentUser: (user: User | null) => void;
    setParticipantId: (id: number | null) => void;
}

export const useUserStore = create<UserState>((set) => ({
    currentUser: { id: 0 },
    recordedUsers: new Map(),
    participantId: null,

    setCurrentUser: (user: User | null) => {
        set((state) => ({
            currentUser: user ? {
                ...state.currentUser,
                ...user,
            } : null,
            recordedUsers: user
                ? new Map(state.recordedUsers).set(user.id, user)
                : state.recordedUsers,
        }));
    },

    setParticipantId: (id) => set({ participantId: id }),
}));