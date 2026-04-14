// [u8;32] as number[], [u8;64] as number[]
export interface PublicKeyBundle {
    identity_key_dh: number[];
    identity_key_sign: number[];
    signed_pre_key: number[];
    spk_signature: number[];
    spk_key_id: number;
    one_time_pre_key?: number[];
    otpk_key_id?: number;
}

export interface InitialMessage {
    identity_key_dh_pub: number[];
    identity_key_sign_pub: number[];
    ephemeral_key_pub: number[];
    spk_key_id: number;
    otpk_key_id?: number;
    ciphertext: number[];
    nonce: number[];
}

export interface GenerateIdentityKeysResult {
    identity_key_dh_pub: number[];
    identity_key_sign_pub: number[];
}

export interface GenerateSignedPreKeyResult {
    key_id: number;
    public_key: number[];
    signature: number[];
}

// Rust generate_one_time_pre_keys returns Vec<OneTimePreKey> directly as an array
export interface OneTimePreKey {
    key_id: number;
    public_key: number[];
}

export interface SenderKeyBundle {
    sender_key_version: number;
}

export interface SenderKeyEncryptedMessage {
    ciphertext: number[];
    nonce: number[];
}

export interface SenderKeyState {
    member_id: string;
    device_id: string;
    key_scope: 'own' | 'peer';
    is_own_key: boolean;
    sender_key_version: number;
    updated_at: number;
}

export interface PreparedSenderKeyDistribution {
    distribution_message: number[];
    sender_key_version: number;
}

export interface ConsumeSenderKeyDistributionResult {
    status: 'consumed' | 'stale' | 'failed';
}

export interface DecryptSenderKeyResult {
    status: 'ok' | 'missing_key' | 'stale_key' | 'decrypt_failed';
    plaintext?: number[];
}
