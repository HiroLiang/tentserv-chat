import { create } from 'zustand';
import { type DeviceInfo } from '@/types/device';

interface DeviceState {
    // ── State ──────────────────────────────────────────────────────────────────
    /**
     * [EN] Stable UUID assigned by Rust/Tauri on first launch.
     * [中] Rust/Tauri 在首次啟動時建立並保持穩定的 UUID。
     * [日] 初回起動時に Rust/Tauri が生成し、その後固定される UUID。
     */
    deviceId: string | null;
    /** OS platform string (e.g. "macos"). */
    platform: string | null;
    /** Human-readable hostname of this device. */
    deviceName: string | null;
    /**
     * [EN] True only after the backend register/upsert endpoint succeeds.
     * [中] 只有後端 register/upsert 成功後才會是 true。
     * [日] backend の register/upsert が成功した後だけ true になる。
     */
    registered: boolean;
    /** Timestamp (ms) when this device was first registered. */
    createdAt: number | null;
    /**
     * [EN] Timestamp (ms) from the backend after the latest device metadata update.
     * [中] 後端完成最近一次裝置資訊更新後回傳的毫秒時間戳。
     * [日] backend が直近の端末情報更新後に返すミリ秒 timestamp。
     */
    updatedAt: number | null;

    // ── Actions ────────────────────────────────────────────────────────────────
    /**
     * [EN] Replaces device state with the authoritative device info returned by the lifecycle flow.
     * [中] 以 lifecycle 流程回傳的權威裝置資料覆蓋 store 狀態。
     * [日] lifecycle フローが返す信頼済み端末情報で store state を置き換える。
     */
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
    updatedAt: null,

    updateDeviceInfo: (deviceInfo: DeviceInfo): void => {
        set((state) => ({
            deviceId: deviceInfo.device_id,
            deviceName: deviceInfo.device_name,
            platform: deviceInfo.platform,
            registered: deviceInfo.registered,
            createdAt: deviceInfo.created_at,
            updatedAt: deviceInfo.updated_at ?? state.updatedAt,
        }));
    },

    reset: (): void => {
        set({ deviceId: null, deviceName: null, platform: null, registered: false, createdAt: null, updatedAt: null });
    },
}));
