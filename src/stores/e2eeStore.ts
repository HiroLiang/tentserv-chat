import { create } from 'zustand';

export type E2eeBootstrapStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface E2eeState {
    keysUploaded: boolean;
    otpKeyCount: number;
    otpKeyTargetCount: number;
    otpReplenishThreshold: number;
    bootstrapStatus: E2eeBootstrapStatus;
    bootstrapError: string | null;
    // tracks in-flight or already-sent sender key requests: "roomId:provideMemberId"
    senderKeyRequests: Set<string>;

    setKeysUploaded: (v: boolean) => void;
    setOtpKeyCount: (n: number) => void;
    setKeyPolicy: (targetCount: number, replenishThreshold: number) => void;
    setBootstrapStatus: (status: E2eeBootstrapStatus, error?: string | null) => void;
    resetBootstrapState: () => void;
    hasSenderKeyRequest: (roomId: number, providerMemberId: number) => boolean;
    addSenderKeyRequest: (roomId: number, providerMemberId: number) => void;
    removeSenderKeyRequest: (roomId: number, providerMemberId: number) => void;
}

export const useE2eeStore = create<E2eeState>((set, get) => ({
    keysUploaded: false,
    otpKeyCount: 0,
    otpKeyTargetCount: 0,
    otpReplenishThreshold: 0,
    bootstrapStatus: 'idle',
    bootstrapError: null,
    senderKeyRequests: new Set(),

    setKeysUploaded: (v) => set({ keysUploaded: v }),
    setOtpKeyCount: (n) => set({ otpKeyCount: n }),
    setKeyPolicy: (otpKeyTargetCount, otpReplenishThreshold) => set({
        otpKeyTargetCount,
        otpReplenishThreshold,
    }),
    setBootstrapStatus: (bootstrapStatus, bootstrapError = null) => set({
        bootstrapStatus,
        bootstrapError,
    }),
    resetBootstrapState: () => set({
        keysUploaded: false,
        otpKeyCount: 0,
        otpKeyTargetCount: 0,
        otpReplenishThreshold: 0,
        bootstrapStatus: 'idle',
        bootstrapError: null,
        senderKeyRequests: new Set(),
    }),
    hasSenderKeyRequest: (roomId, providerMemberId) =>
        get().senderKeyRequests.has(`${roomId}:${providerMemberId}`),
    addSenderKeyRequest: (roomId, providerMemberId) =>
        set((s) => ({
            senderKeyRequests: new Set(s.senderKeyRequests).add(`${roomId}:${providerMemberId}`),
        })),
    removeSenderKeyRequest: (roomId, providerMemberId) =>
        set((s) => {
            const next = new Set(s.senderKeyRequests);
            next.delete(`${roomId}:${providerMemberId}`);
            return { senderKeyRequests: next };
        }),
}));
