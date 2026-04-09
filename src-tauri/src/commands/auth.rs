//! # Auth Commands
//!
//! Manages authentication tokens and the "current account" pointer.
//!
//! ## Token storage
//! Auth tokens are stored in SQLite (`user_tokens` table) via `store::token_store`,
//! encrypted with the per-account AES master key from the local key file.
//!
//! ## Current account pointer
//! The file `{app_data_dir}/keys/current_account` records which account is currently
//! active.  `get_auth_token` reads this pointer, then loads that account's token.
//! On logout the pointer is cleared so the next launch starts unauthenticated.
//!
//! `get_auth_token_by_account` is a direct lookup — useful when the caller already
//! knows the `account_id` (e.g., after an account-switch or background refresh).

use crate::commands::core::{
    clear_auth_token_core, get_auth_token_by_account_core, save_auth_token_core,
};
use crate::store::db::{get_or_create_master_key, open_db};
use crate::store::key_provider::LocalKeyStore;

// ── Commands ──────────────────────────────────────────────────────

/// Load the token for the currently active account.
/// Returns `None` if no account is logged in or the token has been cleared.
#[tauri::command]
pub async fn get_auth_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let account_id = match LocalKeyStore::new(&app)?.get_current_account()? {
        Some(id) => id,
        None => return Ok(None),
    };
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
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
    let key = get_or_create_master_key(&app, &account_id)?;
    get_auth_token_by_account_core(&conn, &key, &account_id)
}

/// Save `token` for `account_id` and record it as the current account.
#[tauri::command]
pub async fn save_auth_token(
    app: tauri::AppHandle,
    account_id: String,
    token: String,
) -> Result<(), String> {
    LocalKeyStore::new(&app)?.set_current_account(&account_id)?;
    let conn = open_db(&app)?;
    let key = get_or_create_master_key(&app, &account_id)?;
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
    let store = LocalKeyStore::new(&app)?;
    let account_id = match account_id {
        Some(id) => id,
        None => match store.get_current_account()? {
            Some(id) => id,
            None => return Ok(()),
        },
    };
    let conn = open_db(&app)?;
    clear_auth_token_core(&conn, account_id.as_str())?;
    if let Ok(Some(stored)) = store.get_current_account() {
        if stored == account_id {
            let _ = store.delete_current_account();
        }
    }
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "tests/auth_tests.rs"]
mod tests;
