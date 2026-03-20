import { invoke } from '@tauri-apps/api/core';

export const saveAuthToken = (token: string): Promise<void> =>
    invoke('save_auth_token', { token });

export const getAuthToken = (): Promise<string | null> =>
    invoke<string | null>('get_auth_token');

export const clearAuthToken = (): Promise<void> =>
    invoke('clear_auth_token');
