import { get, post } from '@/api/http.ts';
import type {
    UploadIdentityKeyRequest,
    UploadIdentityKeyResponse,
    UploadSignedPreKeyRequest,
    UploadOTPPreKeysRequest,
    UploadOTPPreKeysResponse,
    CountOTPPreKeysResponse,
    GetKeyBundleResponse,
    UploadSenderKeyRequest,
    GetSenderKeysResponse,
    GetSenderKeyDistributionStatusResponse,
    CreateSenderKeyRequestRequest,
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

    getKeyBundle: (user_id: number, device_id?: string): Promise<GetKeyBundleResponse> =>
        get(`/api/e2ee/key-bundle/${user_id}`, { params: device_id ? { device_id } : {} }),

    uploadSenderKey: (room_id: number, sender_key_public: string, distribution_message: string): Promise<void> =>
        post('/api/e2ee/sender-key', { room_id, sender_key_public, distribution_message } as UploadSenderKeyRequest),

    getSenderKeys: (room_id: number): Promise<GetSenderKeysResponse> =>
        get(`/api/e2ee/sender-keys/${room_id}`),

    getSenderKeyDistributionStatus: (room_id: number): Promise<GetSenderKeyDistributionStatusResponse> =>
        get(`/api/e2ee/sender-key-distributions/${room_id}`),

    createSenderKeyRequest: (room_id: number, provider_member_id: number): Promise<void> =>
        post('/api/e2ee/sender-key-request', { room_id, provider_member_id } as CreateSenderKeyRequestRequest),
};
