import { DeviceInfo, DeviceRegistrationRequest } from "@/types/device.ts";
import { DeviceRegisterResponse } from "@/api/types.ts";
import { isTauri } from "@tauri-apps/api/core";
import { getDeviceInfo as bridgeGetDeviceInfo, updateDeviceRegistration, clearDeviceId } from "@/bridge/device.ts";
import { logger } from "@/utils/logger.ts";
import { deviceApi } from "@/api/index.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";

class DeviceService {

    /**
     * Initializes device on app startup.
     *
     * Gets device info from Tauri (creates UUID on first launch), registers with
     * the backend (idempotent — safe to call every startup), then syncs the
     * response into the device store.
     *
     * On registration failure the store is still updated with registered=false
     * so AppInitializer can display the error overlay.
     */
    async initializeDevice(): Promise<void> {
        const info = await bridgeGetDeviceInfo();

        try {
            const response = await this.registerWithBackend(info);
            useDeviceStore.getState().updateDeviceInfo({
                device_id: info.device_id,
                device_name: response.device_name ?? info.device_name,
                platform: response.platform ?? info.platform,
                registered: response.success,
                created_at: this.toTimestamp(response.created_at),
            });
        } catch (err) {
            logger.error('Device registration failed:', err);
            useDeviceStore.getState().updateDeviceInfo({
                device_id: info.device_id,
                device_name: info.device_name,
                platform: info.platform,
                registered: false,
                created_at: info.created_at,
            });
        }
    }

    /**
     * Clears local device data from Tauri store and resets the device store.
     * Call on logout or device removal.
     */
    async resetDevice(): Promise<void> {
        await clearDeviceId();
        useDeviceStore.getState().reset();
    }

    /**
     * Sends a register request to the backend.
     * The endpoint is idempotent: it creates the device record on first call,
     * and returns the existing record on subsequent calls.
     * Also updates Tauri's local registration flag on success.
     */
    private async registerWithBackend(info: DeviceInfo): Promise<DeviceRegisterResponse> {
        const payload: DeviceRegistrationRequest = {
            device_id: info.device_id,
            device_name: info.device_name,
            platform: info.platform,
        };

        const response = await deviceApi.register(payload);
        logger.info('Device register response:', response);

        if (response.success && isTauri()) {
            await updateDeviceRegistration(true);
        }

        return response;
    }

    /** Converts a string/number/undefined timestamp to milliseconds. */
    private toTimestamp(value: string | number | undefined): number {
        if (typeof value === 'number') return value;
        if (!value) return Date.now();
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? Date.now() : parsed;
    }
}

export const deviceService = new DeviceService();
