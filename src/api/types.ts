export interface AuthLoginRequest {
    device_id: string;
    identifier: string;
    password: string;
}

export interface AuthLoginResponse {
    message?: string;
}

export interface AuthRegisterRequest {
    account: string;
    email: string;
    name: string;
    password: string;
}

export interface AuthRegisterResponse {
    message?: string;
}

export interface AuthLogoutResponse {
    message?: string;
}

export interface AuthVerifyEmailResponse {
    message?: string;
}

export interface AuthUserProfileItem {
    avatar?: string;
    id: number;
    name: string;
    role_codes: string[];
}

export interface AuthProfileResponse {
    account_name?: string;
    current_user: AuthUserProfileItem;
    email: string;
    public_id?: string;
    status?: string;
    user_ids?: number[];
}

export interface DeviceRegisterRequest {
    device_id: string;
    device_name: string;
    platform: string;
}

export interface DeviceRegisterResponse {
    created_at?: string | number;
    device_id: string;
    device_name?: string;
    platform?: string;
    success: boolean;
}

export interface DeviceInfoResponseDto {
    created_at?: string | number;
    device_id: string;
    device_name: string;
    platform: string;
    success: boolean;
}

export interface DeviceUpdateRequest {
    device_name: string;
    platform: string;
}

export interface DeviceUpdateResponse {
    created_at?: string | number;
    device_id: string;
    device_name?: string;
    platform?: string;
    success: boolean;
}

export interface UserUpdateProfileRequest {
    name: string;
    role_codes?: string[];
}

export interface UserProfileResponse {
    avatar?: string;
    id: number;
    name: string;
    role_codes: string[];
}

export interface UserUploadAvatarResponse {
    avatar_url: string;
}

export interface ParticipantResponse {
    created_at?: string;
    id: number;
    user_id: number;
}
