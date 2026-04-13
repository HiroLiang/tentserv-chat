//! Unit tests for `store/db.rs` and `store/key_provider.rs`.
//!
//! All master-key tests use `LocalKeyStore::from_dir` with a `tempdir()` so
//! they are fully deterministic and pass in every environment (no OS keyring,
//! no code-signing requirements).

use crate::store::db::{decrypt_bytes, encrypt_bytes, init_schema, migrate_schema};
use crate::store::key_provider::LocalKeyStore;
use rusqlite::Connection;
use tempfile::tempdir;

// ── Master key — file-based ───────────────────────────────────────

/// First call on a fresh directory creates and returns a valid 32-byte key.
#[test]
fn first_call_creates_valid_32_byte_key() {
    let dir = tempdir().expect("tempdir must succeed");
    let store = LocalKeyStore::from_dir(dir.path().to_path_buf()).expect("store init must succeed");
    println!("Given: empty keys directory");

    let key = store
        .get_or_create_master_key("1")
        .expect("first-time key creation must succeed");
    println!("Output: Ok([u8;32])");
    assert_eq!(key.len(), 32, "master key must be 32 bytes");
}

/// Two different account_ids produce different keys — each generates an
/// independent random value.
#[test]
fn different_accounts_get_different_keys() {
    let dir = tempdir().expect("tempdir must succeed");
    let store = LocalKeyStore::from_dir(dir.path().to_path_buf()).expect("store init must succeed");
    println!("Given: two distinct accounts '1' and '2'");

    let key_a = store
        .get_or_create_master_key("1")
        .expect("account A key must succeed");
    let key_b = store
        .get_or_create_master_key("2")
        .expect("account B key must succeed");

    println!("Output: key_a != key_b = {}", key_a != key_b);
    assert_ne!(key_a, key_b, "independently generated keys must differ");
}

/// A second call returns the same key as the first (file persists).
#[test]
fn key_persists_across_calls() {
    let dir = tempdir().expect("tempdir must succeed");
    let store = LocalKeyStore::from_dir(dir.path().to_path_buf()).expect("store init must succeed");
    println!("Given: empty keys directory for account '1'");

    let key1 = store
        .get_or_create_master_key("1")
        .expect("first call must succeed");
    println!("Action: first call completed — key generated and written to file");

    let key2 = store
        .get_or_create_master_key("1")
        .expect("second call must succeed");
    println!("Output: key1 == key2 = {}", key1 == key2);
    assert_eq!(key1, key2, "file-based key must persist between calls");
}

// ── validate_master_key ───────────────────────────────────────────

/// `validate_master_key` returns Err when no key file exists.
#[test]
fn validate_errors_for_unknown_account() {
    let dir = tempdir().expect("tempdir must succeed");
    let store = LocalKeyStore::from_dir(dir.path().to_path_buf()).expect("store init must succeed");
    println!("Given: account '999' has no key file");

    let result = store.validate_master_key("999");
    println!(
        "Output: {}",
        if result.is_err() {
            "Err (expected)"
        } else {
            "Ok (unexpected)"
        }
    );
    assert!(
        result.is_err(),
        "validate must fail when no key file exists"
    );
}

/// `validate_master_key` returns Ok after `get_or_create_master_key` writes the key.
#[test]
fn validate_ok_after_create() {
    let dir = tempdir().expect("tempdir must succeed");
    let store = LocalKeyStore::from_dir(dir.path().to_path_buf()).expect("store init must succeed");
    println!("Given: no key file for account '1'");

    store
        .get_or_create_master_key("1")
        .expect("key creation must succeed");
    println!("Action: key created and written to file");

    store
        .validate_master_key("1")
        .expect("validate must succeed after key is created");
    println!("Output: Ok (key file is valid)");
}

// ── AES-256-GCM helpers ───────────────────────────────────────────

/// `encrypt_bytes` + `decrypt_bytes` must round-trip any plaintext.
#[test]
fn aes_gcm_encrypt_decrypt_roundtrip() {
    let key = [0x42u8; 32];
    let plaintext = b"hello keychain test";
    println!(
        "Given: 32-byte key, plaintext '{}'",
        std::str::from_utf8(plaintext).unwrap()
    );

    let (ciphertext, nonce) = encrypt_bytes(&key, plaintext).expect("encrypt must succeed");
    let decrypted = decrypt_bytes(&key, &nonce, &ciphertext).expect("decrypt must succeed");

    println!("Output: roundtrip matches = {}", decrypted == plaintext);
    assert_eq!(
        decrypted, plaintext,
        "round-trip must restore original plaintext"
    );
}

/// `decrypt_bytes` with the wrong key must fail — AEAD authentication rejects it.
#[test]
fn aes_gcm_wrong_key_returns_err() {
    let key_a = [0xAAu8; 32];
    let key_b = [0xBBu8; 32];
    let plaintext = b"secret data";
    println!("Given: plaintext encrypted with key_a, decrypted with key_b (wrong key)");

    let (ciphertext, nonce) = encrypt_bytes(&key_a, plaintext).expect("encrypt must succeed");
    let result = decrypt_bytes(&key_b, &nonce, &ciphertext);

    println!(
        "Output: {}",
        if result.is_err() {
            "Err (expected AEAD failure)"
        } else {
            "Ok (unexpected)"
        }
    );
    assert!(
        result.is_err(),
        "wrong key must cause AEAD authentication failure"
    );
}

/// `decrypt_bytes` with an invalid nonce length must fail before touching AES.
#[test]
fn aes_gcm_bad_nonce_length_returns_err() {
    let key = [0x11u8; 32];
    let (ciphertext, _) = encrypt_bytes(&key, b"data").expect("encrypt must succeed");

    println!("Action: decrypt with 8-byte nonce (invalid; must be 12)");
    let result = decrypt_bytes(&key, &[0u8; 8], &ciphertext);
    assert!(result.is_err(), "invalid nonce length must return Err");
}

// ── Schema migration ─────────────────────────────────────────────

/// Fresh install: init_schema creates sender_keys with sender_key_version already present.
/// migrate_schema must complete v0→v6 without hitting a nested transaction error.
#[test]
fn migration_v3_to_v5_fresh_install_no_nested_transaction() {
    let conn = Connection::open_in_memory().expect("in-memory db must open");
    println!("Given: fresh install — init_schema builds sender_keys with sender_key_version");

    init_schema(&conn).expect("init_schema must succeed");
    let result = migrate_schema(&conn);
    println!("Output: migrate_schema result = {:?}", result);
    assert!(result.is_ok(), "fresh install must not fail: {:?}", result);

    let ver: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .expect("user_version must be readable");
    assert_eq!(ver, 6, "user_version must reach 6 after all migrations");
}

/// Existing user upgrading from v3: sender_keys lacks sender_key_version.
/// migrate_schema must add the column, seed values from updated_at, and continue to v6.
#[test]
fn migration_v3_to_v5_upgrades_real_v3_db() {
    let conn = Connection::open_in_memory().expect("in-memory db must open");
    println!("Given: real v3 DB — sender_keys has no sender_key_version column");

    conn.execute_batch(
        r#"
        CREATE TABLE sender_keys (
            user_id    TEXT    NOT NULL,
            member_id  TEXT    NOT NULL,
            is_private INTEGER NOT NULL DEFAULT 0,
            key_blob   BLOB    NOT NULL,
            nonce      BLOB,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, member_id)
        );
        INSERT INTO sender_keys (user_id, member_id, is_private, key_blob, updated_at)
        VALUES ('u1', 'm1', 1, X'AABB', 1700000000);
        PRAGMA user_version = 3;
        "#,
    )
    .expect("v3 fixture setup must succeed");

    println!("Action: migrate_schema with user_version=3");
    let result = migrate_schema(&conn);
    println!("Output: {:?}", result);
    assert!(result.is_ok(), "v3→v5 upgrade must succeed: {:?}", result);

    let ver: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .expect("user_version must be readable");
    assert_eq!(ver, 6);

    let skv: i64 = conn
        .query_row(
            "SELECT sender_key_version FROM sender_keys WHERE user_id='u1'",
            [],
            |r| r.get(0),
        )
        .expect("sender_key_version must exist after migration");
    assert_eq!(
        skv, 1700000000,
        "sender_key_version must be seeded from updated_at"
    );
}

/// Calling migrate_schema twice must be idempotent — all version < N guards skip on second call.
#[test]
fn migration_is_idempotent_after_v5() {
    let conn = Connection::open_in_memory().expect("in-memory db must open");
    println!("Given: fresh install reaching v6 after first call");

    init_schema(&conn).expect("init_schema must succeed");
    migrate_schema(&conn).expect("first migrate_schema must succeed");

    println!("Action: second migrate_schema call (should be no-op)");
    let result = migrate_schema(&conn);
    println!("Output: {:?}", result);
    assert!(result.is_ok(), "second call must be no-op: {:?}", result);
}

#[test]
fn migration_v6_rebuilds_chat_message_tables_for_server_dedup_and_encrypted_cache() {
    let conn = Connection::open_in_memory().expect("in-memory db must open");
    conn.execute_batch(
        r#"
        CREATE TABLE chat_messages (
            account_id INTEGER NOT NULL,
            room_id INTEGER NOT NULL,
            client_message_id TEXT NOT NULL,
            server_message_id INTEGER,
            sender_id INTEGER NOT NULL,
            message_type TEXT NOT NULL,
            content TEXT NOT NULL,
            reply_to_id INTEGER,
            is_edited INTEGER NOT NULL DEFAULT 0,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            sort_key INTEGER NOT NULL,
            delivery_status TEXT NOT NULL,
            delivery_error TEXT,
            is_local_echo INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (account_id, client_message_id)
        );
        CREATE TABLE chat_messages_encrypted (
            account_id INTEGER NOT NULL,
            room_id INTEGER NOT NULL,
            server_message_id INTEGER NOT NULL,
            sender_id INTEGER NOT NULL,
            encrypted_content BLOB NOT NULL,
            message_type TEXT NOT NULL,
            created_at TEXT NOT NULL,
            received_at INTEGER NOT NULL DEFAULT (unixepoch()),
            PRIMARY KEY (account_id, server_message_id)
        );
        INSERT INTO chat_messages (
            account_id, room_id, client_message_id, server_message_id, sender_id, message_type,
            content, created_at, sort_key, delivery_status, is_local_echo
        ) VALUES
            (1, 3, 'server:11', 11, 5, 'text', 'duplicate-server-row', '2026-04-13T03:00:01Z', 1, 'sent', 0),
            (1, 3, 'local:3:1776020000000', 11, 5, 'text', 'preferred-local-row', '2026-04-13T03:00:00Z', 0, 'sent', 0);
        INSERT INTO chat_messages_encrypted (
            account_id, room_id, server_message_id, sender_id, encrypted_content, message_type, created_at
        ) VALUES
            (1, 3, 11, 5, X'AA', 'text', '2026-04-13T03:00:00Z');
        PRAGMA user_version = 5;
        "#,
    )
    .expect("v5 fixture setup must succeed");

    migrate_schema(&conn).expect("v5→v6 migration must succeed");

    let encrypted_columns: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('chat_messages_encrypted') WHERE name = 'client_message_id'",
            [],
            |row| row.get(0),
        )
        .expect("encrypted table columns should be readable");
    let migrated_client_message_id: String = conn
        .query_row(
            "SELECT client_message_id FROM chat_messages_encrypted WHERE account_id = 1 AND server_message_id = 11",
            [],
            |row| row.get(0),
        )
        .expect("encrypted row should carry a client_message_id after migration");
    let message_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chat_messages WHERE account_id = 1 AND room_id = 3 AND server_message_id = 11",
            [],
            |row| row.get(0),
        )
        .expect("chat message count should be readable");
    let preferred_row_client_id: String = conn
        .query_row(
            "SELECT client_message_id FROM chat_messages WHERE account_id = 1 AND room_id = 3 AND server_message_id = 11",
            [],
            |row| row.get(0),
        )
        .expect("preferred merged chat row should exist");

    assert_eq!(encrypted_columns, 1, "v6 should add client_message_id to encrypted cache");
    assert_eq!(migrated_client_message_id, "server:11");
    assert_eq!(message_count, 1, "v6 should collapse duplicate server rows");
    assert_eq!(preferred_row_client_id, "local:3:1776020000000");
}
