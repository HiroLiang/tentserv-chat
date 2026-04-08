import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { env } from "@/config/env.ts";
import { logger } from "@/utils/logger.ts";
import { useUserStore } from "@/stores/userStore.ts";
import { useDeviceStore } from "@/stores/deviceStore.ts";
import type { ErrorResponse } from "@/types/api.ts";

// [EN] Axios HTTP client with two interceptors:
//      Request: attaches Bearer token (from userStore) + X-Device-ID (from deviceStore) to every request.
//      Response: if a new token appears in the Authorization header, updates userStore automatically.
//      Errors are normalized to {message, code} objects for consistent handling in services.
// [中] Axios HTTP 客戶端，含兩個攔截器：
//      請求：自動附加 Bearer token（來自 userStore）與 X-Device-ID（來自 deviceStore）。
//      回應：若 Authorization header 含新 token 則自動更新 userStore；錯誤統一轉為 {message, code} 物件。
// [日] Axios HTTP クライアント（インターセプター 2 つ）：
//      リクエスト：Bearer token（userStore）と X-Device-ID（deviceStore）を全リクエストに付加する。
//      レスポンス：Authorization ヘッダに新トークンがある場合は userStore を自動更新する。
//      エラーは {message, code} オブジェクトに正規化してサービス層での処理を一貫させる。
export const http = axios.create({
    baseURL: env.API_BASE_URL,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json'
    },
});

// Request interceptor
http.interceptors.request.use(
    config => {
        logger.info(`Request: ${config.method?.toUpperCase()} ${config.url}`);

        // Set auth header
        const userStore = useUserStore.getState();
        const token = userStore.currentUser?.token;
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        // Set device ID header
        const deviceId = useDeviceStore.getState().deviceId;
        if (deviceId) {
            config.headers['X-Device-ID'] = deviceId;
        }

        return config;
    },
    (error: AxiosError) => {
        logger.error('Request Error', error);
        return Promise.reject(error);
    }
);

// Response interceptor
http.interceptors.response.use(
    response => {
        logger.info(
            `Response: ${response.status} ${response.config.url}`,
            response.data
        );

        const newToken = response.headers['authorization'] || response.headers['Authorization'];

        if (typeof newToken === 'string' && newToken.length > 0) {

            // Remove Bearer prefix
            const token = newToken.startsWith('Bearer ')
                ? newToken.slice(7)
                : newToken;

            // Update user token
            const userStore = useUserStore.getState();
            const currentUser = userStore.currentUser;

            if (currentUser) {
                userStore.setCurrentUser({
                    ...currentUser,
                    token: token,
                });

                logger.info('Token refreshed');
            }
        }

        return response;
    },
    error => {
        if (axios.isAxiosError(error) && error.response) {
            const errorBody = error.response.data as ErrorResponse;
            const err = Object.assign(
                new Error(errorBody.message ?? 'Request failed'),
                { code: errorBody.code }
            );
            return Promise.reject(err);
        }

        return Promise.reject(error);
    }
);

export const request = async <TResponse, TRequest = unknown>(
    config: AxiosRequestConfig<TRequest>
): Promise<TResponse> => {
    const response = await http.request<TResponse, AxiosResponse<TResponse>, TRequest>(config);
    return response.data;
};

export const get = <TResponse>(url: string, config?: AxiosRequestConfig): Promise<TResponse> =>
    request<TResponse>({ ...config, method: 'get', url });

export const post = <TResponse, TRequest = unknown>(
    url: string,
    data?: TRequest,
    config?: AxiosRequestConfig<TRequest>
): Promise<TResponse> => request<TResponse, TRequest>({ ...config, method: 'post', url, data });

export const put = <TResponse, TRequest = unknown>(
    url: string,
    data?: TRequest,
    config?: AxiosRequestConfig<TRequest>
): Promise<TResponse> => request<TResponse, TRequest>({ ...config, method: 'put', url, data });

export const patch = <TResponse, TRequest = unknown>(
    url: string,
    data?: TRequest,
    config?: AxiosRequestConfig<TRequest>
): Promise<TResponse> => request<TResponse, TRequest>({ ...config, method: 'patch', url, data });

export const del = <TResponse>(url: string, config?: AxiosRequestConfig): Promise<TResponse> =>
    request<TResponse>({ ...config, method: 'delete', url });
