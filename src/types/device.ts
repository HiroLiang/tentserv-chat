export interface DeviceInfo {
    device_id: string;
    platform: string;
    device_name: string;
    registered: boolean;
    created_at: number;
}

export interface DeviceInfoRequest {
    device_id: string;
    platform: string;
    device_name: string;
}

export interface DeviceRegistrationRequest extends DeviceInfoRequest {
}

export interface DeviceRegistrationResponse {
    success: boolean;
    device_id: string;
    message?: string;
}

export interface DeviceInfoResponse {
    success: boolean;
    device_id: string;
    platform: string;
    device_name: string;
    created_at: number;
}

export interface DeviceUpdateRequest extends DeviceInfoRequest {
}