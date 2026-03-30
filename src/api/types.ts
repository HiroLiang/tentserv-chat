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
    created_at?: string;
    device_id: string;
    device_name?: string;
    platform?: string;
    success: boolean;
}

export interface DeviceInfoResponseDto {
    created_at?: string;
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
    created_at?: string;
    device_id: string;
    device_name?: string;
    platform?: string;
    success: boolean;
}

export interface DeviceListItem {
    device_id: string;
    device_name: string;
    platform: string;
    created_at: string;
}

export interface ListDevicesResponse {
    success: boolean;
    devices: DeviceListItem[];
}

export interface BindDeviceResponse {
    success: boolean;
    device_id: string;
    account_id: number;
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

export interface SentFriendRequestResponse {
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
    max_members?: number;
    allow_agent?: boolean;
    member_ids?: number[];
}

export interface CreateRoomResponse {
    id: number;
    type: string;
    name: string;
    max_members: number;
    allow_agent: boolean;
    created_at: string;
    already_existed: boolean;
}

export interface GetMessagesResponse {
    messages: MessageDto[];
    has_more: boolean;
}

export interface MessageDto {
    message_id: number;
    sender_id: number;
    type: 'text' | 'image' | 'file';
    content: string;
    reply_to_id?: number;
    is_edited: boolean;
    created_at: string;
}

export interface SendMessageRequest {
    type: 'text' | 'image' | 'file';
    content: string;
    reply_to_id?: number;
}

export interface SendMessageResponse {
    message_id: number;
    sender_id: number;
    type: string;
    content: string;
    reply_to_id?: number;
    created_at: string;
}

export interface UploadMediaResponse {
    path: string;
    url: string;
    mime_type: string;
    size: number;
}

export interface ApproveInvitationRequest {
    approve: boolean;
}

export interface GetMyRoomInvitationResponse {
    found: boolean;
    invitation_id?: number;
    role?: 'inviter' | 'invitee';
    inviter_name?: string;
    inviter_avatar?: string;
    inviter_user_id?: number;
}

export interface RespondInvitationRequest {
    action: 'accept' | 'reject' | 'block';
}

export interface RespondInvitationResponse {
    invitation_id: number;
    status: string;
    member_id?: number;
    role?: string;
    joined_at?: string;
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
    sender_key_public: string;   // base64
    distribution_message: string; // base64
}

export interface GetSenderKeysResponse {
    keys: {
        chat_member_id: number;
        sender_key_public: string;   // base64
        distribution_message: string; // base64
    }[];
}

export interface GetSenderKeyDistributionStatusResponse {
    pending_receivers: number[];    // member IDs who haven't fetched my latest key
    pending_from_members: number[]; // member IDs whose key I haven't fetched yet
}
