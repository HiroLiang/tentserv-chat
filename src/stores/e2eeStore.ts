import { create } from 'zustand';

export type E2eeBootstrapStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface E2eeState {
    keysUploaded: boolean;
    otpKeyCount: number;
    otpKeyTargetCount: number;
    otpReplenishThreshold: number;
    bootstrapStatus: E2eeBootstrapStatus;
    bootstrapError: string | null;
    // tracks in-flight or already-sent sender key requests: "roomId:providerMemberId:providerDeviceId"
    senderKeyRequests: Set<string>;

    setKeysUploaded: (v: boolean) => void;
    setOtpKeyCount: (n: number) => void;
    setKeyPolicy: (targetCount: number, replenishThreshold: number) => void;
    setBootstrapStatus: (status: E2eeBootstrapStatus, error?: string | null) => void;
    resetBootstrapState: () => void;
    hasSenderKeyRequest: (roomId: number, providerMemberId: number, providerDeviceId?: string) => boolean;
    addSenderKeyRequest: (roomId: number, providerMemberId: number, providerDeviceId?: string) => void;
    removeSenderKeyRequest: (roomId: number, providerMemberId: number, providerDeviceId?: string) => void;
}

const senderKeyRequestKey = (roomId: number, providerMemberId: number, providerDeviceId?: string): string =>
    `${roomId}:${providerMemberId}:${providerDeviceId ?? ''}`;

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
    hasSenderKeyRequest: (roomId, providerMemberId, providerDeviceId) =>
        get().senderKeyRequests.has(senderKeyRequestKey(roomId, providerMemberId, providerDeviceId)),
    addSenderKeyRequest: (roomId, providerMemberId, providerDeviceId) =>
        set((s) => ({
            senderKeyRequests: new Set(s.senderKeyRequests).add(senderKeyRequestKey(roomId, providerMemberId, providerDeviceId)),
        })),
    removeSenderKeyRequest: (roomId, providerMemberId, providerDeviceId) =>
        set((s) => {
            const next = new Set(s.senderKeyRequests);
            next.delete(senderKeyRequestKey(roomId, providerMemberId, providerDeviceId));
            return { senderKeyRequests: next };
        }),
}));
