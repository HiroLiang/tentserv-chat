import { invoke } from '@tauri-apps/api/core';

export interface TauriLogPayload {
    level: number;
    message: string;
    target: string;
    [key: string]: unknown;
}

export const tauriLog = (payload: TauriLogPayload): Promise<void> =>
    invoke('plugin:log|log', payload);
