import {
    DeviceInfo,
    DeviceRegistrationRequest,
    DeviceRegistrationResponse,
    DeviceUpdateRequest
} from "@/types/device.ts";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { logger } from "@/utils/logger.ts";
import { deviceApi } from "@/api/index.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import type { DeviceInfoResponseDto } from "@/api/types.ts";

class DeviceService {

    async initializeDevice(): Promise<void> {
        const info = await this.getDeviceInfo();

        const state = useDeviceStore.getState();
        state.updateDeviceInfo(info);

        if (!info.registered) {
            try {
                const rs = await this.registerDevice(
                    info.device_id ?? '',
                    info.device_name ?? '',
                    info.platform ?? ''
                );
                state.setRegistered(rs.success);
            } catch (error) {
                state.setRegistered(false);
            }
        }

        await this.updateDevice(info.device_id ?? '', info.device_name ?? '', info.platform ?? '');
    }

    async resetDevice(): Promise<void> {
        if (isTauri()) {
            await invoke('clear_device_id');

        }

        const state = useDeviceStore.getState();
        state.setDeviceId(null);
        state.setPlatform(null);
        state.setRegistered(false);
        state.setCreateTime(null);
    }

    private async getDeviceInfo(): Promise<DeviceInfo> {
        return isTauri() ? await this.getAppDeviceInfo() : await this.getWebDeviceInfo();
    }

    private async getAppDeviceInfo(): Promise<DeviceInfo> {
        try {
            const info = await invoke<DeviceInfo>('get_device_info');
            const response = await deviceApi.getById(info.device_id);

            return this.toDeviceInfo({
                ...response,
                device_id: info.device_id,
                device_name: info.device_name,
                platform: info.platform,
            });
        } catch (err) {
            logger.error("Error getting device info:", err);
            throw err;
        }
    }

    private async getWebDeviceInfo(): Promise<DeviceInfo> {
        const response = await deviceApi.getBrowserInfo();

        const ua = navigator.userAgent;

        const platform: string = ((): string => {
            if (/Android/i.test(ua)) return 'android';
            if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
            if (/Windows/i.test(ua)) return 'windows';
            if (/Mac/i.test(ua)) return 'macos';
            if (/Linux/i.test(ua)) return 'linux';
            return 'unknown';
        })();

        const deviceName: string = ((): string => {
            if (/Edg\//i.test(ua)) return 'Edge';
            if (/OPR\/|Opera/i.test(ua)) return 'Opera';
            if (/Chrome\//i.test(ua) && !/Chromium/.test(ua)) return 'Chrome';
            if (/Chromium\//i.test(ua)) return 'Chromium';
            if (/Firefox\//i.test(ua)) return 'Firefox';
            if (/Safari\//i.test(ua) && !/Chrome/.test(ua)) return 'Safari';
            return 'Unknown';
        })();

        return {
            device_id: response.device_id || 'Browser',
            platform: platform,
            device_name: deviceName,
            registered: response.success,
            created_at: response.success
                ? this.toTimestamp(response.created_at)
                : new Date().getTime(),
        };
    }

    private async registerDevice(deviceId: string, deviceName: string, platform: string): Promise<DeviceRegistrationResponse> {
        try {
            const payload: DeviceRegistrationRequest = {
                device_id: deviceId,
                device_name: deviceName,
                platform: platform
            };

            const response = await deviceApi.register(payload);

            logger.info("Device registered successfully:", response);

            if (response.success && isTauri()) {
                await invoke('update_device_registration', { registered: true })
            }

            return {
                ...response,
                created_at: this.toTimestamp(response.created_at),
            };
        } catch (err) {
            logger.error("Error register device:", err);
            throw err;
        }
    }

    private async updateDevice(deviceId: string, deviceName: string, platform: string): Promise<void> {
        try {
            const payload: DeviceUpdateRequest = {
                device_id: deviceId,
                device_name: deviceName,
                platform: platform
            };

            await deviceApi.update(deviceId, payload);
            logger.info('Device updated successfully');
        } catch (err) {
            logger.error('Failed to update device');
            throw err;
        }
    }

    private toDeviceInfo(response: DeviceInfoResponseDto): DeviceInfo {
        return {
            device_id: response.device_id,
            platform: response.platform,
            device_name: response.device_name,
            registered: response.success,
            created_at: this.toTimestamp(response.created_at),
        };
    }

    private toTimestamp(value: string | number | undefined): number {
        if (typeof value === 'number') {
            return value;
        }

        if (!value) {
            return Date.now();
        }

        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? Date.now() : parsed;
    }
}

export const deviceService = new DeviceService();
