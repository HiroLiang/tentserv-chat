use crate::commands::core::{
    clear_auth_token_core, get_auth_token_by_account_core, save_auth_token_core,
};
use crate::store::db::init_schema;
use rusqlite::Connection;
use tempfile::TempDir;

// ── Fixtures ────────────────────────────────────────────────────────

/// Input: swap ZERO_KEY for any 32-byte key to test different encryption keys.
const ZERO_KEY: [u8; 32] = [0u8; 32];

/// Input: replace with any user ID strings to test different users.
const ALICE: &str = "alice";
const BOB: &str = "bob";

/// Input: replace with any JWT or token strings to test different token values.
const TOKEN_A: &str = "jwt_alice_001";
const TOKEN_B: &str = "jwt_bob_002";

fn test_db() -> (TempDir, Connection) {
    let dir = TempDir::new().unwrap();
    let conn = Connection::open(dir.path().join("test.db")).unwrap();
    init_schema(&conn).unwrap();
    (dir, conn)
}

// ── Scenarios ───────────────────────────────────────────────────────

#[test]
fn save_and_load_returns_correct_token() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When a token is saved and loaded
    save_auth_token_core(&conn, &ZERO_KEY, ALICE, TOKEN_A).unwrap();
    let loaded = get_auth_token_by_account_core(&conn, &ZERO_KEY, ALICE).unwrap();

    // Then the loaded value equals the saved value
    assert_eq!(loaded, Some(TOKEN_A.to_string()));
}

#[test]
fn cleared_token_returns_none() {
    // Given a saved token
    let (_dir, conn) = test_db();
    save_auth_token_core(&conn, &ZERO_KEY, ALICE, TOKEN_A).unwrap();

    // When the token is cleared
    clear_auth_token_core(&conn, ALICE).unwrap();

    // Then loading returns None
    let loaded = get_auth_token_by_account_core(&conn, &ZERO_KEY, ALICE).unwrap();
    assert_eq!(loaded, None);
}

#[test]
fn upsert_replaces_old_token() {
    // Given an existing token
    let (_dir, conn) = test_db();
    save_auth_token_core(&conn, &ZERO_KEY, ALICE, "old_token").unwrap();

    // When a new token is saved for the same user
    save_auth_token_core(&conn, &ZERO_KEY, ALICE, TOKEN_A).unwrap();

    // Then the new token is returned, not the old one
    let loaded = get_auth_token_by_account_core(&conn, &ZERO_KEY, ALICE).unwrap();
    assert_eq!(loaded, Some(TOKEN_A.to_string()));
}

#[test]
fn user_isolation() {
    // Given tokens for two users
    let (_dir, conn) = test_db();
    save_auth_token_core(&conn, &ZERO_KEY, ALICE, TOKEN_A).unwrap();
    save_auth_token_core(&conn, &ZERO_KEY, BOB, TOKEN_B).unwrap();

    // When one user's token is cleared
    clear_auth_token_core(&conn, ALICE).unwrap();

    // Then the other user's token is unaffected
    let alice = get_auth_token_by_account_core(&conn, &ZERO_KEY, ALICE).unwrap();
    let bob = get_auth_token_by_account_core(&conn, &ZERO_KEY, BOB).unwrap();
    assert_eq!(alice, None);
    assert_eq!(bob, Some(TOKEN_B.to_string()));
}

#[test]
fn load_missing_user_returns_none() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When loading a token for a user that was never saved
    let result = get_auth_token_by_account_core(&conn, &ZERO_KEY, "nobody");

    // Then Ok(None) is returned, not an error
    assert_eq!(result.unwrap(), None);
}

#[test]
fn clear_nonexistent_token_is_ok() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When clearing a token that doesn't exist
    let result = clear_auth_token_core(&conn, "nobody");

    // Then it succeeds silently (DELETE on absent row is a no-op)
    assert!(result.is_ok());
}
