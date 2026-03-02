import axios from "axios";
import { create } from "zustand";
import { logger } from "@/utils/logger.ts";
import { AxiosError } from "axios";
import { env } from "@/config/env.ts";

const healthCheckClient = axios.create({
    baseURL: env.API_BASE_URL,
    timeout: 3000,
});

export type NetworkStatus =
    | 'offline'
    | 'connecting'
    | 'healthy'
    | 'unhealthy'
    | 'unreachable';

export interface NetworkState {
    browserOnline: boolean;
    serverReachable: boolean;
    networkStatus: NetworkStatus;
    lastCheck: number | null;

    setBrowserOnline: (online: boolean) => void;
    setServerReachable: (reachable: boolean) => void;
    setNetworkStatus: (status: NetworkStatus) => void;
    checkConnection: () => Promise<boolean>;
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
        browserOnline: navigator.onLine,
        serverReachable: false,
        networkStatus: 'offline',
        lastCheck: null,

        setBrowserOnline: (online: boolean) => {
            set({ browserOnline: online });
        },

        setServerReachable: (reachable: boolean) => {
            set({ serverReachable: reachable });
        },

        setNetworkStatus: (status: NetworkStatus) => {
            set({ networkStatus: status });
        },

        checkConnection: async () => {
            if (env.IS_DEV) {
                set({
                    networkStatus: 'healthy',
                    serverReachable: true,
                    lastCheck: Date.now()
                });
                return true;
            }

            try {
                await healthCheckClient.get('/api/health');

                set({
                    networkStatus: 'healthy',
                    serverReachable: true,
                    lastCheck: Date.now()
                });
                return true;
            } catch (error) {
                const axiosError = error as AxiosError;

                if (axiosError.code === 'ECONNABORTED') {
                    get().setNetworkStatus('unreachable');
                    logger.error('Health check timeout');
                } else if (!axiosError.response) {
                    get().setNetworkStatus('unreachable');
                    logger.error('Network error - no response from server');
                } else {
                    get().setNetworkStatus('unhealthy');
                    logger.error('Server returned error', axiosError.response.status);
                }

                set({
                    serverReachable: false,
                    lastCheck: Date.now(),
                });
                return false;
            }
        }
    })
)