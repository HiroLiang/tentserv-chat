import { get, post } from '@/api/http.ts';
import type {
    FailSelfSenderKeySyncRequest,
    UploadIdentityKeyRequest,
    UploadIdentityKeyResponse,
    UploadSignedPreKeyRequest,
    UploadOTPPreKeysRequest,
    UploadOTPPreKeysResponse,
    CountOTPPreKeysResponse,
    CheckKeyStatusResponse,
    GetKeyPolicyResponse,
    GetKeyBundleResponse,
    UploadSenderKeyRequest,
    GetSenderKeysResponse,
    GetSenderKeyDistributionStatusResponse,
    CreateSenderKeyRequestRequest,
    GetPendingSenderKeyDistributionsResponse,
    ConsumeSenderKeyDistributionRequest,
    GetSelfSenderKeySyncResponse,
    BulkSelfSenderKeySyncDistributionsRequest,
    BulkSelfSenderKeySyncDistributionsResponse,
    GetPendingSelfSenderKeySyncDistributionsResponse,
    ConsumeSelfSenderKeySyncDistributionRequest,
} from '@/api/types.ts';

export const e2eeApi = {
    uploadIdentityKey: (device_id: string, public_key: string, sign_public_key: string): Promise<UploadIdentityKeyResponse> =>
        post('/api/e2ee/identity-key', { device_id, public_key, sign_public_key } as UploadIdentityKeyRequest),

    uploadSignedPreKey: (device_id: string, key_id: number, public_key: string, signature: string): Promise<void> =>
        post('/api/e2ee/signed-prekey', { device_id, key_id, public_key, signature } as UploadSignedPreKeyRequest),

    uploadOTPPreKeys: (device_id: string, keys: { key_id: number; public_key: string }[]): Promise<UploadOTPPreKeysResponse> =>
        post('/api/e2ee/otp-prekeys', { device_id, keys } as UploadOTPPreKeysRequest),

    countOTPPreKeys: (device_id: string): Promise<CountOTPPreKeysResponse> =>
        get(`/api/e2ee/otp-prekeys/count`, { params: { device_id } }),

    checkKeyStatus: (user_id: number, device_id?: string): Promise<CheckKeyStatusResponse> =>
        get(`/api/e2ee/key-status/${user_id}`, { params: device_id ? { device_id } : {} }),

    getKeyPolicy: (): Promise<GetKeyPolicyResponse> =>
        get('/api/e2ee/key-policy'),

    getKeyBundle: (user_id: number, device_id?: string): Promise<GetKeyBundleResponse> =>
        get(`/api/e2ee/key-bundle/${user_id}`, { params: device_id ? { device_id } : {} }),

    uploadSenderKey: (
        room_id: number,
        sender_member_id: number,
        receiver_user_id: number,
        receiver_device_id: string | undefined,
        sender_key_version: number,
        distribution_message: string,
    ): Promise<void> =>
        post('/api/e2ee/sender-key', {
            room_id,
            sender_member_id,
            receiver_user_id,
            ...(receiver_device_id ? { receiver_device_id } : {}),
            sender_key_version,
            distribution_message,
        } as UploadSenderKeyRequest),

    getSenderKeys: (room_id: number): Promise<GetSenderKeysResponse> =>
        get(`/api/e2ee/sender-keys/${room_id}`),

    getSenderKeyDistributionStatus: (room_id: number): Promise<GetSenderKeyDistributionStatusResponse> =>
        get(`/api/e2ee/sender-key-distributions/${room_id}`),

    getPendingSenderKeyDistributions: (room_id: number): Promise<GetPendingSenderKeyDistributionsResponse> =>
        get(`/api/e2ee/sender-key-distributions/${room_id}/pending`),

    consumeSenderKeyDistribution: (distribution_id: number, status: 'consumed' | 'failed'): Promise<void> =>
        post(`/api/e2ee/sender-key-distributions/${distribution_id}/consume`, { status } as ConsumeSenderKeyDistributionRequest),

    createSenderKeyRequest: (
        room_id: number,
        provider_user_id: number,
        provider_device_id: string,
        sender_member_id: number,
        requester_device_id?: string,
    ): Promise<void> =>
        post('/api/e2ee/sender-key-request', {
            room_id,
            provider_user_id,
            provider_device_id,
            sender_member_id,
            ...(requester_device_id ? { requester_device_id } : {}),
        } as CreateSenderKeyRequestRequest),

    getSelfSenderKeySync: (): Promise<GetSelfSenderKeySyncResponse> =>
        get('/api/e2ee/self-sender-key-sync'),

    acceptSelfSenderKeySync: (): Promise<GetSelfSenderKeySyncResponse> =>
        post('/api/e2ee/self-sender-key-sync/accept'),

    markSelfSenderKeySyncUploaded: (): Promise<GetSelfSenderKeySyncResponse> =>
        post('/api/e2ee/self-sender-key-sync/uploaded'),

    bulkSelfSenderKeySyncDistributions: (
        items: BulkSelfSenderKeySyncDistributionsRequest['items'],
    ): Promise<BulkSelfSenderKeySyncDistributionsResponse> =>
        post('/api/e2ee/self-sender-key-sync/distributions/bulk', { items } as BulkSelfSenderKeySyncDistributionsRequest),

    getPendingSelfSenderKeySyncDistributions: (): Promise<GetPendingSelfSenderKeySyncDistributionsResponse> =>
        get('/api/e2ee/self-sender-key-sync/distributions/pending'),

    consumeSelfSenderKeySyncDistribution: (distribution_id: number, status: 'consumed' | 'failed'): Promise<void> =>
        post(
            `/api/e2ee/self-sender-key-sync/distributions/${distribution_id}/consume`,
            { status } as ConsumeSelfSenderKeySyncDistributionRequest,
        ),

    completeSelfSenderKeySync: (): Promise<GetSelfSenderKeySyncResponse> =>
        post('/api/e2ee/self-sender-key-sync/complete'),

    failSelfSenderKeySync: (payload: FailSelfSenderKeySyncRequest): Promise<GetSelfSenderKeySyncResponse> =>
        post('/api/e2ee/self-sender-key-sync/fail', payload),
};
