//! # Sender Key Store
//!
//! Manages the `sender_keys` table — one row per `(user_id, member_id, device_id)`.
//!
//! ## Key Semantics
//!
//! - **Own key** (`key_scope = 'own'`): the caller's current-device sender key,
//!   stored AES-256-GCM encrypted with `db_master_key_{user_id}`.
//! - **Peer key** (`key_scope = 'peer'`): another device's sender key copied via
//!   distribution or self-sync, stored as plaintext 32 bytes.
//!
//! `user_id` selects the local master key namespace. `member_id` is the
//! `chat_members.id`, and `device_id` is the actual sender device.

use crate::store::db::{decrypt_bytes, encrypt_bytes};
use rusqlite::{params, Connection};

pub(crate) const SENDER_KEY_SCOPE_OWN: &str = "own";
pub(crate) const SENDER_KEY_SCOPE_PEER: &str = "peer";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SenderKeyState {
    pub member_id: String,
    pub device_id: String,
    pub key_scope: String,
    pub is_own_key: bool,
    pub sender_key_version: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SenderKeyMaterial {
    pub member_id: String,
    pub device_id: String,
    pub key_scope: String,
    pub key_bytes: [u8; 32],
    pub sender_key_version: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug)]
struct SenderKeyRow {
    member_id: String,
    device_id: String,
    key_scope: String,
    key_blob: Vec<u8>,
    nonce: Option<Vec<u8>>,
    sender_key_version: i64,
    updated_at: i64,
}

fn load_sender_key_row_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
    device_id: &str,
) -> Result<SenderKeyRow, String> {
    conn.query_row(
        "SELECT member_id, device_id, key_scope, key_blob, nonce, sender_key_version, updated_at
         FROM sender_keys
         WHERE user_id = ?1 AND member_id = ?2 AND device_id = ?3",
        params![user_id, member_id, device_id],
        |row| {
            Ok(SenderKeyRow {
                member_id: row.get(0)?,
                device_id: row.get(1)?,
                key_scope: row.get(2)?,
                key_blob: row.get(3)?,
                nonce: row.get(4)?,
                sender_key_version: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| format!("load sender key ({member_id}:{device_id}) failed: {e}"))
}

fn material_from_row(
    encryption_key: &[u8; 32],
    row: SenderKeyRow,
) -> Result<SenderKeyMaterial, String> {
    let key_bytes = match row.key_scope.as_str() {
        SENDER_KEY_SCOPE_OWN => {
            let nonce = row.nonce.clone().ok_or_else(|| {
                format!(
                    "own sender key for member '{}' device '{}' has NULL nonce",
                    row.member_id, row.device_id
                )
            })?;
            decrypt_bytes(encryption_key, &nonce, &row.key_blob)?
                .try_into()
                .map_err(|_| String::from("decrypted sender key is not 32 bytes"))?
        }
        SENDER_KEY_SCOPE_PEER => row
            .key_blob
            .clone()
            .try_into()
            .map_err(|_| String::from("peer sender key is not 32 bytes"))?,
        other => {
            return Err(format!(
                "unknown sender key scope '{other}' for member '{}' device '{}'",
                row.member_id, row.device_id
            ))
        }
    };

    Ok(SenderKeyMaterial {
        member_id: row.member_id,
        device_id: row.device_id,
        key_scope: row.key_scope,
        key_bytes,
        sender_key_version: row.sender_key_version,
        updated_at: row.updated_at,
    })
}

pub(crate) fn store_own_sender_key_with_version_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
    device_id: &str,
    private_key: &[u8; 32],
    sender_key_version: i64,
) -> Result<(), String> {
    let (ciphertext, nonce) = encrypt_bytes(key, private_key)?;
    conn.execute(
        r#"INSERT INTO sender_keys
               (user_id, member_id, device_id, key_scope, key_blob, nonce, sender_key_version, updated_at)
           VALUES (?1, ?2, ?3, 'own', ?4, ?5, ?6, unixepoch())
           ON CONFLICT(user_id, member_id, device_id) DO UPDATE SET
               key_scope = 'own',
               key_blob = excluded.key_blob,
               nonce = excluded.nonce,
               sender_key_version = excluded.sender_key_version,
               updated_at = excluded.updated_at"#,
        params![
            user_id,
            member_id,
            device_id,
            ciphertext,
            nonce.to_vec(),
            sender_key_version,
        ],
    )
    .map_err(|e| format!("store own sender key failed: {e}"))?;
    Ok(())
}

#[cfg(test)]
pub(crate) fn load_own_sender_key_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
    device_id: &str,
) -> Result<[u8; 32], String> {
    load_own_sender_key_with_version_inner(conn, key, user_id, member_id, device_id)
        .map(|(bytes, _)| bytes)
}

pub(crate) fn load_own_sender_key_with_version_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
    device_id: &str,
) -> Result<([u8; 32], i64), String> {
    let row = load_sender_key_row_inner(conn, user_id, member_id, device_id)?;
    if row.key_scope != SENDER_KEY_SCOPE_OWN {
        return Err(format!(
            "sender key for member '{member_id}' device '{device_id}' is a peer key, not an own key"
        ));
    }
    let material = material_from_row(key, row)?;
    Ok((material.key_bytes, material.sender_key_version))
}

pub(crate) fn store_peer_sender_key_with_version_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
    device_id: &str,
    public_key: &[u8; 32],
    sender_key_version: i64,
) -> Result<(), String> {
    conn.execute(
        r#"INSERT INTO sender_keys
               (user_id, member_id, device_id, key_scope, key_blob, nonce, sender_key_version, updated_at)
           VALUES (?1, ?2, ?3, 'peer', ?4, NULL, ?5, unixepoch())
           ON CONFLICT(user_id, member_id, device_id) DO UPDATE SET
               key_scope = 'peer',
               key_blob = excluded.key_blob,
               nonce = NULL,
               sender_key_version = excluded.sender_key_version,
               updated_at = excluded.updated_at"#,
        params![user_id, member_id, device_id, public_key.as_ref(), sender_key_version],
    )
    .map_err(|e| format!("store peer sender key failed: {e}"))?;
    Ok(())
}

#[cfg(test)]
pub(crate) fn load_peer_sender_key_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
    device_id: &str,
) -> Result<[u8; 32], String> {
    load_peer_sender_key_with_version_inner(conn, user_id, member_id, device_id)
        .map(|(bytes, _)| bytes)
}

#[cfg(test)]
pub(crate) fn load_peer_sender_key_with_version_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
    device_id: &str,
) -> Result<([u8; 32], i64), String> {
    let row = load_sender_key_row_inner(conn, user_id, member_id, device_id)?;
    if row.key_scope != SENDER_KEY_SCOPE_PEER {
        return Err(format!(
            "sender key for member '{member_id}' device '{device_id}' is an own key, not a peer key"
        ));
    }
    let key_bytes: [u8; 32] = row
        .key_blob
        .try_into()
        .map_err(|_| String::from("peer sender key is not 32 bytes"))?;
    Ok((key_bytes, row.sender_key_version))
}

pub(crate) fn load_sender_key_material_with_version_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    member_id: &str,
    device_id: &str,
) -> Result<SenderKeyMaterial, String> {
    let row = load_sender_key_row_inner(conn, user_id, member_id, device_id)?;
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
        out.push(load_sender_key_material_with_version_inner(
            conn,
            key,
            user_id,
            &state.member_id,
            &state.device_id,
        )?);
    }
    Ok(out)
}

pub(crate) fn has_sender_key_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
    device_id: &str,
) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sender_keys WHERE user_id = ?1 AND member_id = ?2 AND device_id = ?3",
            params![user_id, member_id, device_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("has sender key failed: {e}"))?;
    Ok(count > 0)
}

pub(crate) fn get_sender_key_state_inner(
    conn: &Connection,
    user_id: &str,
    member_id: &str,
    device_id: &str,
) -> Result<Option<SenderKeyState>, String> {
    let row = conn.query_row(
        "SELECT member_id, device_id, key_scope, sender_key_version, updated_at
         FROM sender_keys
         WHERE user_id = ?1 AND member_id = ?2 AND device_id = ?3",
        params![user_id, member_id, device_id],
        |row| {
            Ok(SenderKeyState {
                member_id: row.get(0)?,
                device_id: row.get(1)?,
                key_scope: {
                    let key_scope: String = row.get(2)?;
                    key_scope
                },
                is_own_key: false,
                sender_key_version: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    );

    match row {
        Ok(mut state) => {
            state.is_own_key = state.key_scope == SENDER_KEY_SCOPE_OWN;
            Ok(Some(state))
        }
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
        "SELECT member_id, device_id, key_scope, sender_key_version, updated_at
         FROM sender_keys
         WHERE user_id = ?1 AND member_id IN ({placeholders})
         ORDER BY member_id ASC, device_id ASC"
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
            let key_scope: String = row.get(2)?;
            Ok(SenderKeyState {
                member_id: row.get(0)?,
                device_id: row.get(1)?,
                is_own_key: key_scope == SENDER_KEY_SCOPE_OWN,
                key_scope,
                sender_key_version: row.get(3)?,
                updated_at: row.get(4)?,
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
