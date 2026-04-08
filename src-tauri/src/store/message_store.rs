//! # Message Store
//!
//! Manages two message tables:
//!
//! ## `encrypted_messages`
//! Raw E2EE ciphertext pulled from the server.  Stored as-is so the app can
//! re-decrypt offline without re-running X3DH.  `INSERT OR IGNORE` makes
//! re-pulls idempotent — the first write wins.
//!
//! ## `decrypted_messages`
//! Plaintext decrypted from E2EE, then **re-encrypted** with the local
//! `db_master_key_{user_id}` before storage.  This keeps message history
//! readable offline without touching the Signal key material again.
//!
//! Both tables are paginated newest-first by timestamp.

use crate::store::db::{decrypt_bytes, encrypt_bytes};
use rusqlite::{params, Connection};
use serde::Serialize;

// ── Row types ─────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct EncryptedMessageRow {
    pub message_id: String,
    pub room_id: String,
    pub sender_id: String,
    pub encrypted_content: Vec<u8>,
    pub message_type: String,
    pub spk_key_id: Option<u32>,
    pub otpk_key_id: Option<u32>,
    pub server_timestamp: i64,
    pub received_at: i64,
}

#[derive(Serialize)]
pub struct DecryptedMessageRow {
    pub message_id: String,
    pub room_id: String,
    pub sender_id: String,
    pub plaintext: Vec<u8>,
    pub content_type: String,
    pub message_timestamp: i64,
    pub reply_to_id: Option<String>,
    pub is_edited: bool,
    pub is_deleted: bool,
}

// ── Encrypted messages (inner) ────────────────────────────────────

pub(crate) fn store_encrypted_message_inner(
    conn: &Connection,
    message_id: &str,
    room_id: &str,
    sender_id: &str,
    encrypted_content: &[u8],
    message_type: &str,
    spk_key_id: Option<u32>,
    otpk_key_id: Option<u32>,
    server_timestamp: i64,
) -> Result<(), String> {
    conn.execute(
        r#"INSERT OR IGNORE INTO encrypted_messages
               (message_id, room_id, sender_id, encrypted_content, message_type,
                spk_key_id, otpk_key_id, server_timestamp, received_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, unixepoch())"#,
        params![
            message_id,
            room_id,
            sender_id,
            encrypted_content,
            message_type,
            spk_key_id,
            otpk_key_id,
            server_timestamp
        ],
    )
    .map_err(|e| format!("store encrypted message failed: {e}"))?;
    Ok(())
}

pub(crate) fn get_encrypted_messages_inner(
    conn: &Connection,
    room_id: &str,
    limit: u32,
    before_timestamp: Option<i64>,
) -> Result<Vec<EncryptedMessageRow>, String> {
    let mut stmt = conn
        .prepare(
            r#"SELECT message_id, room_id, sender_id, encrypted_content, message_type,
                  spk_key_id, otpk_key_id, server_timestamp, received_at
           FROM encrypted_messages
           WHERE room_id = ?1 AND (?2 IS NULL OR server_timestamp < ?2)
           ORDER BY server_timestamp DESC
           LIMIT ?3"#,
        )
        .map_err(|e| format!("prepare get encrypted messages failed: {e}"))?;

    let rows = stmt
        .query_map(params![room_id, before_timestamp, limit], |row| {
            Ok(EncryptedMessageRow {
                message_id: row.get(0)?,
                room_id: row.get(1)?,
                sender_id: row.get(2)?,
                encrypted_content: row.get(3)?,
                message_type: row.get(4)?,
                spk_key_id: row.get(5)?,
                otpk_key_id: row.get(6)?,
                server_timestamp: row.get(7)?,
                received_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("query encrypted messages failed: {e}"))?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("collect encrypted messages failed: {e}"))
}

// ── Decrypted messages (inner) ────────────────────────────────────

pub(crate) fn store_decrypted_message_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    message_id: &str,
    room_id: &str,
    sender_id: &str,
    plaintext: &[u8],
    content_type: &str,
    message_timestamp: i64,
    reply_to_id: Option<&str>,
    is_edited: bool,
    is_deleted: bool,
) -> Result<(), String> {
    let (ciphertext, nonce) = encrypt_bytes(key, plaintext)?;
    conn.execute(
        r#"INSERT INTO decrypted_messages
               (message_id, user_id, room_id, sender_id, encrypted_plaintext, nonce,
                content_type, message_timestamp, updated_at, reply_to_id, is_edited, is_deleted)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, unixepoch(), ?9, ?10, ?11)
           ON CONFLICT(message_id, user_id) DO UPDATE SET
               encrypted_plaintext = excluded.encrypted_plaintext,
               nonce               = excluded.nonce,
               content_type        = excluded.content_type,
               message_timestamp   = excluded.message_timestamp,
               updated_at          = excluded.updated_at,
               reply_to_id         = excluded.reply_to_id,
               is_edited           = excluded.is_edited,
               is_deleted          = excluded.is_deleted"#,
        params![
            message_id,
            user_id,
            room_id,
            sender_id,
            ciphertext,
            nonce.to_vec(),
            content_type,
            message_timestamp,
            reply_to_id,
            is_edited as i64,
            is_deleted as i64
        ],
    )
    .map_err(|e| format!("store decrypted message failed: {e}"))?;
    Ok(())
}

pub(crate) fn get_decrypted_messages_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    room_id: &str,
    limit: u32,
    before_timestamp: Option<i64>,
) -> Result<Vec<DecryptedMessageRow>, String> {
    let mut stmt = conn
        .prepare(
            r#"SELECT message_id, room_id, sender_id,
                  encrypted_plaintext, nonce, content_type, message_timestamp,
                  reply_to_id, is_edited, is_deleted
           FROM decrypted_messages
           WHERE user_id = ?1 AND room_id = ?2 AND (?3 IS NULL OR message_timestamp < ?3)
           ORDER BY message_timestamp DESC
           LIMIT ?4"#,
        )
        .map_err(|e| format!("prepare get decrypted messages failed: {e}"))?;

    let rows = stmt
        .query_map(params![user_id, room_id, before_timestamp, limit], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Vec<u8>>(3)?,
                row.get::<_, Vec<u8>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, i64>(9)?,
            ))
        })
        .map_err(|e| format!("query decrypted messages failed: {e}"))?;

    let mut result = Vec::new();
    for row in rows {
        let (
            message_id,
            room_id_col,
            sender_id,
            ciphertext,
            nonce,
            content_type,
            message_timestamp,
            reply_to_id,
            is_edited,
            is_deleted,
        ) = row.map_err(|e| format!("read decrypted message row failed: {e}"))?;
        let plaintext = decrypt_bytes(key, &nonce, &ciphertext)?;
        result.push(DecryptedMessageRow {
            message_id,
            room_id: room_id_col,
            sender_id,
            plaintext,
            content_type,
            message_timestamp,
            reply_to_id,
            is_edited: is_edited != 0,
            is_deleted: is_deleted != 0,
        });
    }
    Ok(result)
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "tests/message_tests.rs"]
mod tests;
