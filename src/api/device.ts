import { get, patch, post } from "@/api/http.ts";
import type {
    DeviceInfoResponseDto,
    DeviceRegisterRequest,
    DeviceRegisterResponse,
    DeviceUpdateRequest,
    DeviceUpdateResponse,
} from "@/api/types.ts";

export const deviceApi = {
    register: (payload: DeviceRegisterRequest) =>
        post<DeviceRegisterResponse, DeviceRegisterRequest>('/api/device/register', payload),

    getById: (deviceId: string) =>
        get<DeviceInfoResponseDto>(`/api/device/${deviceId}`),

    update: (deviceId: string, payload: DeviceUpdateRequest) =>
        patch<DeviceUpdateResponse, DeviceUpdateRequest>(`/api/device/${deviceId}`, payload),

    // Compatibility endpoint used by the existing web bootstrap flow.
    getBrowserInfo: () =>
        get<DeviceInfoResponseDto>('/api/device/browser'),
};
