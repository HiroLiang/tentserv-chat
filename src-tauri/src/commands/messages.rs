//! # Message Commands
//!
//! Tauri commands that proxy message storage to the `store::message_store` module.
//! No business logic lives here — commands are thin adapters between the TypeScript
//! frontend and the SQLite persistence layer.

use crate::commands::core::{
    get_decrypted_messages_core, get_encrypted_messages_core, store_decrypted_message_core,
    store_encrypted_message_core,
};
use crate::store::db::{get_or_create_master_key, open_db};
use crate::store::message_store::{DecryptedMessageRow, EncryptedMessageRow};

// ── Encrypted messages ────────────────────────────────────────────

/// Persist a raw E2EE ciphertext blob pulled from the server.
/// Idempotent — duplicate `message_id` inserts are silently ignored.
#[tauri::command]
pub async fn store_encrypted_message(
    app: tauri::AppHandle,
    message_id: String,
    room_id: String,
    sender_id: String,
    encrypted_content: Vec<u8>,
    message_type: String,
    spk_key_id: Option<u32>,
    otpk_key_id: Option<u32>,
    server_timestamp: i64,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    store_encrypted_message_core(
        &conn,
        &message_id,
        &room_id,
        &sender_id,
        encrypted_content,
        &message_type,
        spk_key_id,
        otpk_key_id,
        server_timestamp,
    )
}

/// Fetch encrypted messages for `room_id`, newest first.
/// Pass `before_timestamp` to paginate older pages.
#[tauri::command]
pub async fn get_encrypted_messages(
    app: tauri::AppHandle,
    room_id: String,
    limit: u32,
    before_timestamp: Option<i64>,
) -> Result<Vec<EncryptedMessageRow>, String> {
    let conn = open_db(&app)?;
    get_encrypted_messages_core(&conn, &room_id, limit, before_timestamp)
}

// ── Decrypted messages ────────────────────────────────────────────

/// Store a decrypted plaintext, re-encrypted with the user's local master key.
#[tauri::command]
pub async fn store_decrypted_message(
    app: tauri::AppHandle,
    user_id: String,
    message_id: String,
    room_id: String,
    sender_id: String,
    plaintext: Vec<u8>,
    content_type: String,
    message_timestamp: i64,
    reply_to_id: Option<String>,
    is_edited: bool,
    is_deleted: bool,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&user_id)?;
    store_decrypted_message_core(
        &conn,
        &key,
        &user_id,
        &message_id,
        &room_id,
        &sender_id,
        plaintext,
        &content_type,
        message_timestamp,
        reply_to_id.as_deref(),
        is_edited,
        is_deleted,
    )
}

/// Fetch decrypted messages for `(user_id, room_id)`, newest first.
/// Pass `before_timestamp` to paginate older pages.
#[tauri::command]
pub async fn get_decrypted_messages(
    app: tauri::AppHandle,
    user_id: String,
    room_id: String,
    limit: u32,
    before_timestamp: Option<i64>,
) -> Result<Vec<DecryptedMessageRow>, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&user_id)?;
    get_decrypted_messages_core(&conn, &key, &user_id, &room_id, limit, before_timestamp)
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "tests/message_tests.rs"]
mod tests;
