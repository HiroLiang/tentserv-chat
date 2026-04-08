import { invoke } from '@tauri-apps/api/core';
import type { DeviceInfo } from '@/types/device.ts';

// [EN] Bridge boundary for local device lifecycle. React code must call the service, not invoke these commands directly.
// [中] 本地裝置 lifecycle 的 bridge 邊界。React 程式應呼叫 service，不要直接 invoke 這些 command。
// [日] ローカル端末 lifecycle の bridge 境界。React 側はこれらを直接 invoke せず service を呼び出す。
export const getDeviceInfo = (): Promise<DeviceInfo> =>
    invoke<DeviceInfo>('get_device_info');

export const updateDeviceRegistration = (registered: boolean): Promise<void> =>
    invoke('update_device_registration', { registered });

export const clearDeviceId = (): Promise<void> =>
    invoke('clear_device_id');
