import { get, patch, post, del } from "@/api/http.ts";
import type {
    BindDeviceResponse,
    DeviceInfoResponseDto,
    DeviceRegisterRequest,
    DeviceRegisterResponse,
    DeviceUpdateRequest,
    DeviceUpdateResponse,
    ListDevicesResponse,
} from "@/api/types.ts";

export const deviceApi = {
    register: (payload: DeviceRegisterRequest) =>
        post<DeviceRegisterResponse, DeviceRegisterRequest>('/api/device/register', payload),

    list: () =>
        get<ListDevicesResponse>('/api/device'),

    getById: (deviceId: string) =>
        get<DeviceInfoResponseDto>(`/api/device/${deviceId}`),

    update: (deviceId: string, payload: DeviceUpdateRequest) =>
        patch<DeviceUpdateResponse, DeviceUpdateRequest>(`/api/device/${deviceId}`, payload),

    bind: (deviceId: string) =>
        post<BindDeviceResponse>(`/api/device/${deviceId}/bind`),

    remove: (deviceId: string) =>
        del(`/api/device/${deviceId}`),
};
