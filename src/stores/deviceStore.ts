import { create } from 'zustand';
import { type DeviceInfo } from '@/types/device';

interface DeviceState {
    // ── State ──────────────────────────────────────────────────────────────────
    /** UUID assigned by Tauri on first launch. */
    deviceId: string | null;
    /** OS platform string (e.g. "macos"). */
    platform: string | null;
    /** Human-readable hostname of this device. */
    deviceName: string | null;
    /** Whether this device is registered on the backend. */
    registered: boolean;
    /** Timestamp (ms) when this device was first registered. */
    createdAt: number | null;

    // ── Actions ────────────────────────────────────────────────────────────────
    /** Bulk-updates all device fields from a DeviceInfo object. */
    updateDeviceInfo: (deviceInfo: DeviceInfo) => void;
    /** Clears all device state (used on logout or device removal). */
    reset: () => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
    deviceId: null,
    deviceName: null,
    platform: null,
    registered: false,
    createdAt: null,

    updateDeviceInfo: (deviceInfo: DeviceInfo): void => {
        set({
            deviceId: deviceInfo.device_id,
            deviceName: deviceInfo.device_name,
            platform: deviceInfo.platform,
            registered: deviceInfo.registered,
            createdAt: deviceInfo.created_at,
        });
    },

    reset: (): void => {
        set({ deviceId: null, deviceName: null, platform: null, registered: false, createdAt: null });
    },
}));
