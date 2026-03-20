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

// ── Friends ───────────────────────────────────────────────────────────────────

export interface FriendResponse {
    friendship_id: number;
    user_id: number;
    name: string;
    avatar: string;
    status: string;
    created_at: string;
}

export interface FriendRequestResponse {
    friendship_id: number;
    user_id: number;
    name: string;
    avatar: string;
    created_at: string;
}

export interface UserSearchResponse {
    user_id: number;
    name: string;
    avatar: string;
    account: string;
    public_id: string;
    friendship_status?: string;
}

// ── Chat ──────────────────────────────────────────────────────────────────────

export interface CreateRoomRequest {
    type: 'DIRECT' | 'GROUP' | 'CHANNEL' | 'BOT';
    name: string;
    description?: string;
    allow_agent?: boolean;
    member_ids?: number[];
}

export interface CreateRoomResponse {
    id: number;
    type: string;
    name: string;
    created_at: string;
}

export interface GetMessagesResponse {
    messages: MessageDto[];
    has_more: boolean;
}

export interface MessageDto {
    id: number;
    room_id: number;
    sender_id: number;
    sender_name: string;
    sender_avatar?: string;
    type: 'text' | 'image' | 'file';
    content: string;
    reply_to_id?: number;
    created_at: string;
}

export interface SendMessageRequest {
    type?: 'text' | 'image' | 'file';
    content: string;
    reply_to_id?: number;
}

export interface SendMessageResponse {
    id: number;
    created_at: string;
}

export interface UploadMediaResponse {
    url: string;
}

export interface ApproveInvitationRequest {
    approve: boolean;
}

// ── E2EE ──────────────────────────────────────────────────────────────────────

export interface UploadIdentityKeyRequest {
    device_id: string;
    public_key: string;
    sign_public_key: string;
}

export interface UploadSignedPreKeyRequest {
    device_id: string;
    key_id: number;
    public_key: string;
    signature: string;
}

export interface UploadOTPPreKeysRequest {
    device_id: string;
    keys: {
        key_id: number;
        public_key: string;
    }[];
}

export interface CountOTPPreKeysResponse {
    count: number;
}

export interface GetKeyBundleResponse {
    identity_key: string;
    identity_key_sign: string;
    signed_pre_key: string;
    spk_signature: string;
    spk_key_id: number;
    otp_pre_key?: string;
    otp_pre_key_id?: number;
}

export interface UploadSenderKeyRequest {
    room_id: number;
    sender_key_public: number[];
    distribution_message: number[];
}

export interface GetSenderKeysResponse {
    sender_keys: {
        user_id: number;
        device_id: string;
        sender_key_public: number[];
        distribution_message: number[];
    }[];
}
