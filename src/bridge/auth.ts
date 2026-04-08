import { invoke } from '@tauri-apps/api/core';

type BridgeId = string | number;

const toBridgeId = (value: BridgeId): string => String(value);

export const saveAuthToken = (accountId: BridgeId, token: string): Promise<void> =>
    invoke('save_auth_token', { accountId: toBridgeId(accountId), token });

export const getAuthToken = (): Promise<string | null> =>
    invoke<string | null>('get_auth_token');

export const getAuthTokenByAccount = (accountId: BridgeId): Promise<string | null> =>
    invoke<string | null>('get_auth_token_by_account', { accountId: toBridgeId(accountId) });

export const clearAuthToken = (accountId?: BridgeId): Promise<void> => {
    if (accountId === undefined) return Promise.resolve();
    return invoke('clear_auth_token', { accountId: toBridgeId(accountId) });
};
