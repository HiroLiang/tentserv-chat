//! # Sender Key Store
//!
//! Manages the `sender_keys` table — one row per (user_id, member_id) pair.
//!
//! ## Key Semantics
//!
//! - **Own key** (`is_private = 1`): the caller's own sender key, stored AES-256-GCM
//!   encrypted with `db_master_key_{user_id}`.  Only the owner uses this key to
//!   encrypt outgoing messages.
//!
//! - **Peer key** (`is_private = 0`): a sender key received from another participant
//!   (their public sender key), stored as plaintext 32 bytes.  Used to decrypt
//!   messages from that participant.
//!
//! `user_id` is kept in the primary key because it selects which master key to use
//! for encryption; a single device may have multiple logged-in users.

use crate::store::db::{decrypt_bytes, encrypt_bytes};
use rusqlite::{params, Connection};

// ── Own key (private, encrypted) ─────────────────────────────────

/// Store or replace the caller's own sender key for `member_id`.
/// `private_key` is AES-256-GCM encrypted with `key` before being written.
pub(crate) fn store_own_sender_key_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
    private_key: &[u8; 32],
) -> Result<(), String> {
    let (ciphertext, nonce) = encrypt_bytes(key, private_key)?;
    conn.execute(
        r#"INSERT INTO sender_keys
               (user_id, member_id, is_private, key_blob, nonce, updated_at)
           VALUES (?1, ?2, 1, ?3, ?4, unixepoch())
           ON CONFLICT(user_id, member_id) DO UPDATE SET
               is_private = 1,
               key_blob   = excluded.key_blob,
               nonce      = excluded.nonce,
               updated_at = excluded.updated_at"#,
        params![user_id, member_id, ciphertext, nonce.to_vec()],
    )
    .map_err(|e| format!("store own sender key failed: {e}"))?;
    Ok(())
}

/// Load and decrypt the caller's own sender key for `member_id`.
/// Returns an error if no row exists or if the stored row is a peer key
/// (`is_private = 0`), guarding against accidental API misuse.
pub(crate) fn load_own_sender_key_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
) -> Result<[u8; 32], String> {
    let (is_private, key_blob, nonce): (i64, Vec<u8>, Option<Vec<u8>>) = conn
        .query_row(
            "SELECT is_private, key_blob, nonce FROM sender_keys \
             WHERE user_id = ?1 AND member_id = ?2",
            params![user_id, member_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| format!("load own sender key ({member_id}) failed: {e}"))?;

    if is_private != 1 {
        return Err(format!(
            "sender key for member '{member_id}' is a peer key (is_private=0), not an own key"
        ));
    }
    let nonce = nonce.ok_or_else(|| {
        format!("own sender key for member '{member_id}' has NULL nonce (corrupt row)")
    })?;
    decrypt_bytes(key, &nonce, &key_blob)?
        .try_into()
        .map_err(|_| "decrypted sender key is not 32 bytes".into())
}

// ── Peer key (public, plaintext) ──────────────────────────────────

/// Store or replace a peer's sender key (public key) for `member_id`.
/// `public_key` is written as plaintext — no encryption is applied.
pub(crate) fn store_peer_sender_key_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
    public_key: &[u8; 32],
) -> Result<(), String> {
    conn.execute(
        r#"INSERT INTO sender_keys
               (user_id, member_id, is_private, key_blob, nonce, updated_at)
           VALUES (?1, ?2, 0, ?3, NULL, unixepoch())
           ON CONFLICT(user_id, member_id) DO UPDATE SET
               is_private = 0,
               key_blob   = excluded.key_blob,
               nonce      = NULL,
               updated_at = excluded.updated_at"#,
        params![user_id, member_id, public_key.as_ref()],
    )
    .map_err(|e| format!("store peer sender key failed: {e}"))?;
    Ok(())
}

/// Load a peer's sender key (public key) for `member_id`.
/// Returns an error if no row exists or if the stored row is an own key
/// (`is_private = 1`), guarding against accidental API misuse.
pub(crate) fn load_peer_sender_key_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
) -> Result<[u8; 32], String> {
    let (is_private, key_blob): (i64, Vec<u8>) = conn
        .query_row(
            "SELECT is_private, key_blob FROM sender_keys \
             WHERE user_id = ?1 AND member_id = ?2",
            params![user_id, member_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("load peer sender key ({member_id}) failed: {e}"))?;

    if is_private != 0 {
        return Err(format!(
            "sender key for member '{member_id}' is an own key (is_private=1), not a peer key"
        ));
    }
    key_blob
        .try_into()
        .map_err(|_| "peer sender key is not 32 bytes".into())
}

// ── Existence check ───────────────────────────────────────────────

/// Return `true` if any sender key (own or peer) exists for `(user_id, member_id)`.
pub(crate) fn has_sender_key_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sender_keys \
             WHERE user_id = ?1 AND member_id = ?2",
            params![user_id, member_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("has sender key failed: {e}"))?;
    Ok(count > 0)
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "tests/sender_key_tests.rs"]
mod tests;
