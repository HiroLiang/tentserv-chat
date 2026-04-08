//! # Key Store
//!
//! Manages all Signal Protocol private keys for a user:
//! - Identity keys: `ik_dh` (X25519) and `ik_sign` (Ed25519)
//! - Signed pre-keys (SPKs): rotated X25519 keys, each signed by `ik_sign`
//! - One-time pre-keys (OTPKs): ephemeral X25519 keys consumed once per X3DH exchange
//! - OPK counter: monotonically increasing key_id allocator
//!
//! All private key bytes are AES-256-GCM encrypted with `db_master_key_{user_id}`.
//! Public key bytes and signatures are stored in plaintext (they are public by definition).

use crate::store::db::{decrypt_bytes, encrypt_bytes};
use rusqlite::{params, Connection};

// ── Identity keys ─────────────────────────────────────────────────

/// Store or replace an identity key component.
/// `key_type` is `"ik_dh"` (X25519) or `"ik_sign"` (Ed25519).
pub(crate) fn store_identity_key_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    key_type: &str,
    private_key: &[u8; 32],
    public_key: &[u8; 32],
) -> Result<(), String> {
    let (ciphertext, nonce) = encrypt_bytes(key, private_key)?;
    conn.execute(
        r#"INSERT INTO identity_keys
               (user_id, key_type, encrypted_private_key, nonce, public_key, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
           ON CONFLICT(user_id, key_type) DO UPDATE SET
               encrypted_private_key = excluded.encrypted_private_key,
               nonce      = excluded.nonce,
               public_key = excluded.public_key,
               updated_at = excluded.updated_at"#,
        params![
            user_id,
            key_type,
            ciphertext,
            nonce.to_vec(),
            public_key.to_vec()
        ],
    )
    .map_err(|e| format!("store identity key failed: {e}"))?;
    Ok(())
}

pub(crate) fn load_identity_key_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    key_type: &str,
) -> Result<[u8; 32], String> {
    let (ciphertext, nonce): (Vec<u8>, Vec<u8>) = conn.query_row(
        "SELECT encrypted_private_key, nonce FROM identity_keys WHERE user_id = ?1 AND key_type = ?2",
        params![user_id, key_type],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| format!("load identity key ({key_type}) failed: {e}"))?;
    decrypt_bytes(key, &nonce, &ciphertext)?
        .try_into()
        .map_err(|_| format!("decrypted identity key is not 32 bytes ({key_type})"))
}

pub(crate) fn has_identity_key_inner(
    conn: &Connection,
    user_id: &str,
    key_type: &str,
) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM identity_keys WHERE user_id = ?1 AND key_type = ?2",
            params![user_id, key_type],
            |row| row.get(0),
        )
        .map_err(|e| format!("has identity key failed: {e}"))?;
    Ok(count > 0)
}

/// Read the public keys for both identity key components without decrypting private keys.
/// Public keys are stored in plaintext; no master key is needed.
pub(crate) fn load_identity_public_keys_inner(
    conn: &Connection,
    user_id: &str,
) -> Result<([u8; 32], [u8; 32]), String> {
    let dh_pub: Vec<u8> = conn
        .query_row(
            "SELECT public_key FROM identity_keys WHERE user_id = ?1 AND key_type = 'ik_dh'",
            params![user_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("load ik_dh public key failed: {e}"))?;

    let sign_pub: Vec<u8> = conn
        .query_row(
            "SELECT public_key FROM identity_keys WHERE user_id = ?1 AND key_type = 'ik_sign'",
            params![user_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("load ik_sign public key failed: {e}"))?;

    let dh: [u8; 32] = dh_pub
        .try_into()
        .map_err(|_| "ik_dh public key is not 32 bytes".to_string())?;
    let sign: [u8; 32] = sign_pub
        .try_into()
        .map_err(|_| "ik_sign public key is not 32 bytes".to_string())?;

    Ok((dh, sign))
}

// ── Signed pre-keys ───────────────────────────────────────────────

pub(crate) fn store_signed_pre_key_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    key_id: u32,
    private_key: &[u8; 32],
    public_key: &[u8; 32],
    signature: &[u8; 64],
) -> Result<(), String> {
    let (ciphertext, nonce) = encrypt_bytes(key, private_key)?;
    conn.execute(
        r#"INSERT INTO signed_pre_keys
               (user_id, key_id, encrypted_private_key, nonce, public_key, signature, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, unixepoch())
           ON CONFLICT(user_id, key_id) DO UPDATE SET
               encrypted_private_key = excluded.encrypted_private_key,
               nonce      = excluded.nonce,
               public_key = excluded.public_key,
               signature  = excluded.signature,
               updated_at = excluded.updated_at"#,
        params![
            user_id,
            key_id,
            ciphertext,
            nonce.to_vec(),
            public_key.to_vec(),
            signature.to_vec()
        ],
    )
    .map_err(|e| format!("store signed pre-key failed: {e}"))?;
    Ok(())
}

pub(crate) fn load_signed_pre_key_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    key_id: u32,
) -> Result<[u8; 32], String> {
    let (ciphertext, nonce): (Vec<u8>, Vec<u8>) = conn.query_row(
        "SELECT encrypted_private_key, nonce FROM signed_pre_keys WHERE user_id = ?1 AND key_id = ?2",
        params![user_id, key_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| format!("load signed pre-key (id={key_id}) failed: {e}"))?;
    decrypt_bytes(key, &nonce, &ciphertext)?
        .try_into()
        .map_err(|_| "decrypted SPK is not 32 bytes".into())
}

/// Read the public key and signature for an existing signed pre-key without decrypting the private key.
/// Both fields are stored in plaintext; no master key is needed.
pub(crate) fn load_signed_pre_key_public_inner(
    conn: &Connection,
    user_id: &str,
    key_id: u32,
) -> Result<([u8; 32], [u8; 64]), String> {
    let (pub_bytes, sig_bytes): (Vec<u8>, Vec<u8>) = conn
        .query_row(
            "SELECT public_key, signature FROM signed_pre_keys WHERE user_id = ?1 AND key_id = ?2",
            params![user_id, key_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("load signed pre-key public (id={key_id}) failed: {e}"))?;

    let pub_key: [u8; 32] = pub_bytes
        .try_into()
        .map_err(|_| "SPK public key is not 32 bytes".to_string())?;
    let signature: [u8; 64] = sig_bytes
        .try_into()
        .map_err(|_| "SPK signature is not 64 bytes".to_string())?;

    Ok((pub_key, signature))
}

// ── One-time pre-keys ─────────────────────────────────────────────

pub(crate) fn store_otp_key_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    key_id: u32,
    private_key: &[u8; 32],
    public_key: &[u8; 32],
) -> Result<(), String> {
    let (ciphertext, nonce) = encrypt_bytes(key, private_key)?;
    conn.execute(
        r#"INSERT INTO one_time_pre_keys
               (user_id, key_id, encrypted_private_key, nonce, public_key, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
           ON CONFLICT(user_id, key_id) DO UPDATE SET
               encrypted_private_key = excluded.encrypted_private_key,
               nonce      = excluded.nonce,
               public_key = excluded.public_key,
               updated_at = excluded.updated_at"#,
        params![
            user_id,
            key_id,
            ciphertext,
            nonce.to_vec(),
            public_key.to_vec()
        ],
    )
    .map_err(|e| format!("store OTP key failed: {e}"))?;
    Ok(())
}

pub(crate) fn load_otp_key_inner(
    conn: &Connection,
    key: &[u8; 32],
    user_id: &str,
    key_id: u32,
) -> Result<[u8; 32], String> {
    let (ciphertext, nonce): (Vec<u8>, Vec<u8>) = conn.query_row(
        "SELECT encrypted_private_key, nonce FROM one_time_pre_keys WHERE user_id = ?1 AND key_id = ?2",
        params![user_id, key_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| format!("load OTP key (id={key_id}) failed: {e}"))?;
    decrypt_bytes(key, &nonce, &ciphertext)?
        .try_into()
        .map_err(|_| "decrypted OTP key is not 32 bytes".into())
}

pub(crate) fn delete_otp_key_inner(
    conn: &Connection,
    user_id: &str,
    key_id: u32,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM one_time_pre_keys WHERE user_id = ?1 AND key_id = ?2",
        params![user_id, key_id],
    )
    .map_err(|e| format!("delete OTP key failed: {e}"))?;
    Ok(())
}

// ── OPK counter ───────────────────────────────────────────────────

/// Atomically allocate `count` sequential OTP key IDs for `user_id`.
/// IDs start at 0 on first call and never repeat across calls.
/// Runs inside a `BEGIN IMMEDIATE` transaction to prevent read-modify-write races.
pub(crate) fn next_opk_ids_inner(
    conn: &Connection,
    user_id: &str,
    count: u32,
) -> Result<Vec<u32>, String> {
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| format!("begin transaction failed: {e}"))?;

    let result = (|| -> Result<Vec<u32>, String> {
        let start: u32 = match conn.query_row(
            "SELECT next_id FROM opk_counter WHERE user_id = ?1",
            params![user_id],
            |row| row.get(0),
        ) {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => 0,
            Err(e) => return Err(format!("read opk counter failed: {e}")),
        };

        let end = start
            .checked_add(count)
            .ok_or_else(|| "OTP key counter overflow".to_string())?;

        conn.execute(
            r#"INSERT INTO opk_counter (user_id, next_id) VALUES (?1, ?2)
               ON CONFLICT(user_id) DO UPDATE SET next_id = excluded.next_id"#,
            params![user_id, end],
        )
        .map_err(|e| format!("update opk counter failed: {e}"))?;

        Ok((start..end).collect())
    })();

    match &result {
        Ok(_) => conn
            .execute_batch("COMMIT")
            .map_err(|e| format!("commit transaction failed: {e}"))?,
        Err(_) => {
            let _ = conn.execute_batch("ROLLBACK");
        }
    }

    result
}

// ── Bulk clear ────────────────────────────────────────────────────

/// Delete all E2EE key material for `user_id` (identity, SPK, OTP, sender, counter).
/// Does NOT remove auth tokens — those are cleared separately on logout.
pub(crate) fn clear_all_keys_for_user_inner(
    conn: &Connection,
    user_id: &str,
) -> Result<(), String> {
    for table in &[
        "identity_keys",
        "signed_pre_keys",
        "one_time_pre_keys",
        "sender_keys",
        "opk_counter",
    ] {
        conn.execute(
            &format!("DELETE FROM {table} WHERE user_id = ?1"),
            params![user_id],
        )
        .map_err(|e| format!("clear {table} failed: {e}"))?;
    }
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "tests/key_tests.rs"]
mod tests;
