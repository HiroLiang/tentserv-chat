import { invoke } from '@tauri-apps/api/core';
import type { DeviceInfo } from '@/types/device.ts';

export const getDeviceInfo = (): Promise<DeviceInfo> =>
    invoke<DeviceInfo>('get_device_info');

export const updateDeviceRegistration = (registered: boolean): Promise<void> =>
    invoke('update_device_registration', { registered });

export const clearDeviceId = (): Promise<void> =>
    invoke('clear_device_id');
