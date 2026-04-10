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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SenderKeyState {
    pub member_id: String,
    pub is_own_key: bool,
    pub sender_key_version: i64,
    pub updated_at: i64,
}

// ── Own key (private, encrypted) ─────────────────────────────────

pub(crate) fn store_own_sender_key_with_version_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
    private_key: &[u8; 32],
    sender_key_version: i64,
) -> Result<(), String> {
    let (ciphertext, nonce) = encrypt_bytes(key, private_key)?;
    conn.execute(
        r#"INSERT INTO sender_keys
               (user_id, member_id, is_private, key_blob, nonce, sender_key_version, updated_at)
           VALUES (?1, ?2, 1, ?3, ?4, ?5, unixepoch())
           ON CONFLICT(user_id, member_id) DO UPDATE SET
               is_private = 1,
               key_blob   = excluded.key_blob,
               nonce      = excluded.nonce,
               sender_key_version = excluded.sender_key_version,
               updated_at = excluded.updated_at"#,
        params![
            user_id,
            member_id,
            ciphertext,
            nonce.to_vec(),
            sender_key_version
        ],
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
    load_own_sender_key_with_version_inner(conn, key, user_id, member_id).map(|(bytes, _)| bytes)
}

pub(crate) fn load_own_sender_key_with_version_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
) -> Result<([u8; 32], i64), String> {
    let (is_private, key_blob, nonce, sender_key_version): (i64, Vec<u8>, Option<Vec<u8>>, i64) =
        conn.query_row(
            "SELECT is_private, key_blob, nonce, sender_key_version FROM sender_keys \
             WHERE user_id = ?1 AND member_id = ?2",
            params![user_id, member_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
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
    let bytes: [u8; 32] = decrypt_bytes(key, &nonce, &key_blob)?
        .try_into()
        .map_err(|_| String::from("decrypted sender key is not 32 bytes"))?;
    Ok((bytes, sender_key_version))
}

// ── Peer key (public, plaintext) ──────────────────────────────────

pub(crate) fn store_peer_sender_key_with_version_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
    public_key: &[u8; 32],
    sender_key_version: i64,
) -> Result<(), String> {
    conn.execute(
        r#"INSERT INTO sender_keys
               (user_id, member_id, is_private, key_blob, nonce, sender_key_version, updated_at)
           VALUES (?1, ?2, 0, ?3, NULL, ?4, unixepoch())
           ON CONFLICT(user_id, member_id) DO UPDATE SET
               is_private = 0,
               key_blob   = excluded.key_blob,
               nonce      = NULL,
               sender_key_version = excluded.sender_key_version,
               updated_at = excluded.updated_at"#,
        params![user_id, member_id, public_key.as_ref(), sender_key_version],
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
    load_peer_sender_key_with_version_inner(conn, user_id, member_id).map(|(bytes, _)| bytes)
}

pub(crate) fn load_peer_sender_key_with_version_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
) -> Result<([u8; 32], i64), String> {
    let (is_private, key_blob, sender_key_version): (i64, Vec<u8>, i64) = conn
        .query_row(
            "SELECT is_private, key_blob, sender_key_version FROM sender_keys \
             WHERE user_id = ?1 AND member_id = ?2",
            params![user_id, member_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| format!("load peer sender key ({member_id}) failed: {e}"))?;

    if is_private != 0 {
        return Err(format!(
            "sender key for member '{member_id}' is an own key (is_private=1), not a peer key"
        ));
    }
    let bytes: [u8; 32] = key_blob
        .try_into()
        .map_err(|_| String::from("peer sender key is not 32 bytes"))?;
    Ok((bytes, sender_key_version))
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

pub(crate) fn get_sender_key_state_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
) -> Result<Option<SenderKeyState>, String> {
    let row = conn.query_row(
        "SELECT member_id, is_private, sender_key_version, updated_at
         FROM sender_keys
         WHERE user_id = ?1 AND member_id = ?2",
        params![user_id, member_id],
        |row| {
            Ok(SenderKeyState {
                member_id: row.get(0)?,
                is_own_key: row.get::<_, i64>(1)? == 1,
                sender_key_version: row.get(2)?,
                updated_at: row.get(3)?,
            })
        },
    );

    match row {
        Ok(state) => Ok(Some(state)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("get sender key state failed: {e}")),
    }
}

pub(crate) fn list_sender_key_states_inner(
    conn: &Connection,
    user_id: &str,
    member_ids: &[String],
) -> Result<Vec<SenderKeyState>, String> {
    let mut out = Vec::with_capacity(member_ids.len());
    for member_id in member_ids {
        if let Some(state) = get_sender_key_state_inner(conn, user_id, member_id)? {
            out.push(state);
        }
    }
    Ok(out)
}

pub(crate) fn delete_sender_keys_inner(
    conn: &Connection,
    user_id: &str,
    member_ids: &[String],
) -> Result<usize, String> {
    let mut deleted = 0;
    for member_id in member_ids {
        deleted += conn
            .execute(
                "DELETE FROM sender_keys WHERE user_id = ?1 AND member_id = ?2",
                params![user_id, member_id],
            )
            .map_err(|e| format!("delete sender key ({member_id}) failed: {e}"))?;
    }
    Ok(deleted)
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "tests/sender_key_tests.rs"]
mod tests;
