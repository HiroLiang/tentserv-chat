//! Core command logic shared by Tauri command handlers and Rust tests.
//!
//! This module intentionally has no `AppHandle` dependency. Callers are expected
//! to inject a `rusqlite::Connection` and (when needed) the user's AES master key.

use chrono::Utc;
use ed25519_dalek::Signer;
use rusqlite::Connection;
use uuid::Uuid;

use crate::crypto::x3dh::{
    x3dh_receiver, x3dh_sender, InitialMessage, PublicKey, PublicKeyBundle, SigningKey,
    StaticSecret,
};
use crate::store::device_store::{
    clear_device_info_inner, load_device_info_inner, store_device_info_inner,
    update_device_registered_inner, DeviceInfo,
};
use crate::store::key_store::{
    clear_all_keys_for_user_inner, delete_identity_and_spk_for_user_inner, delete_otp_key_inner,
    has_identity_key_inner, has_signed_pre_key_inner, load_identity_key_inner,
    load_identity_public_keys_inner, load_otp_key_inner, load_signed_pre_key_inner,
    load_signed_pre_key_public_inner, next_opk_ids_inner, store_identity_key_inner,
    store_otp_key_inner, store_signed_pre_key_inner,
};
use crate::store::message_store::{
    get_decrypted_messages_inner, get_encrypted_messages_inner, store_decrypted_message_inner,
    store_encrypted_message_inner, DecryptedMessageRow, EncryptedMessageRow,
};
use crate::store::sender_key_store::{
    delete_sender_keys_inner, get_sender_key_state_inner, has_sender_key_inner,
    list_sender_key_states_inner, load_own_sender_key_inner,
    load_own_sender_key_with_version_inner, load_peer_sender_key_inner,
    store_own_sender_key_with_version_inner, store_peer_sender_key_with_version_inner,
    SenderKeyState,
};
use crate::store::token_store::{delete_token_inner, load_token_inner, store_token_inner};

use super::e2ee::{
    IdentityKeyBundle, OneTimePreKey, SenderKeyBundle, SenderKeyEncryptedMessage,
    SignedPreKeyBundle,
};

pub(crate) fn get_or_create_device_core(
    conn: &Connection,
    device_name: &str,
) -> Result<DeviceInfo, String> {
    if let Some(mut info) = load_device_info_inner(conn)? {
        // [EN] Existing device rows keep their identity; only the display name is refreshed.
        // [中] 既有裝置資料保留身分識別，只刷新顯示名稱。
        // [日] 既存の端末行は identity を維持し、表示名だけを更新する。
        info.device_name = device_name.to_string();
        store_device_info_inner(conn, &info)?;
        return Ok(info);
    }

    // [EN] First launch creates the local device identity before any user logs in.
    // [中] 首次啟動會在任何使用者登入前建立本地裝置身分。
    // [日] 初回起動では、ユーザーがログインする前にローカル端末 identity を作成する。
    let info = DeviceInfo {
        device_id: Uuid::new_v4().to_string(),
        platform: std::env::consts::OS.to_string(),
        device_name: device_name.to_string(),
        registered: false,
        created_at: Utc::now().timestamp_millis(),
    };
    store_device_info_inner(conn, &info)?;
    Ok(info)
}

pub(crate) fn update_device_registration_core(
    conn: &Connection,
    registered: bool,
) -> Result<(), String> {
    update_device_registered_inner(conn, registered)
}

pub(crate) fn clear_device_core(conn: &Connection) -> Result<(), String> {
    clear_device_info_inner(conn)
}

pub(crate) fn save_auth_token_core(
    conn: &Connection,
    key: &[u8; 32],
    account_id: &str,
    token: &str,
) -> Result<(), String> {
    store_token_inner(conn, key, account_id, token)
}

pub(crate) fn get_auth_token_by_account_core(
    conn: &Connection,
    key: &[u8; 32],
    account_id: &str,
) -> Result<Option<String>, String> {
    load_token_inner(conn, key, account_id)
}

pub(crate) fn clear_auth_token_core(conn: &Connection, account_id: &str) -> Result<(), String> {
    delete_token_inner(conn, account_id)
}

pub(crate) fn generate_identity_keys_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
) -> Result<IdentityKeyBundle, String> {
    let dh_secret = StaticSecret::from(rand::random::<[u8; 32]>());
    let dh_public = PublicKey::from(&dh_secret);
    store_identity_key_inner(
        conn,
        key,
        user_id,
        "ik_dh",
        dh_secret.as_bytes(),
        &dh_public.to_bytes(),
    )?;

    let sign_secret = SigningKey::from_bytes(&rand::random::<[u8; 32]>());
    let sign_public = sign_secret.verifying_key();
    store_identity_key_inner(
        conn,
        key,
        user_id,
        "ik_sign",
        sign_secret.as_bytes(),
        &sign_public.to_bytes(),
    )?;

    Ok(IdentityKeyBundle {
        identity_key_dh_pub: dh_public.to_bytes(),
        identity_key_sign_pub: sign_public.to_bytes(),
    })
}

/// Read the public keys of the existing identity key pair for `user_id`.
/// Does NOT require the master key — public keys are stored in plaintext.
/// Returns Err if no identity keys have been generated yet.
pub(crate) fn get_identity_keys_core(
    conn: &Connection,
    user_id: &str,
) -> Result<IdentityKeyBundle, String> {
    let (dh_pub, sign_pub) = load_identity_public_keys_inner(conn, user_id)?;
    Ok(IdentityKeyBundle {
        identity_key_dh_pub: dh_pub,
        identity_key_sign_pub: sign_pub,
    })
}

/// Read the public key and signature of an existing signed pre-key for `user_id`.
/// Does NOT require the master key — public key and signature are stored in plaintext.
/// Returns Err if the key with `key_id` does not exist.
pub(crate) fn get_signed_pre_key_core(
    conn: &Connection,
    user_id: &str,
    key_id: u32,
) -> Result<SignedPreKeyBundle, String> {
    let (pub_key, signature) = load_signed_pre_key_public_inner(conn, user_id, key_id)?;
    Ok(SignedPreKeyBundle {
        public_key: pub_key,
        signature,
        key_id,
    })
}

pub(crate) fn has_identity_keys_core(conn: &Connection, user_id: &str) -> Result<bool, String> {
    Ok(has_identity_key_inner(conn, user_id, "ik_dh")?
        && has_identity_key_inner(conn, user_id, "ik_sign")?)
}

pub(crate) fn validate_e2ee_key_material_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    spk_key_id: u32,
) -> Result<bool, String> {
    let identity_valid = validate_identity_keys_core(conn, key, user_id)?;
    if !identity_valid {
        return Ok(false);
    }
    validate_signed_pre_key_core(conn, key, user_id, spk_key_id)
}

pub(crate) fn validate_identity_keys_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
) -> Result<bool, String> {
    if !has_identity_keys_core(conn, user_id)? {
        return Ok(false);
    }

    load_identity_key_inner(conn, key, user_id, "ik_dh")
        .map_err(|e| format!("validate ik_dh failed: {e}"))?;
    load_identity_key_inner(conn, key, user_id, "ik_sign")
        .map_err(|e| format!("validate ik_sign failed: {e}"))?;

    Ok(true)
}

pub(crate) fn validate_signed_pre_key_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    key_id: u32,
) -> Result<bool, String> {
    if !has_signed_pre_key_inner(conn, user_id, key_id)? {
        return Ok(false);
    }

    load_signed_pre_key_inner(conn, key, user_id, key_id)
        .map_err(|e| format!("validate signed pre-key failed: {e}"))?;

    Ok(true)
}

pub(crate) fn generate_signed_pre_key_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    key_id: u32,
) -> Result<SignedPreKeyBundle, String> {
    let spk_secret = StaticSecret::from(rand::random::<[u8; 32]>());
    let spk_public = PublicKey::from(&spk_secret);

    let sign_bytes = load_identity_key_inner(conn, key, user_id, "ik_sign")?;
    let sign_secret = SigningKey::from_bytes(&sign_bytes);
    let signature = sign_secret.sign(spk_public.as_bytes());

    store_signed_pre_key_inner(
        conn,
        key,
        user_id,
        key_id,
        spk_secret.as_bytes(),
        &spk_public.to_bytes(),
        &signature.to_bytes(),
    )?;

    Ok(SignedPreKeyBundle {
        public_key: spk_public.to_bytes(),
        signature: signature.to_bytes(),
        key_id,
    })
}

pub(crate) fn replenish_otp_keys_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    count: u32,
) -> Result<Vec<OneTimePreKey>, String> {
    let ids = next_opk_ids_inner(conn, user_id, count)?;
    let mut result = Vec::with_capacity(ids.len());

    for key_id in ids {
        let opk_secret = StaticSecret::from(rand::random::<[u8; 32]>());
        let opk_public = PublicKey::from(&opk_secret);
        store_otp_key_inner(
            conn,
            key,
            user_id,
            key_id,
            opk_secret.as_bytes(),
            &opk_public.to_bytes(),
        )?;
        result.push(OneTimePreKey {
            key_id,
            public_key: opk_public.to_bytes(),
        });
    }

    Ok(result)
}

pub(crate) fn perform_x3dh_send_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    bundle: &PublicKeyBundle,
    plaintext: &[u8],
) -> Result<InitialMessage, String> {
    let ik_dh = StaticSecret::from(load_identity_key_inner(conn, key, user_id, "ik_dh")?);
    let ik_sign = SigningKey::from_bytes(&load_identity_key_inner(conn, key, user_id, "ik_sign")?);
    x3dh_sender(&ik_dh, &ik_sign, bundle, plaintext)
}

pub(crate) fn perform_x3dh_receive_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    msg: &InitialMessage,
    spk_key_id: u32,
    otpk_key_id: Option<u32>,
) -> Result<Vec<u8>, String> {
    let ik = StaticSecret::from(load_identity_key_inner(conn, key, user_id, "ik_dh")?);
    let spk = StaticSecret::from(load_signed_pre_key_inner(conn, key, user_id, spk_key_id)?);
    let opk: Option<StaticSecret> = otpk_key_id
        .map(|id| -> Result<StaticSecret, String> {
            Ok(StaticSecret::from(load_otp_key_inner(
                conn, key, user_id, id,
            )?))
        })
        .transpose()?;

    let plaintext = x3dh_receiver(&ik, &spk, opk.as_ref(), msg)?;

    if let Some(id) = otpk_key_id {
        delete_otp_key_inner(conn, user_id, id)?;
    }

    Ok(plaintext)
}

pub(crate) fn generate_sender_key_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
) -> Result<SenderKeyBundle, String> {
    let sender_key = rand::random::<[u8; 32]>();
    let sender_key_version = Utc::now().timestamp_millis();
    store_own_sender_key_with_version_inner(
        conn,
        key,
        user_id,
        member_id,
        &sender_key,
        sender_key_version,
    )?;
    Ok(SenderKeyBundle { sender_key_version })
}

pub(crate) fn has_sender_key_core(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
) -> Result<bool, String> {
    has_sender_key_inner(conn, user_id, member_id)
}

pub(crate) fn store_member_sender_key_core(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
    key_bytes: Vec<u8>,
) -> Result<(), String> {
    store_member_sender_key_with_version_core(
        conn,
        user_id,
        member_id,
        key_bytes,
        Utc::now().timestamp_millis(),
    )
}

pub(crate) fn store_member_sender_key_with_version_core(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
    key_bytes: Vec<u8>,
    sender_key_version: i64,
) -> Result<(), String> {
    let sk_bytes: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| "sender key must be exactly 32 bytes".to_string())?;
    store_peer_sender_key_with_version_inner(
        conn,
        user_id,
        member_id,
        &sk_bytes,
        sender_key_version,
    )
}

pub(crate) fn encrypt_with_sender_key_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
    plaintext: &[u8],
) -> Result<SenderKeyEncryptedMessage, String> {
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit};

    let sk_bytes = load_own_sender_key_inner(conn, key, user_id, member_id)?;
    let cipher =
        Aes256Gcm::new_from_slice(&sk_bytes).map_err(|e| format!("invalid sender key: {e}"))?;

    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = aes_gcm::Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("encryption failed: {e}"))?;

    Ok(SenderKeyEncryptedMessage {
        ciphertext,
        nonce: nonce_bytes,
    })
}

pub(crate) enum SenderKeyDecryptResult {
    Ok { plaintext: Vec<u8> },
    MissingKey,
    StaleKey,
}

pub(crate) fn decrypt_with_sender_key_result_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
    ciphertext: &[u8],
    nonce: &[u8],
) -> Result<SenderKeyDecryptResult, String> {
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit};

    let nonce_arr: [u8; 12] = nonce
        .try_into()
        .map_err(|_| "nonce must be exactly 12 bytes".to_string())?;

    // Peer key for others' messages (is_private=0, stored plaintext).
    // Falls back to own key for own messages returning from the server (is_private=1, encrypted).
    let (sk_bytes, has_local_state) = match load_peer_sender_key_inner(conn, user_id, member_id) {
        Ok(bytes) => (bytes, true),
        Err(_) => match load_own_sender_key_inner(conn, key, user_id, member_id) {
            Ok(bytes) => (bytes, true),
            Err(_) => ([0u8; 32], false),
        },
    };
    if !has_local_state {
        return Ok(SenderKeyDecryptResult::MissingKey);
    }

    let cipher =
        Aes256Gcm::new_from_slice(&sk_bytes).map_err(|e| format!("invalid sender key: {e}"))?;
    let nonce_ref = aes_gcm::Nonce::from_slice(&nonce_arr);
    match cipher.decrypt(nonce_ref, ciphertext) {
        Ok(plaintext) => Ok(SenderKeyDecryptResult::Ok { plaintext }),
        Err(_) => Ok(SenderKeyDecryptResult::StaleKey),
    }
}

pub(crate) fn get_sender_key_states_core(
    conn: &Connection,
    user_id: &str,
    member_ids: &[String],
) -> Result<Vec<SenderKeyState>, String> {
    list_sender_key_states_inner(conn, user_id, member_ids)
}

pub(crate) fn delete_sender_keys_core(
    conn: &Connection,
    user_id: &str,
    member_ids: &[String],
) -> Result<usize, String> {
    delete_sender_keys_inner(conn, user_id, member_ids)
}

pub(crate) struct PreparedSenderKeyDistribution {
    pub distribution_message: Vec<u8>,
    pub sender_key_version: i64,
}

pub(crate) fn prepare_sender_key_distribution_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
    bundle: &PublicKeyBundle,
) -> Result<PreparedSenderKeyDistribution, String> {
    let (sender_key_bytes, sender_key_version) =
        match load_own_sender_key_with_version_inner(conn, key, user_id, member_id) {
            Ok(existing) => existing,
            Err(_) => {
                let sender_key = rand::random::<[u8; 32]>();
                let sender_key_version = Utc::now().timestamp_millis();
                store_own_sender_key_with_version_inner(
                    conn,
                    key,
                    user_id,
                    member_id,
                    &sender_key,
                    sender_key_version,
                )?;
                (sender_key, sender_key_version)
            }
        };

    let initial_msg = perform_x3dh_send_core(conn, key, user_id, bundle, &sender_key_bytes)?;
    let distribution_message = serde_json::to_vec(&initial_msg)
        .map_err(|e| format!("serialize sender key distribution failed: {e}"))?;

    Ok(PreparedSenderKeyDistribution {
        distribution_message,
        sender_key_version,
    })
}

pub(crate) enum ConsumeSenderKeyDistributionResult {
    Consumed,
    Stale,
    Failed,
}

pub(crate) fn consume_sender_key_distribution_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    sender_member_id: &str,
    distribution_message: &[u8],
    sender_key_version: i64,
) -> Result<ConsumeSenderKeyDistributionResult, String> {
    if let Some(existing) = get_sender_key_state_inner(conn, user_id, sender_member_id)? {
        if existing.sender_key_version >= sender_key_version {
            return Ok(ConsumeSenderKeyDistributionResult::Stale);
        }
    }

    let initial_msg: InitialMessage = serde_json::from_slice(distribution_message)
        .map_err(|e| format!("parse sender key distribution failed: {e}"))?;

    let key_bytes = match perform_x3dh_receive_core(
        conn,
        key,
        user_id,
        &initial_msg,
        initial_msg.spk_key_id,
        initial_msg.otpk_key_id,
    ) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(ConsumeSenderKeyDistributionResult::Failed),
    };

    store_member_sender_key_with_version_core(
        conn,
        user_id,
        sender_member_id,
        key_bytes,
        sender_key_version,
    )?;

    Ok(ConsumeSenderKeyDistributionResult::Consumed)
}

/// Return value of `bootstrap_local_e2ee_keys_core`.
pub(crate) struct LocalBootstrapResult {
    pub identity_keys: IdentityKeyBundle,
    pub spk: SignedPreKeyBundle,
    pub identity_regenerated: bool,
    pub spk_regenerated: bool,
}

/// Bootstrap local E2EE key material using a **single** master-key read.
///
/// Validates IK and SPK against `key`.  On validation failure (e.g. master-key
/// mismatch between keychain calls) the existing `identity_keys` and
/// `signed_pre_keys` rows are deleted before clean regeneration so that the
/// UPSERT path cannot silently leave stale ciphertext behind.
/// `one_time_pre_keys`, `opk_counter`, and `sender_keys` are never touched.
pub(crate) fn bootstrap_local_e2ee_keys_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    spk_key_id: u32,
) -> Result<LocalBootstrapResult, String> {
    // ── Identity keys ─────────────────────────────────────────────
    let (identity_keys, identity_regenerated) = {
        let ik_exists = has_identity_keys_core(conn, user_id)?;
        let ik_valid =
            ik_exists && validate_identity_keys_core(conn, key, user_id).unwrap_or(false);

        if ik_valid {
            let ik = get_identity_keys_core(conn, user_id)?;
            (ik, false)
        } else {
            // Corrupted or missing: delete IK + SPK first, then regenerate
            // with the current key so all subsequent reads in this call succeed.
            delete_identity_and_spk_for_user_inner(conn, user_id)?;
            let ik = generate_identity_keys_core(conn, key, user_id)?;
            (ik, true)
        }
    };

    // ── Signed pre-key ────────────────────────────────────────────
    let (spk, spk_regenerated) = if !identity_regenerated {
        let spk_exists = has_signed_pre_key_inner(conn, user_id, spk_key_id)?;
        let spk_valid = spk_exists
            && validate_signed_pre_key_core(conn, key, user_id, spk_key_id).unwrap_or(false);

        if spk_valid {
            let spk = get_signed_pre_key_core(conn, user_id, spk_key_id)?;
            (spk, false)
        } else {
            let spk = generate_signed_pre_key_core(conn, key, user_id, spk_key_id)?;
            (spk, true)
        }
    } else {
        // IK was regenerated: SPK must be regenerated to sign with the new ik_sign.
        let spk = generate_signed_pre_key_core(conn, key, user_id, spk_key_id)?;
        (spk, true)
    };

    Ok(LocalBootstrapResult {
        identity_keys,
        spk,
        identity_regenerated,
        spk_regenerated,
    })
}

pub(crate) fn clear_e2ee_keys_core(conn: &Connection, user_id: &str) -> Result<(), String> {
    clear_all_keys_for_user_inner(conn, user_id)
}

pub(crate) fn store_encrypted_message_core(
    conn: &Connection,
    message_id: &str,
    room_id: &str,
    sender_id: &str,
    encrypted_content: Vec<u8>,
    message_type: &str,
    spk_key_id: Option<u32>,
    otpk_key_id: Option<u32>,
    server_timestamp: i64,
) -> Result<(), String> {
    store_encrypted_message_inner(
        conn,
        message_id,
        room_id,
        sender_id,
        &encrypted_content,
        message_type,
        spk_key_id,
        otpk_key_id,
        server_timestamp,
    )
}

pub(crate) fn get_encrypted_messages_core(
    conn: &Connection,
    room_id: &str,
    limit: u32,
    before_timestamp: Option<i64>,
) -> Result<Vec<EncryptedMessageRow>, String> {
    get_encrypted_messages_inner(conn, room_id, limit, before_timestamp)
}

pub(crate) fn store_decrypted_message_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    message_id: &str,
    room_id: &str,
    sender_id: &str,
    plaintext: Vec<u8>,
    content_type: &str,
    message_timestamp: i64,
    reply_to_id: Option<&str>,
    is_edited: bool,
    is_deleted: bool,
) -> Result<(), String> {
    store_decrypted_message_inner(
        conn,
        key,
        user_id,
        message_id,
        room_id,
        sender_id,
        &plaintext,
        content_type,
        message_timestamp,
        reply_to_id,
        is_edited,
        is_deleted,
    )
}

pub(crate) fn get_decrypted_messages_core(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    room_id: &str,
    limit: u32,
    before_timestamp: Option<i64>,
) -> Result<Vec<DecryptedMessageRow>, String> {
    get_decrypted_messages_inner(conn, key, user_id, room_id, limit, before_timestamp)
}
