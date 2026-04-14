//! # Sender Key Store
//!
//! Manages the `sender_keys` table — one row per `(user_id, member_id)`.
//!
//! ## Key Semantics
//!
//! Phase 1 sender-key reconciliation treats the local sender-key store as
//! member-scoped canonical state:
//! - each `(user_id, member_id)` keeps the latest current sender key
//! - sender-device routing remains transport metadata outside this table
//! - all stored sender keys are AES-256-GCM encrypted with `db_master_key_{user_id}`
//!
//! `user_id` selects the local master-key namespace. `member_id` is the
//! `chat_members.id`, which is globally unique across rooms.

use crate::store::db::{decrypt_bytes, encrypt_bytes};
use rusqlite::{params, Connection};

#[cfg(test)]
const TEST_MASTER_KEY: [u8; 32] = [0u8; 32];

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SenderKeyState {
    pub member_id: String,
    pub sender_key_version: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SenderKeyMaterial {
    pub member_id: String,
    pub key_bytes: [u8; 32],
    pub sender_key_version: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug)]
struct SenderKeyRow {
    member_id: String,
    key_blob: Vec<u8>,
    nonce: Vec<u8>,
    sender_key_version: i64,
    updated_at: i64,
}

fn load_sender_key_row_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
) -> Result<SenderKeyRow, String> {
    conn.query_row(
        "SELECT member_id, key_blob, nonce, sender_key_version, updated_at
         FROM sender_keys
         WHERE user_id = ?1 AND member_id = ?2",
        params![user_id, member_id],
        |row| {
            Ok(SenderKeyRow {
                member_id: row.get(0)?,
                key_blob: row.get(1)?,
                nonce: row.get(2)?,
                sender_key_version: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
    .map_err(|e| format!("load sender key ({member_id}) failed: {e}"))
}

fn material_from_row(
    encryption_key: &[u8; 32],
    row: SenderKeyRow,
) -> Result<SenderKeyMaterial, String> {
    let key_bytes = decrypt_bytes(encryption_key, &row.nonce, &row.key_blob)?
        .try_into()
        .map_err(|_| String::from("decrypted sender key is not 32 bytes"))?;

    Ok(SenderKeyMaterial {
        member_id: row.member_id,
        key_bytes,
        sender_key_version: row.sender_key_version,
        updated_at: row.updated_at,
    })
}

pub(crate) fn store_sender_key_with_version_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
    sender_key: &[u8; 32],
    sender_key_version: i64,
) -> Result<(), String> {
    let (ciphertext, nonce) = encrypt_bytes(key, sender_key)?;
    conn.execute(
        r#"INSERT INTO sender_keys
               (user_id, member_id, key_blob, nonce, sender_key_version, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
           ON CONFLICT(user_id, member_id) DO UPDATE SET
               key_blob = excluded.key_blob,
               nonce = excluded.nonce,
               sender_key_version = excluded.sender_key_version,
               updated_at = excluded.updated_at"#,
        params![user_id, member_id, ciphertext, nonce.to_vec(), sender_key_version],
    )
    .map_err(|e| format!("store sender key failed: {e}"))?;
    Ok(())
}

#[cfg(test)]
pub(crate) fn store_own_sender_key_with_version_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
    _device_id: &str,
    private_key: &[u8; 32],
    sender_key_version: i64,
) -> Result<(), String> {
    store_sender_key_with_version_inner(conn, key, user_id, member_id, private_key, sender_key_version)
}

#[cfg(test)]
pub(crate) fn store_peer_sender_key_with_version_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
    _device_id: &str,
    public_key: &[u8; 32],
    sender_key_version: i64,
) -> Result<(), String> {
    store_sender_key_with_version_inner(
        conn,
        &TEST_MASTER_KEY,
        user_id,
        member_id,
        public_key,
        sender_key_version,
    )
}

#[cfg(test)]
pub(crate) fn load_sender_key_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
) -> Result<[u8; 32], String> {
    load_sender_key_with_version_inner(conn, key, user_id, member_id).map(|(bytes, _)| bytes)
}

pub(crate) fn load_sender_key_with_version_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
) -> Result<([u8; 32], i64), String> {
    let row = load_sender_key_row_inner(conn, user_id, member_id)?;
    let material = material_from_row(key, row)?;
    Ok((material.key_bytes, material.sender_key_version))
}

#[cfg(test)]
pub(crate) fn load_own_sender_key_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
    _device_id: &str,
) -> Result<[u8; 32], String> {
    load_sender_key_inner(conn, key, user_id, member_id)
}

#[cfg(test)]
pub(crate) fn load_own_sender_key_with_version_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
    _device_id: &str,
) -> Result<([u8; 32], i64), String> {
    load_sender_key_with_version_inner(conn, key, user_id, member_id)
}

#[cfg(test)]
pub(crate) fn load_peer_sender_key_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
    _device_id: &str,
) -> Result<[u8; 32], String> {
    load_sender_key_inner(conn, &TEST_MASTER_KEY, user_id, member_id)
}

#[cfg(test)]
pub(crate) fn load_peer_sender_key_with_version_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
    _device_id: &str,
) -> Result<([u8; 32], i64), String> {
    load_sender_key_with_version_inner(conn, &TEST_MASTER_KEY, user_id, member_id)
}

pub(crate) fn load_sender_key_material_with_version_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
) -> Result<SenderKeyMaterial, String> {
    let row = load_sender_key_row_inner(conn, user_id, member_id)?;
    material_from_row(key, row)
}

pub(crate) fn list_sender_key_materials_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_ids: &[String],
) -> Result<Vec<SenderKeyMaterial>, String> {
    let states = list_sender_key_states_inner(conn, user_id, member_ids)?;
    let mut out = Vec::with_capacity(states.len());
    for state in states {
        out.push(load_sender_key_material_with_version_inner(conn, key, user_id, &state.member_id)?);
    }
    Ok(out)
}

pub(crate) fn has_sender_key_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
    _device_id: &str,
) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sender_keys WHERE user_id = ?1 AND member_id = ?2",
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
    _device_id: &str,
) -> Result<Option<SenderKeyState>, String> {
    let row = conn.query_row(
        "SELECT member_id, sender_key_version, updated_at
         FROM sender_keys
         WHERE user_id = ?1 AND member_id = ?2",
        params![user_id, member_id],
        |row| {
            Ok(SenderKeyState {
                member_id: row.get(0)?,
                sender_key_version: row.get(1)?,
                updated_at: row.get(2)?,
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
    if member_ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = vec!["?"; member_ids.len()].join(",");
    let sql = format!(
        "SELECT member_id, sender_key_version, updated_at
         FROM sender_keys
         WHERE user_id = ?1 AND member_id IN ({placeholders})
         ORDER BY member_id ASC"
    );

    let mut params_vec: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(member_ids.len() + 1);
    params_vec.push(&user_id);
    for member_id in member_ids {
        params_vec.push(member_id);
    }

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("prepare list sender key states failed: {e}"))?;
    let rows = stmt
        .query_map(params_vec.as_slice(), |row| {
            Ok(SenderKeyState {
                member_id: row.get(0)?,
                sender_key_version: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })
        .map_err(|e| format!("query list sender key states failed: {e}"))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("collect sender key state failed: {e}"))?);
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

#[cfg(test)]
#[path = "tests/sender_key_tests.rs"]
mod tests;
