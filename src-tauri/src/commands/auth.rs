//! # Auth Commands
//!
//! Manages authentication tokens and the "current account" pointer.
//!
//! ## Token storage
//! Auth tokens are stored in SQLite (`user_tokens` table) via `store::token_store`,
//! encrypted with the per-account AES master key from the OS keyring.
//!
//! ## Current account pointer
//! The keyring entry `tentserv-chat / current_account_id` records which account is currently
//! active.  `get_auth_token` reads this pointer, then loads that account's token.
//! On logout the pointer is cleared so the next launch starts unauthenticated.
//!
//! `get_auth_token_by_account` is a direct lookup — useful when the caller already
//! knows the `account_id` (e.g., after an account-switch or background refresh).

use crate::commands::core::{
    clear_auth_token_core, get_auth_token_by_account_core, save_auth_token_core,
};
use crate::store::db::{get_or_create_master_key, open_db};
use keyring::Entry;

fn current_account_entry() -> Result<Entry, String> {
    Entry::new("tentserv-chat", "current_account_id").map_err(|e| e.to_string())
}

// ── Commands ──────────────────────────────────────────────────────

/// Load the token for the currently active account.
/// Returns `None` if no account is logged in or the token has been cleared.
#[tauri::command]
pub async fn get_auth_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let account_id = match current_account_entry()?.get_password() {
        Ok(s) => s,
        Err(_) => return Ok(None),
    };
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&account_id)?;
    get_auth_token_by_account_core(&conn, &key, &account_id)
}

/// Load the token for a specific `account_id`.
/// Useful for multi-account flows where the caller already knows the target account.
#[tauri::command]
pub async fn get_auth_token_by_account(
    app: tauri::AppHandle,
    account_id: String,
) -> Result<Option<String>, String> {
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&account_id)?;
    get_auth_token_by_account_core(&conn, &key, &account_id)
}

/// Save `token` for `account_id` and record it as the current account.
#[tauri::command]
pub async fn save_auth_token(
    app: tauri::AppHandle,
    account_id: String,
    token: String,
) -> Result<(), String> {
    current_account_entry()?
        .set_password(&account_id)
        .map_err(|e| e.to_string())?;
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&account_id)?;
    save_auth_token_core(&conn, &key, &account_id, &token)
}

/// Delete the stored token for `account_id`.
/// If no account is provided, deletes the token for the current account.
/// If this account was the current account, clears the current-account pointer too.
#[tauri::command]
pub async fn clear_auth_token(
    app: tauri::AppHandle,
    account_id: Option<String>,
) -> Result<(), String> {
    let account_id = match account_id {
        Some(account_id) => account_id,
        None => match current_account_entry()?.get_password() {
            Ok(account_id) => account_id,
            Err(_) => return Ok(()),
        },
    };
    let conn = open_db(&app)?;
    clear_auth_token_core(&conn, account_id.as_str())?;
    if let Ok(stored) = current_account_entry()?.get_password() {
        if stored == account_id {
            let _ = current_account_entry()?.delete_credential();
        }
    }
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "tests/auth_tests.rs"]
mod tests;
