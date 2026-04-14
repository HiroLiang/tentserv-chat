export interface AuthLoginRequest {
    device_id: string;
    identifier: string;
    password: string;
}

export interface AuthLoginResponse {
    login_status: 'authenticated' | 'device_verification_required';
    verification_token?: string;
    verification_expires_at_ms?: number;
}

export interface AuthRegisterRequest {
    account: string;
    email: string;
    name: string;
    password: string;
    confirm_password: string;
}

export interface AuthRegisterResponse {
    verification_token: string;
    verification_expires_at_ms: number;
}

export interface AuthLogoutResponse {
    message?: string;
}

export interface AuthVerifyEmailResponse {
}

export interface AuthVerifyEmailRequest {
    token: string;
    code: string;
}

export interface AuthVerifyLoginDeviceRequest {
    token: string;
    code: string;
}

export interface AuthVerifyLoginDeviceResponse {
    login_status: 'authenticated';
}

export interface AuthResendLoginDeviceVerificationRequest {
    token: string;
}

export interface AuthResendLoginDeviceVerificationResponse {
    verification_token: string;
    verification_expires_at_ms: number;
}

export interface AuthResendVerifyEmailRequest {
    token: string;
}

export interface AuthResendVerifyEmailResponse {
    verification_token: string;
    verification_expires_at_ms: number;
}

export interface AuthUserProfileItem {
    avatar?: string;
    id: number;
    name: string;
    role_codes: string[];
}

export interface AuthProfileResponse {
    account_id: number;
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
    updated_at?: string;
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
    blocked_by?: 'me' | 'them';
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

export interface FriendsOverviewResponse {
    friends: FriendResponse[];
    requests: FriendRequestResponse[];
    blocked: FriendResponse[];
}

export interface UserSearchResponse {
    user_id: number;
    name: string;
    avatar: string;
    account: string;
    public_id: string;
    friendship_status?: string;
    blocked_by?: 'me' | 'them';
}

export interface DeletedDirectRoomResponse {
    room_id: number;
    member_ids: number[];
}

export interface RemoveFriendResponse {
    deleted_direct_room?: DeletedDirectRoomResponse;
}

// ── Chat ──────────────────────────────────────────────────────────────────────

export interface CreateRoomRequest {
    type: 'direct' | 'group' | 'channel' | 'bot';
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
    sender_device_id: string;
    sender_key_version: number;
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
    sender_device_id: string;
    sender_key_version: number;
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

export interface UploadIdentityKeyResponse {
    fingerprint: string;
}

export interface UploadOTPPreKeysResponse {
    count: number;
}

export interface CountOTPPreKeysResponse {
    count: number;
}

export interface CheckKeyStatusResponse {
    identity_key_exists: boolean;
    signed_pre_key_exists: boolean;
    device_id?: string;
    identity_key?: string;
    identity_key_sign?: string;
    signed_pre_key?: string;
    spk_signature?: string;
    spk_key_id?: number;
    otp_prekey_count: number;
}

export interface GetKeyPolicyResponse {
    otp_prekey_target_count: number;
    otp_prekey_replenish_threshold: number;
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
    sender_member_id: number;
    receiver_user_id: number;
    receiver_device_id?: string;
    sender_key_version: number;
    distribution_message: string; // base64
}

export interface GetSenderKeysResponse {
    keys: {
        chat_member_id: number;
        provider_device_id: string;
        sender_key_version: number;
    }[];
}

export interface SenderKeyRouteRef {
    user_id: number;
    member_id: number;
    device_id: string;
}

export interface GetSenderKeyDistributionStatusResponse {
    own_member_sender_key_exists: boolean;
    requestable_sources: SenderKeyRouteRef[];
    available_from_sources: SenderKeyRouteRef[];
    available_to_targets: SenderKeyRouteRef[];
    pending_receivers: SenderKeyRouteRef[];
    pending_from_sources: SenderKeyRouteRef[];
}

export interface CreateSenderKeyRequestRequest {
    room_id: number;
    provider_user_id: number;
    provider_device_id: string;
    sender_member_id: number;
    requester_device_id?: string;
}

export interface PendingSenderKeyDistributionItem {
    distribution_id: number;
    sender_member_id: number;
    sender_device_id: string;
    receiver_member_id: number;
    receiver_device_id?: string;
    sender_key_version: number;
    distribution_message: string;
}

export interface GetPendingSenderKeyDistributionsResponse {
    distributions: PendingSenderKeyDistributionItem[];
}

export interface ConsumeSenderKeyDistributionRequest {
    status: 'consumed' | 'failed';
}

export interface SelfSenderKeySyncDistributionUploadItem {
    sender_member_id: number;
    sender_device_id: string;
    sender_key_version: number;
    distribution_message: string;
}

export interface BulkSelfSenderKeySyncDistributionsRequest {
    items: SelfSenderKeySyncDistributionUploadItem[];
}

export interface BulkSelfSenderKeySyncDistributionsResponse {
    count: number;
}

export interface PendingSelfSenderKeySyncDistributionItem {
    distribution_id: number;
    sender_member_id: number;
    sender_device_id: string;
    sender_key_version: number;
    distribution_message: string;
}

export interface GetPendingSelfSenderKeySyncDistributionsResponse {
    distributions: PendingSelfSenderKeySyncDistributionItem[];
}

export interface ConsumeSelfSenderKeySyncDistributionRequest {
    status: 'consumed' | 'failed';
}

// ── E2EE WebSocket Payloads ────────────────────────────────────────────────────

export interface SenderKeyNeededPayload {
    room_id: number;
    sender_member_id: number;
    provider_user_id: number;
    provider_device_id: string;
    requester_member_id: number;
    requester_user_id: number;
    requester_device_id?: string;
}

export interface SenderKeyDistributionAvailablePayload {
    room_id: number;
    distribution_id: number;
    sender_member_id: number;
    sender_user_id: number;
    sender_device_id: string;
    receiver_member_id: number;
    receiver_user_id: number;
    sender_key_version: number;
    receiver_device_id?: string;
}

export interface SelfSenderKeySyncDevice {
    device_id: string;
    device_name: string;
    platform: string;
    last_ip?: string;
    binding_status?: string;
}

export interface GetSelfSenderKeySyncResponse {
    exists: boolean;
    status: 'idle' | 'pending_provider' | 'syncing' | 'uploaded' | 'completed' | 'failed';
    requester_device?: SelfSenderKeySyncDevice;
    provider_device?: SelfSenderKeySyncDevice;
    requester_current_device: boolean;
    provider_current_device: boolean;
    last_error?: string;
    requested_at_ms?: number;
    provider_claimed_at_ms?: number;
    uploaded_at_ms?: number;
    completed_at_ms?: number;
    failed_at_ms?: number;
}

export interface FailSelfSenderKeySyncRequest {
    last_error: string;
    retryable: boolean;
}

export interface PresenceUserStatusChangedPayload {
    user_id: number;
    status: 'online' | 'offline';
    last_seen_at?: string;
}
