import { create } from 'zustand';

interface E2eeState {
    keysUploaded: boolean;
    otpKeyCount: number;

    setKeysUploaded: (v: boolean) => void;
    setOtpKeyCount: (n: number) => void;
}

export const useE2eeStore = create<E2eeState>((set) => ({
    keysUploaded: false,
    otpKeyCount: 0,

    setKeysUploaded: (v) => set({ keysUploaded: v }),
    setOtpKeyCount: (n) => set({ otpKeyCount: n }),
}));
