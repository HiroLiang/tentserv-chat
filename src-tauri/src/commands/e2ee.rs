//! # E2EE Commands
//!
//! Signal Protocol key management exposed to the TypeScript frontend.
//!
//! ## Key hierarchy
//! - **Identity keys** (`ik_dh` X25519, `ik_sign` Ed25519) — generated once per account
//! - **Signed pre-key (SPK)** — X25519, signed by `ik_sign`, rotated periodically
//! - **One-time pre-keys (OPK)** — batch X25519 keys consumed once per X3DH exchange
//! - **Sender keys** — per-(local account, member_id, device_id) keys for room encryption
//!
//! ## Sender key semantics
//! Sender keys are keyed by `(local account_id, member_id, device_id)`. `room_id` is not used
//! because `member_id` (`chat_members.id`) is a globally unique sequence PK while `device_id`
//! identifies the actual sender device.
//! - **Own key** (`key_scope='own'`): the caller's current-device key, stored encrypted.
//! - **Peer key** (`key_scope='peer'`): another device's sender key, stored plaintext.

use serde::{Deserialize, Serialize};
use serde_with::serde_as;

use crate::commands::core::{
    bootstrap_local_e2ee_keys_core, clear_e2ee_keys_core, consume_sender_key_distribution_core,
    consume_sender_key_distribution_for_member_core, decrypt_with_sender_key_result_core,
    delete_sender_keys_core, encrypt_with_sender_key_core, generate_identity_keys_core,
    generate_sender_key_core, generate_signed_pre_key_core, get_identity_keys_core,
    get_sender_key_states_core, get_signed_pre_key_core, has_identity_keys_core,
    has_sender_key_core, perform_x3dh_receive_core, perform_x3dh_send_core,
    prepare_sender_key_distribution_core, replenish_otp_keys_core, store_member_sender_key_core,
    validate_e2ee_key_material_core, validate_identity_keys_core, validate_signed_pre_key_core,
    ConsumeSenderKeyDistributionResult, PreparedSenderKeyDistribution, SenderKeyDecryptResult,
};
use crate::crypto::x3dh::{InitialMessage, PublicKeyBundle};
use crate::store::db::{get_or_create_master_key, open_db};

// ── Return types ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct IdentityKeyBundle {
    pub identity_key_dh_pub: [u8; 32],
    pub identity_key_sign_pub: [u8; 32],
}

#[serde_as]
#[derive(Serialize, Deserialize)]
pub struct SignedPreKeyBundle {
    pub public_key: [u8; 32],
    #[serde_as(as = "serde_with::Bytes")]
    pub signature: [u8; 64],
    pub key_id: u32,
}

#[derive(Serialize, Deserialize)]
pub struct OneTimePreKey {
    pub key_id: u32,
    pub public_key: [u8; 32],
}

#[derive(Serialize, Deserialize)]
pub struct SenderKeyBundle {
    pub sender_key_version: i64,
}

#[derive(Serialize)]
pub struct SenderKeyEncryptedMessage {
    pub ciphertext: Vec<u8>,
    pub nonce: [u8; 12],
    pub sender_key_version: i64,
}

#[derive(Serialize, Deserialize)]
pub struct SenderKeyStatePayload {
    pub member_id: String,
    pub device_id: String,
    pub key_scope: String,
    pub is_own_key: bool,
    pub sender_key_version: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize)]
pub struct PreparedSenderKeyDistributionPayload {
    pub distribution_message: Vec<u8>,
    pub sender_key_version: i64,
}

#[derive(Serialize, Deserialize)]
pub struct ConsumeSenderKeyDistributionPayload {
    pub status: String,
}

#[derive(Serialize, Deserialize)]
pub struct DecryptSenderKeyPayload {
    pub status: String,
    pub plaintext: Option<Vec<u8>>,
}

// ── Identity key commands ─────────────────────────────────────────

/// Generate a fresh X25519 + Ed25519 identity key pair for `account_id`.
/// Returns the public keys for upload to the server.
#[tauri::command]
pub async fn generate_identity_keys(
    app: tauri::AppHandle,
    account_id: String,
) -> Result<IdentityKeyBundle, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
    generate_identity_keys_core(&conn, &key, &account_id)
}

/// Read the public keys of the existing identity key pair for `account_id`.
/// Does NOT create or fetch the master key — public keys are stored in plaintext.
/// Returns an error if no identity keys have been generated yet.
#[tauri::command]
pub async fn get_identity_keys(
    app: tauri::AppHandle,
    account_id: String,
) -> Result<IdentityKeyBundle, String> {
    let conn = open_db(&app)?;
    get_identity_keys_core(&conn, &account_id)
}

/// Read the public key and signature of an existing signed pre-key for `account_id`.
/// Does NOT create or fetch the master key — both fields are stored in plaintext.
/// Returns an error if the key with `key_id` does not exist.
#[tauri::command]
pub async fn get_signed_pre_key(
    app: tauri::AppHandle,
    account_id: String,
    key_id: u32,
) -> Result<SignedPreKeyBundle, String> {
    let conn = open_db(&app)?;
    get_signed_pre_key_core(&conn, &account_id, key_id)
}

/// Return `true` if both `ik_dh` and `ik_sign` exist for `account_id`.
#[tauri::command]
pub fn has_identity_keys(app: tauri::AppHandle, account_id: String) -> Result<bool, String> {
    let conn = open_db(&app)?;
    has_identity_keys_core(&conn, &account_id)
}

/// Return true only when identity keys and the requested signed pre-key exist
/// locally and their encrypted private bytes can be decrypted with this user's
/// current master key.
#[tauri::command]
pub fn validate_e2ee_key_material(
    app: tauri::AppHandle,
    account_id: String,
    spk_key_id: u32,
) -> Result<bool, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
    validate_e2ee_key_material_core(&conn, &key, &account_id, spk_key_id)
}

#[tauri::command]
pub fn validate_identity_keys(app: tauri::AppHandle, account_id: String) -> Result<bool, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
    validate_identity_keys_core(&conn, &key, &account_id)
}

#[tauri::command]
pub fn validate_signed_pre_key(
    app: tauri::AppHandle,
    account_id: String,
    key_id: u32,
) -> Result<bool, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
    validate_signed_pre_key_core(&conn, &key, &account_id, key_id)
}

// ── Pre-key commands ──────────────────────────────────────────────

/// Generate a new Signed Pre-Key for `account_id` with `key_id`.
/// Signs the public key with `ik_sign`; returns public key + signature for upload.
#[tauri::command]
pub async fn generate_signed_pre_key(
    app: tauri::AppHandle,
    account_id: String,
    key_id: u32,
) -> Result<SignedPreKeyBundle, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
    generate_signed_pre_key_core(&conn, &key, &account_id, key_id)
}

/// Generate `count` new One-Time Pre-Keys for `account_id`.
/// Key IDs are allocated from a monotonic counter — they never repeat.
#[tauri::command]
pub async fn replenish_otp_keys(
    app: tauri::AppHandle,
    account_id: String,
    count: u32,
) -> Result<Vec<OneTimePreKey>, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
    replenish_otp_keys_core(&conn, &key, &account_id, count)
}

// ── X3DH commands ─────────────────────────────────────────────────

/// Run X3DH as the sender: encrypt `plaintext` using the recipient's `PublicKeyBundle`.
/// Returns the `InitialMessage` (ephemeral public key + ciphertext) to send to the server.
#[tauri::command]
pub async fn perform_x3dh_send(
    app: tauri::AppHandle,
    account_id: String,
    bundle: PublicKeyBundle,
    plaintext: Vec<u8>,
) -> Result<InitialMessage, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
    perform_x3dh_send_core(&conn, &key, &account_id, &bundle, &plaintext)
}

/// Run X3DH as the receiver: derive the shared secret and decrypt `msg`.
/// Deletes the consumed OTP key (if any) after successful decryption.
#[tauri::command]
pub async fn perform_x3dh_receive(
    app: tauri::AppHandle,
    account_id: String,
    msg: InitialMessage,
    spk_key_id: u32,
    otpk_key_id: Option<u32>,
) -> Result<Vec<u8>, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
    perform_x3dh_receive_core(&conn, &key, &account_id, &msg, spk_key_id, otpk_key_id)
}

// ── Sender key commands ───────────────────────────────────────────
//
// `member_id` = chat_members.id of the key owner (globally unique sequence PK).
// It is NOT the same as `account_id`, remote user id, or `participant_id`.

/// Generate a new sender key for `account_id` with their participant `member_id`.
/// Returns the public key for distribution to other participants.
#[tauri::command]
pub async fn generate_sender_key(
    app: tauri::AppHandle,
    account_id: String,
    member_id: String,
    device_id: String,
) -> Result<SenderKeyBundle, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
    generate_sender_key_core(&conn, &key, &account_id, &member_id, &device_id)
}

/// Return `true` if a sender key exists for `(account_id, member_id, device_id)`.
#[tauri::command]
pub fn has_sender_key(
    app: tauri::AppHandle,
    account_id: String,
    member_id: String,
    device_id: String,
) -> Result<bool, String> {
    let conn = open_db(&app)?;
    has_sender_key_core(&conn, &account_id, &member_id, &device_id)
}

#[tauri::command]
pub fn get_sender_key_states(
    app: tauri::AppHandle,
    account_id: String,
    member_ids: Vec<String>,
) -> Result<Vec<SenderKeyStatePayload>, String> {
    let conn = open_db(&app)?;
    let states = get_sender_key_states_core(&conn, &account_id, &member_ids)?;
    Ok(states
        .into_iter()
        .map(|state| SenderKeyStatePayload {
            member_id: state.member_id,
            device_id: state.device_id,
            key_scope: state.key_scope,
            is_own_key: state.is_own_key,
            sender_key_version: state.sender_key_version,
            updated_at: state.updated_at,
        })
        .collect())
}

#[tauri::command]
pub fn delete_sender_keys(
    app: tauri::AppHandle,
    account_id: String,
    member_ids: Vec<String>,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    delete_sender_keys_core(&conn, &account_id, &member_ids)?;
    Ok(())
}

/// Store a peer's sender key received after X3DH decryption.
/// `key_bytes` must be exactly 32 bytes.  The key is stored as plaintext
/// (it is a public sender key — no encryption needed).
#[tauri::command]
pub async fn store_member_sender_key(
    app: tauri::AppHandle,
    account_id: String,
    member_id: String,
    device_id: String,
    key_bytes: Vec<u8>,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    store_member_sender_key_core(&conn, &account_id, &member_id, &device_id, key_bytes)
}

#[tauri::command]
pub async fn prepare_sender_key_distribution(
    app: tauri::AppHandle,
    account_id: String,
    own_member_id: String,
    own_device_id: String,
    requester_bundle: PublicKeyBundle,
) -> Result<PreparedSenderKeyDistributionPayload, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
    let prepared: PreparedSenderKeyDistribution = prepare_sender_key_distribution_core(
        &conn,
        &key,
        &account_id,
        &own_member_id,
        &own_device_id,
        &requester_bundle,
    )?;
    Ok(PreparedSenderKeyDistributionPayload {
        distribution_message: prepared.distribution_message,
        sender_key_version: prepared.sender_key_version,
    })
}

#[tauri::command]
pub async fn consume_sender_key_distribution(
    app: tauri::AppHandle,
    account_id: String,
    sender_member_id: String,
    sender_device_id: String,
    receiver_member_id: Option<String>,
    receiver_device_id: Option<String>,
    distribution_message: Vec<u8>,
    sender_key_version: i64,
) -> Result<ConsumeSenderKeyDistributionPayload, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
    let result = match receiver_member_id.as_deref() {
        Some(receiver_member_id) => consume_sender_key_distribution_for_member_core(
            &conn,
            &key,
            &account_id,
            &sender_member_id,
            &sender_device_id,
            Some(receiver_member_id),
            receiver_device_id.as_deref(),
            &distribution_message,
            sender_key_version,
        )?,
        None => consume_sender_key_distribution_core(
            &conn,
            &key,
            &account_id,
            &sender_member_id,
            &sender_device_id,
            &distribution_message,
            sender_key_version,
        )?,
    };
    let status = match result {
        ConsumeSenderKeyDistributionResult::Consumed => "consumed",
        ConsumeSenderKeyDistributionResult::Stale => "stale",
        ConsumeSenderKeyDistributionResult::Failed => "failed",
    };
    Ok(ConsumeSenderKeyDistributionPayload {
        status: status.to_string(),
    })
}

/// Encrypt `plaintext` with the caller's own sender key for `member_id`.
#[tauri::command]
pub async fn encrypt_with_sender_key(
    app: tauri::AppHandle,
    account_id: String,
    member_id: String,
    device_id: String,
    plaintext: Vec<u8>,
) -> Result<SenderKeyEncryptedMessage, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
    encrypt_with_sender_key_core(&conn, &key, &account_id, &member_id, &device_id, &plaintext)
}

/// Decrypt `ciphertext` using the sender key for `(member_id, device_id, sender_key_version)`.
#[tauri::command]
pub async fn decrypt_with_sender_key(
    app: tauri::AppHandle,
    account_id: String,
    member_id: String,
    device_id: String,
    sender_key_version: i64,
    ciphertext: Vec<u8>,
    nonce: Vec<u8>,
) -> Result<DecryptSenderKeyPayload, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
    let result = decrypt_with_sender_key_result_core(
        &conn,
        &key,
        &account_id,
        &member_id,
        &device_id,
        sender_key_version,
        &ciphertext,
        &nonce,
    )?;
    Ok(match result {
        SenderKeyDecryptResult::Ok { plaintext } => DecryptSenderKeyPayload {
            status: "ok".to_string(),
            plaintext: Some(plaintext),
        },
        SenderKeyDecryptResult::MissingKey => DecryptSenderKeyPayload {
            status: "missing_key".to_string(),
            plaintext: None,
        },
        SenderKeyDecryptResult::StaleKey => DecryptSenderKeyPayload {
            status: "stale_key".to_string(),
            plaintext: None,
        },
    })
}

// ── Bootstrap (combined local key lifecycle) ──────────────────────

/// Return value of `bootstrap_local_e2ee_keys`.
/// Carries the public material needed for remote key-status reconciliation.
#[derive(Serialize)]
pub struct LocalBootstrapResult {
    pub identity_keys: IdentityKeyBundle,
    pub spk: SignedPreKeyBundle,
    pub identity_regenerated: bool,
    pub spk_regenerated: bool,
}

/// Bootstrap all local E2EE key material in a single call.
///
/// Obtains the master key **once**, then validates IK and the initial SPK.
/// If either is missing or unreadable (AEAD mismatch), the `identity_keys`
/// and `signed_pre_keys` rows are cleared and regenerated cleanly with the
/// current key.  OTP keys and sender keys are never touched.
///
/// Replaces the previous multi-command pattern of separate `validate_identity_keys`,
/// `generate_identity_keys`, and `generate_signed_pre_key` calls, which could
/// each receive a different ephemeral master key when the OS keychain entry was
/// unstable, leaving newly written material unreadable by the next call.
#[tauri::command]
pub async fn bootstrap_local_e2ee_keys(
    app: tauri::AppHandle,
    account_id: String,
    spk_key_id: u32,
) -> Result<LocalBootstrapResult, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
    let r = bootstrap_local_e2ee_keys_core(&conn, &key, &account_id, spk_key_id)?;
    Ok(LocalBootstrapResult {
        identity_keys: r.identity_keys,
        spk: r.spk,
        identity_regenerated: r.identity_regenerated,
        spk_regenerated: r.spk_regenerated,
    })
}

// ── Lifecycle ─────────────────────────────────────────────────────

/// Delete all E2EE key material for `account_id`.
/// Auth tokens are NOT cleared here — call `clear_auth_token` separately on logout.
#[tauri::command]
pub fn clear_e2ee_keys(app: tauri::AppHandle, account_id: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    clear_e2ee_keys_core(&conn, &account_id)
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "tests/e2ee_tests.rs"]
mod tests;
