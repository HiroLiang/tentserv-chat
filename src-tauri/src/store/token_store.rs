//! # Token Store
//!
//! Manages the `user_tokens` table — one encrypted row per logged-in account.
//!
//! Tokens are AES-256-GCM encrypted with the owner account's `db_master_key_{account_id}`
//! before being written to SQLite, so a compromised database file does not expose tokens.
//!
//! The "which account is currently active" pointer (`current_account_id`) lives in the OS keyring
//! and is managed by `commands/auth.rs`, not here.

use crate::store::db::{decrypt_bytes, encrypt_bytes};
use rusqlite::{params, Connection};

// ── Inner functions (pub(super) for test access) ──────────────────

/// Store or replace an encrypted auth token for `account_id`.
pub(crate) fn store_token_inner(
    conn: &Connection,
    key: &[u8; 32],
    account_id: &str,
    token: &str,
) -> Result<(), String> {
    let (ciphertext, nonce) = encrypt_bytes(key, token.as_bytes())?;
    conn.execute(
        r#"INSERT INTO user_tokens (account_id, encrypted_token, nonce, updated_at)
           VALUES (?1, ?2, ?3, unixepoch())
           ON CONFLICT(account_id) DO UPDATE SET
               encrypted_token = excluded.encrypted_token,
               nonce           = excluded.nonce,
               updated_at      = excluded.updated_at"#,
        params![account_id, ciphertext, nonce.to_vec()],
    )
    .map_err(|e| format!("store token failed: {e}"))?;
    Ok(())
}

/// Load and decrypt the auth token for `account_id`. Returns `None` if no token exists.
pub(crate) fn load_token_inner(
    conn: &Connection,
    key: &[u8; 32],
    account_id: &str,
) -> Result<Option<String>, String> {
    let result: rusqlite::Result<(Vec<u8>, Vec<u8>)> = conn.query_row(
        "SELECT encrypted_token, nonce FROM user_tokens WHERE account_id = ?1",
        params![account_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    );
    match result {
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("load token failed: {e}")),
        Ok((ciphertext, nonce)) => {
            let plaintext = decrypt_bytes(key, &nonce, &ciphertext)?;
            Ok(Some(
                String::from_utf8(plaintext).map_err(|e| e.to_string())?,
            ))
        }
    }
}

/// Remove the token row for `account_id` (no-op if it doesn't exist).
pub(crate) fn delete_token_inner(conn: &Connection, account_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM user_tokens WHERE account_id = ?1",
        params![account_id],
    )
    .map_err(|e| format!("delete token failed: {e}"))?;
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "tests/token_tests.rs"]
mod tests;
