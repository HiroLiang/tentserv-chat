import { create } from 'zustand';

interface E2eeState {
    keysUploaded: boolean;
    otpKeyCount: number;
    otpKeyTargetCount: number;
    otpReplenishThreshold: number;
    // tracks in-flight or already-sent sender key requests: "roomId:provideMemberId"
    senderKeyRequests: Set<string>;

    setKeysUploaded: (v: boolean) => void;
    setOtpKeyCount: (n: number) => void;
    setKeyPolicy: (targetCount: number, replenishThreshold: number) => void;
    hasSenderKeyRequest: (roomId: number, providerMemberId: number) => boolean;
    addSenderKeyRequest: (roomId: number, providerMemberId: number) => void;
}

export const useE2eeStore = create<E2eeState>((set, get) => ({
    keysUploaded: false,
    otpKeyCount: 0,
    otpKeyTargetCount: 0,
    otpReplenishThreshold: 0,
    senderKeyRequests: new Set(),

    setKeysUploaded: (v) => set({ keysUploaded: v }),
    setOtpKeyCount: (n) => set({ otpKeyCount: n }),
    setKeyPolicy: (otpKeyTargetCount, otpReplenishThreshold) => set({
        otpKeyTargetCount,
        otpReplenishThreshold,
    }),
    hasSenderKeyRequest: (roomId, providerMemberId) =>
        get().senderKeyRequests.has(`${roomId}:${providerMemberId}`),
    addSenderKeyRequest: (roomId, providerMemberId) =>
        set((s) => ({
            senderKeyRequests: new Set(s.senderKeyRequests).add(`${roomId}:${providerMemberId}`),
        })),
}));
