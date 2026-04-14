import { create } from 'zustand';

export type E2eeBootstrapStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface E2eeState {
    keysUploaded: boolean;
    otpKeyCount: number;
    otpKeyTargetCount: number;
    otpReplenishThreshold: number;
    bootstrapStatus: E2eeBootstrapStatus;
    bootstrapError: string | null;
    // tracks in-flight or already-sent sender key requests: "roomId:senderMemberId"
    senderKeyRequests: Set<string>;

    setKeysUploaded: (v: boolean) => void;
    setOtpKeyCount: (n: number) => void;
    setKeyPolicy: (targetCount: number, replenishThreshold: number) => void;
    setBootstrapStatus: (status: E2eeBootstrapStatus, error?: string | null) => void;
    resetBootstrapState: () => void;
    hasSenderKeyRequest: (roomId: number, senderMemberId: number) => boolean;
    addSenderKeyRequest: (roomId: number, senderMemberId: number) => void;
    removeSenderKeyRequest: (roomId: number, senderMemberId: number) => void;
}

const senderKeyRequestKey = (roomId: number, senderMemberId: number): string =>
    `${roomId}:${senderMemberId}`;

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
    hasSenderKeyRequest: (roomId, senderMemberId) =>
        get().senderKeyRequests.has(senderKeyRequestKey(roomId, senderMemberId)),
    addSenderKeyRequest: (roomId, senderMemberId) =>
        set((s) => ({
            senderKeyRequests: new Set(s.senderKeyRequests).add(senderKeyRequestKey(roomId, senderMemberId)),
        })),
    removeSenderKeyRequest: (roomId, senderMemberId) =>
        set((s) => {
            const next = new Set(s.senderKeyRequests);
            next.delete(senderKeyRequestKey(roomId, senderMemberId));
            return { senderKeyRequests: next };
        }),
}));
