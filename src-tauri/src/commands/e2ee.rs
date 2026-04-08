//! # E2EE Commands
//!
//! Signal Protocol key management exposed to the TypeScript frontend.
//!
//! ## Key hierarchy
//! - **Identity keys** (`ik_dh` X25519, `ik_sign` Ed25519) — generated once per account
//! - **Signed pre-key (SPK)** — X25519, signed by `ik_sign`, rotated periodically
//! - **One-time pre-keys (OPK)** — batch X25519 keys consumed once per X3DH exchange
//! - **Sender keys** — per-(local account, member_id) keys for group message encryption
//!
//! ## Sender key semantics
//! Sender keys are keyed by `(local account_id, member_id)`.  `room_id` is not used because
//! `member_id` (`chat_members.id`) is a globally unique sequence PK.
//! - **Own key** (`is_private=1`): the caller's key, stored encrypted.
//! - **Peer key** (`is_private=0`): another participant's public key, stored plaintext.

use serde::{Deserialize, Serialize};
use serde_with::serde_as;

use crate::commands::core::{
    clear_e2ee_keys_core, decrypt_with_sender_key_core, encrypt_with_sender_key_core,
    generate_identity_keys_core, generate_sender_key_core, generate_signed_pre_key_core,
    get_identity_keys_core, get_signed_pre_key_core, has_identity_keys_core, has_sender_key_core,
    perform_x3dh_receive_core, perform_x3dh_send_core, replenish_otp_keys_core,
    store_member_sender_key_core, validate_e2ee_key_material_core,
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
    pub public_key: [u8; 32],
}

#[derive(Serialize)]
pub struct SenderKeyEncryptedMessage {
    pub ciphertext: Vec<u8>,
    pub nonce: [u8; 12],
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
    let key = get_or_create_master_key(&account_id)?;
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
    let key = get_or_create_master_key(&account_id)?;
    validate_e2ee_key_material_core(&conn, &key, &account_id, spk_key_id)
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
    let key = get_or_create_master_key(&account_id)?;
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
    let key = get_or_create_master_key(&account_id)?;
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
    let key = get_or_create_master_key(&account_id)?;
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
    let key = get_or_create_master_key(&account_id)?;
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
) -> Result<SenderKeyBundle, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&account_id)?;
    generate_sender_key_core(&conn, &key, &account_id, &member_id)
}

/// Return `true` if a sender key exists for `(account_id, member_id)`.
#[tauri::command]
pub fn has_sender_key(
    app: tauri::AppHandle,
    account_id: String,
    member_id: String,
) -> Result<bool, String> {
    let conn = open_db(&app)?;
    has_sender_key_core(&conn, &account_id, &member_id)
}

/// Store a peer's sender key received after X3DH decryption.
/// `key_bytes` must be exactly 32 bytes.  The key is stored as plaintext
/// (it is a public sender key — no encryption needed).
#[tauri::command]
pub async fn store_member_sender_key(
    app: tauri::AppHandle,
    account_id: String,
    member_id: String,
    key_bytes: Vec<u8>,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    store_member_sender_key_core(&conn, &account_id, &member_id, key_bytes)
}

/// Encrypt `plaintext` with the caller's own sender key for `member_id`.
#[tauri::command]
pub async fn encrypt_with_sender_key(
    app: tauri::AppHandle,
    account_id: String,
    member_id: String,
    plaintext: Vec<u8>,
) -> Result<SenderKeyEncryptedMessage, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&account_id)?;
    encrypt_with_sender_key_core(&conn, &key, &account_id, &member_id, &plaintext)
}

/// Decrypt `ciphertext` using the sender key for `member_id`.
/// Handles both peer messages (`is_private=0`) and own messages returning from the server (`is_private=1`).
#[tauri::command]
pub async fn decrypt_with_sender_key(
    app: tauri::AppHandle,
    account_id: String,
    member_id: String,
    ciphertext: Vec<u8>,
    nonce: Vec<u8>,
) -> Result<Vec<u8>, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&account_id)?;
    decrypt_with_sender_key_core(&conn, &key, &account_id, &member_id, &ciphertext, &nonce)
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
