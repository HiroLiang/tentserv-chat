//! Unit tests for `token_store`.
//!
//! Uses a temp SQLite DB and a zero AES key — no OS keyring dependency.

use super::{delete_token_inner, load_token_inner, store_token_inner};
use crate::store::db::init_schema;
use rusqlite::Connection;
use tempfile::TempDir;

/// Zero key substitutes for the OS-keyring master key in tests.
const ZERO_KEY: [u8; 32] = [0u8; 32];

fn test_db() -> (TempDir, Connection) {
    let dir = TempDir::new().unwrap();
    let conn = Connection::open(dir.path().join("test.db")).unwrap();
    init_schema(&conn).unwrap();
    (dir, conn)
}

// ── Scenario 1: Store, load, delete ──────────────────────────────

#[test]
fn scenario_token_store_load_delete() {
    // Given  alice has no stored token
    // When   we store "jwt_abc123" for alice
    // Then   loading returns Some("jwt_abc123")
    // When   we delete the token
    // Then   loading returns None
    let (_dir, conn) = test_db();

    assert_eq!(load_token_inner(&conn, &ZERO_KEY, "alice").unwrap(), None);

    store_token_inner(&conn, &ZERO_KEY, "alice", "jwt_abc123").unwrap();

    assert_eq!(
        load_token_inner(&conn, &ZERO_KEY, "alice").unwrap(),
        Some("jwt_abc123".to_string())
    );

    delete_token_inner(&conn, "alice").unwrap();

    assert_eq!(load_token_inner(&conn, &ZERO_KEY, "alice").unwrap(), None);
}

// ── Scenario 2: Upsert replaces old token ────────────────────────

#[test]
fn scenario_token_upsert_replaces_old_value() {
    // Given  alice's token is "old_token"
    // When   we store "new_token" for the same account_id
    // Then   loading returns "new_token"
    let (_dir, conn) = test_db();

    store_token_inner(&conn, &ZERO_KEY, "alice", "old_token").unwrap();
    store_token_inner(&conn, &ZERO_KEY, "alice", "new_token").unwrap();

    assert_eq!(
        load_token_inner(&conn, &ZERO_KEY, "alice").unwrap(),
        Some("new_token".to_string())
    );
}

// ── Scenario 3: User isolation ───────────────────────────────────

#[test]
fn scenario_token_user_isolation() {
    // Given  alice's token is "token_alice" and bob's is "token_bob"
    // Then   each user retrieves only their own token
    // When   alice's token is deleted
    // Then   bob's token is unaffected
    let (_dir, conn) = test_db();

    store_token_inner(&conn, &ZERO_KEY, "alice", "token_alice").unwrap();
    store_token_inner(&conn, &ZERO_KEY, "bob", "token_bob").unwrap();

    assert_eq!(
        load_token_inner(&conn, &ZERO_KEY, "alice").unwrap(),
        Some("token_alice".to_string())
    );
    assert_eq!(
        load_token_inner(&conn, &ZERO_KEY, "bob").unwrap(),
        Some("token_bob".to_string())
    );

    delete_token_inner(&conn, "alice").unwrap();

    assert_eq!(load_token_inner(&conn, &ZERO_KEY, "alice").unwrap(), None);
    assert_eq!(
        load_token_inner(&conn, &ZERO_KEY, "bob").unwrap(),
        Some("token_bob".to_string()),
        "bob's token must be unaffected by alice's deletion"
    );
}

// ── Scenario 4: Token is encrypted at rest ───────────────────────

#[test]
fn scenario_token_encrypted_at_rest() {
    // Given  token "super_secret_jwt" is stored for alice
    // When   the raw `encrypted_token` column is read from SQLite
    // Then   the raw bytes are NOT equal to the plaintext token bytes
    let (_dir, conn) = test_db();

    store_token_inner(&conn, &ZERO_KEY, "alice", "super_secret_jwt").unwrap();

    let raw: Vec<u8> = conn
        .query_row(
            "SELECT encrypted_token FROM user_tokens WHERE account_id = 'alice'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    assert_ne!(
        raw, b"super_secret_jwt",
        "token must NOT be stored in plaintext"
    );
}
