import {
    DeviceInfo,
    DeviceRegistrationRequest,
    DeviceRegistrationResponse,
    DeviceInfoResponse, DeviceUpdateRequest
} from "@/types/device.ts";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { logger } from "@/utils/logger.ts";
import { http } from "@/api/http.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";

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
            const response = await http.get<DeviceInfoResponse>(
                `/api/device/${info.device_id}`
            );

            return {
                ...info,
                registered: response.data.success,
            };
        } catch (err) {
            logger.error("Error getting device info:", err);
            throw err;
        }
    }

    private async getWebDeviceInfo(): Promise<DeviceInfo> {
        const response = await http.get<DeviceInfoResponse>(
            '/api/device/browser'
        );

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
            device_id: 'Browser',
            platform: platform,
            device_name: deviceName,
            registered: response.data.success,
            created_at: response.data.success ? response.data.created_at : new Date().getTime(),
        };
    }

    private async registerDevice(deviceId: string, deviceName: string, platform: string): Promise<DeviceRegistrationResponse> {
        try {
            const payload: DeviceRegistrationRequest = {
                device_id: deviceId,
                device_name: deviceName,
                platform: platform
            };

            const response = await http.post<DeviceRegistrationResponse>(
                '/api/device/register',
                payload
            );

            logger.info("Device registered successfully:", response.data);

            if (response.data.success && isTauri()) {
                await invoke('update_device_registration', { registered: true })
            }

            return response.data;
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

            await http.patch<void>(`/api/device/${deviceId}`, payload);
            logger.info('Device updated successfully');
        } catch (err) {
            logger.error('Failed to update device');
            throw err;
        }
    }
}

export const deviceService = new DeviceService();