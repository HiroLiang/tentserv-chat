//! # Database Foundation
//!
//! Core infrastructure shared by all store modules:
//! - SQLite connection management (`open_db`, `init_schema`)
//! - Per-user AES-256-GCM master key via OS keyring (`get_or_create_master_key`)
//! - Encryption/decryption helpers (`encrypt_bytes`, `decrypt_bytes`)
//! - Keyring validation (`validate_master_key`)
//!
//! All sensitive fields in every table are encrypted with the owner account's master key
//! before hitting the database. The master key itself lives in the OS keyring under
//! the label `db_master_key_{account_id}`, one entry per account.
//!
//! ## Schema versioning
//!
//! `PRAGMA user_version` tracks the schema revision:
//! - 0 (default): initial schema with `sender_keys(user_id, room_id, member_id, ...)`
//! - 1: `sender_keys` keyed by `(user_id, member_id)` with `is_private` / `key_blob`
//! - 2: `one_time_pre_keys` drops dead `used` column; `decrypted_messages` gains
//!      `reply_to_id`, `is_edited`, `is_deleted`
//! - 3: `user_tokens` primary key column renamed from `user_id` to `account_id`

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use keyring::Entry;
use rand::RngExt;
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

pub(crate) const DB_FILE_NAME: &str = "tentserv.db";

// ── Master key ────────────────────────────────────────────────────
//
// Each account has exactly ONE keyring entry: `db_master_key_{account_id}`.
// That key encrypts every sensitive column belonging to that account.
// Trade-off: O(N accounts) keyring entries instead of O(N private keys).

pub(crate) fn get_or_create_master_key(account_id: &str) -> Result<[u8; 32], String> {
    let entry = Entry::new("tentserv-chat", &format!("db_master_key_{account_id}"))
        .map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(hex_str) => {
            let bytes = hex::decode(&hex_str).map_err(|e| e.to_string())?;
            bytes
                .try_into()
                .map_err(|_| "invalid master key length".into())
        }
        Err(_) => {
            // First access for this user — generate and store a new random key.
            let mut key = [0u8; 32];
            rand::rng().fill(&mut key);
            entry
                .set_password(&hex::encode(key))
                .map_err(|e| e.to_string())?;
            Ok(key)
        }
    }
}

// ── Database path & connection ────────────────────────────────────

pub(crate) fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir failed: {e}"))?;
    fs::create_dir_all(&base).map_err(|e| format!("create app data dir failed: {e}"))?;
    Ok(base.join(DB_FILE_NAME))
}

/// Create all tables in a fresh (or existing) SQLite connection.
/// Safe to call repeatedly — all statements are `CREATE TABLE IF NOT EXISTS`.
pub(crate) fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        -- ── Device ────────────────────────────────────────────────
        -- Single-row table enforced by CHECK (id = 1).
        -- Stores device UUID, platform, hostname, and registration state.
        CREATE TABLE IF NOT EXISTS device_info (
            id          INTEGER PRIMARY KEY CHECK (id = 1),
            device_id   TEXT    NOT NULL,
            platform    TEXT    NOT NULL,
            device_name TEXT    NOT NULL,
            registered  INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL
        );

        -- ── Auth tokens ────────────────────────────────────────────
        -- One row per logged-in account.
        -- Token bytes are AES-256-GCM encrypted with db_master_key_{account_id}.
        CREATE TABLE IF NOT EXISTS user_tokens (
            account_id      TEXT PRIMARY KEY,
            encrypted_token BLOB NOT NULL,
            nonce           BLOB NOT NULL,
            updated_at      INTEGER NOT NULL
        );

        -- ── E2EE identity keys ────────────────────────────────────
        -- key_type: 'ik_dh' (X25519) | 'ik_sign' (Ed25519)
        -- Private key encrypted; public key stored plaintext (it's public).
        CREATE TABLE IF NOT EXISTS identity_keys (
            user_id               TEXT NOT NULL,
            key_type              TEXT NOT NULL,
            encrypted_private_key BLOB NOT NULL,
            nonce                 BLOB NOT NULL,
            public_key            BLOB NOT NULL,
            updated_at            INTEGER NOT NULL,
            PRIMARY KEY (user_id, key_type)
        );

        -- ── Signed pre-keys ────────────────────────────────────────
        -- Signal Protocol SPKs. Rotated periodically.
        -- Private key encrypted; public key + signature stored plaintext.
        CREATE TABLE IF NOT EXISTS signed_pre_keys (
            user_id               TEXT    NOT NULL,
            key_id                INTEGER NOT NULL,
            encrypted_private_key BLOB    NOT NULL,
            nonce                 BLOB    NOT NULL,
            public_key            BLOB    NOT NULL,
            signature             BLOB    NOT NULL,
            updated_at            INTEGER NOT NULL,
            PRIMARY KEY (user_id, key_id)
        );

        -- ── One-time pre-keys ──────────────────────────────────────
        -- Consumed once per X3DH exchange; deleted (not flagged) after use.
        CREATE TABLE IF NOT EXISTS one_time_pre_keys (
            user_id               TEXT    NOT NULL,
            key_id                INTEGER NOT NULL,
            encrypted_private_key BLOB    NOT NULL,
            nonce                 BLOB    NOT NULL,
            public_key            BLOB    NOT NULL,
            updated_at            INTEGER NOT NULL,
            PRIMARY KEY (user_id, key_id)
        );

        -- ── OTP key counter ────────────────────────────────────────
        -- Tracks next available key_id per user so IDs never overlap.
        CREATE TABLE IF NOT EXISTS opk_counter (
            user_id TEXT PRIMARY KEY,
            next_id INTEGER NOT NULL DEFAULT 0
        );

        -- ── Sender keys ────────────────────────────────────────────
        -- Keyed by (user_id, member_id).  member_id is chat_members.id —
        -- a globally unique sequence PK, so room_id is not needed here.
        --
        -- is_private = 1: own key.  key_blob is AES-256-GCM encrypted with
        --                 db_master_key_{user_id}; nonce is NOT NULL.
        -- is_private = 0: peer's public key.  key_blob is plaintext (32 bytes);
        --                 nonce is NULL.
        --
        -- NOTE: this table is created by migrate_schema when upgrading from
        -- the old schema (user_version 0).  init_schema only creates it when
        -- the DB is brand-new (user_version is already 1 after migration).
        CREATE TABLE IF NOT EXISTS sender_keys (
            user_id    TEXT    NOT NULL,
            member_id  TEXT    NOT NULL,
            is_private INTEGER NOT NULL DEFAULT 0,
            key_blob   BLOB    NOT NULL,
            nonce      BLOB,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, member_id)
        );

        -- ── Cloud-pulled encrypted messages ───────────────────────
        -- Raw E2EE ciphertext pulled from the server, stored as-is.
        -- INSERT OR IGNORE makes re-pulls idempotent.
        CREATE TABLE IF NOT EXISTS encrypted_messages (
            message_id        TEXT PRIMARY KEY,
            room_id           TEXT NOT NULL,
            sender_id         TEXT NOT NULL,
            encrypted_content BLOB NOT NULL,
            message_type      TEXT NOT NULL,
            spk_key_id        INTEGER,
            otpk_key_id       INTEGER,
            server_timestamp  INTEGER NOT NULL,
            received_at       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_enc_msg_room_ts
            ON encrypted_messages(room_id, server_timestamp);

        -- ── Locally decrypted messages ────────────────────────────
        -- Plaintext decrypted from E2EE, then re-encrypted with
        -- the local db_master_key_{user_id} before storage.
        -- Keeps message history readable offline without re-running X3DH.
        CREATE TABLE IF NOT EXISTS decrypted_messages (
            message_id          TEXT    NOT NULL,
            user_id             TEXT    NOT NULL,
            room_id             TEXT    NOT NULL,
            sender_id           TEXT    NOT NULL,
            encrypted_plaintext BLOB    NOT NULL,
            nonce               BLOB    NOT NULL,
            content_type        TEXT    NOT NULL DEFAULT 'text',
            message_timestamp   INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            reply_to_id         TEXT    NULL,
            is_edited           INTEGER NOT NULL DEFAULT 0,
            is_deleted          INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (message_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_dec_msg_user_room_ts
            ON decrypted_messages(user_id, room_id, message_timestamp);
    "#,
    )
    .map_err(|e| format!("create schema failed: {e}"))
}

pub(crate) fn open_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(db_path(app)?).map_err(|e| format!("open sqlite failed: {e}"))?;
    init_schema(&conn)?;
    migrate_schema(&conn)?;
    Ok(conn)
}

// ── Schema migration ──────────────────────────────────────────────
//
// Version 0 → 1: replace sender_keys(user_id, room_id, member_id, encrypted_private_key, …)
//                with     sender_keys(user_id, member_id, is_private, key_blob, nonce, …).
// The entire migration runs in a single transaction so a mid-flight crash cannot
// leave the database in a partially-migrated state.

pub(crate) fn migrate_schema(conn: &Connection) -> Result<(), String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| format!("read user_version failed: {e}"))?;

    // version 0 → 1: migrate sender_keys table.
    // Guard: only run if the old schema column `encrypted_private_key` exists.
    // (Fresh installs create sender_keys with the v1 schema via init_schema, so this
    // column is absent and the migration should be skipped.)
    let needs_sender_key_migration = version < 1 && {
        let col_exists: bool = conn
            .prepare("PRAGMA table_info(sender_keys)")
            .ok()
            .and_then(|mut stmt| {
                stmt.query_map([], |row| row.get::<_, String>(1))
                    .ok()
                    .map(|rows| {
                        rows.filter_map(|r| r.ok())
                            .any(|name| name == "encrypted_private_key")
                    })
            })
            .unwrap_or(false);
        col_exists
    };
    if needs_sender_key_migration {
        conn.execute_batch(
            r#"
            BEGIN;

            CREATE TABLE IF NOT EXISTS sender_keys_new (
                user_id    TEXT    NOT NULL,
                member_id  TEXT    NOT NULL,
                is_private INTEGER NOT NULL DEFAULT 0,
                key_blob   BLOB    NOT NULL,
                nonce      BLOB,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, member_id)
            );

            -- Migrate existing rows: old data is always encrypted (is_private=1).
            -- We keep only the latest row per (user_id, member_id) using MAX(updated_at).
            INSERT OR IGNORE INTO sender_keys_new
                (user_id, member_id, is_private, key_blob, nonce, updated_at)
            SELECT user_id, member_id, 1, encrypted_private_key, nonce, MAX(updated_at)
            FROM   sender_keys
            GROUP  BY user_id, member_id;

            DROP TABLE sender_keys;
            ALTER TABLE sender_keys_new RENAME TO sender_keys;

            PRAGMA user_version = 1;

            COMMIT;
            "#,
        )
        .map_err(|e| format!("migrate_schema (0→1) failed: {e}"))?;
    } else if version < 1 {
        // Fresh install: sender_keys already has v1 schema; just bump the version.
        conn.execute_batch("PRAGMA user_version = 1;")
            .map_err(|e| format!("set user_version=1 failed: {e}"))?;
    }

    // version 1 → 2:
    //   • one_time_pre_keys: drop dead `used` column (rebuild table).
    //   • decrypted_messages: add reply_to_id, is_edited, is_deleted (rebuild table so the
    //     migration is idempotent regardless of whether init_schema already added them).
    if version < 2 {
        conn.execute_batch(
            r#"
            BEGIN;

            -- Rebuild one_time_pre_keys without the unused `used` column.
            CREATE TABLE IF NOT EXISTS one_time_pre_keys_new (
                user_id               TEXT    NOT NULL,
                key_id                INTEGER NOT NULL,
                encrypted_private_key BLOB    NOT NULL,
                nonce                 BLOB    NOT NULL,
                public_key            BLOB    NOT NULL,
                updated_at            INTEGER NOT NULL,
                PRIMARY KEY (user_id, key_id)
            );
            INSERT OR IGNORE INTO one_time_pre_keys_new
                (user_id, key_id, encrypted_private_key, nonce, public_key, updated_at)
            SELECT user_id, key_id, encrypted_private_key, nonce, public_key, updated_at
            FROM   one_time_pre_keys;
            DROP TABLE one_time_pre_keys;
            ALTER TABLE one_time_pre_keys_new RENAME TO one_time_pre_keys;

            -- Rebuild decrypted_messages with the three new columns.
            -- Use literal defaults for existing rows (NULL / 0 / 0).
            -- This is safe whether or not the columns already exist in the source table.
            CREATE TABLE IF NOT EXISTS decrypted_messages_new (
                message_id          TEXT    NOT NULL,
                user_id             TEXT    NOT NULL,
                room_id             TEXT    NOT NULL,
                sender_id           TEXT    NOT NULL,
                encrypted_plaintext BLOB    NOT NULL,
                nonce               BLOB    NOT NULL,
                content_type        TEXT    NOT NULL DEFAULT 'text',
                message_timestamp   INTEGER NOT NULL,
                updated_at          INTEGER NOT NULL,
                reply_to_id         TEXT    NULL,
                is_edited           INTEGER NOT NULL DEFAULT 0,
                is_deleted          INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (message_id, user_id)
            );
            INSERT OR IGNORE INTO decrypted_messages_new
                (message_id, user_id, room_id, sender_id, encrypted_plaintext, nonce,
                 content_type, message_timestamp, updated_at, reply_to_id, is_edited, is_deleted)
            SELECT message_id, user_id, room_id, sender_id, encrypted_plaintext, nonce,
                   content_type, message_timestamp, updated_at, NULL, 0, 0
            FROM   decrypted_messages;
            -- DROP old table (also drops its associated idx_dec_msg_user_room_ts index).
            DROP TABLE decrypted_messages;
            ALTER TABLE decrypted_messages_new RENAME TO decrypted_messages;
            CREATE INDEX IF NOT EXISTS idx_dec_msg_user_room_ts
                ON decrypted_messages(user_id, room_id, message_timestamp);

            PRAGMA user_version = 2;

            COMMIT;
            "#,
        )
        .map_err(|e| format!("migrate_schema (1→2) failed: {e}"))?;
    }

    // version 2 → 3: rename user_tokens.user_id → account_id.
    if version < 3 {
        conn.execute_batch(
            r#"
            BEGIN;

            CREATE TABLE IF NOT EXISTS user_tokens_new (
                account_id      TEXT PRIMARY KEY,
                encrypted_token BLOB NOT NULL,
                nonce           BLOB NOT NULL,
                updated_at      INTEGER NOT NULL
            );
            INSERT OR IGNORE INTO user_tokens_new
                (account_id, encrypted_token, nonce, updated_at)
            SELECT user_id, encrypted_token, nonce, updated_at
            FROM   user_tokens;
            DROP TABLE user_tokens;
            ALTER TABLE user_tokens_new RENAME TO user_tokens;

            PRAGMA user_version = 3;

            COMMIT;
            "#,
        )
        .map_err(|e| format!("migrate_schema (2→3) failed: {e}"))?;
    }

    Ok(())
}

// ── Keyring validation ────────────────────────────────────────────

/// Read-only validation: confirms that the keyring entry for `account_id` exists
/// and contains a valid 32-byte hex-encoded master key.
/// Returns `Ok(())` on success; returns `Err` with a description on failure.
/// Unlike `get_or_create_master_key`, this function never creates a new entry.
pub(crate) fn validate_master_key(account_id: &str) -> Result<(), String> {
    let entry = Entry::new("tentserv-chat", &format!("db_master_key_{account_id}"))
        .map_err(|e| e.to_string())?;
    let hex_str = entry
        .get_password()
        .map_err(|_| format!("keyring entry not found for account '{account_id}'"))?;
    let bytes = hex::decode(&hex_str)
        .map_err(|e| format!("master key for '{account_id}' is not valid hex: {e}"))?;
    if bytes.len() != 32 {
        return Err(format!(
            "master key for '{account_id}' has length {}, expected 32",
            bytes.len()
        ));
    }
    Ok(())
}

// ── AES-256-GCM helpers ───────────────────────────────────────────

/// Encrypt `plaintext` with AES-256-GCM using a random 12-byte nonce.
/// Returns `(ciphertext, nonce)`.
pub(crate) fn encrypt_bytes(
    key: &[u8; 32],
    plaintext: &[u8],
) -> Result<(Vec<u8>, [u8; 12]), String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("cipher init failed: {e}"))?;
    let mut nonce_bytes = [0u8; 12];
    rand::rng().fill(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|e| format!("encrypt failed: {e}"))?;
    Ok((ciphertext, nonce_bytes))
}

/// Decrypt `ciphertext` with AES-256-GCM. `nonce` must be exactly 12 bytes.
pub(crate) fn decrypt_bytes(
    key: &[u8; 32],
    nonce: &[u8],
    ciphertext: &[u8],
) -> Result<Vec<u8>, String> {
    if nonce.len() != 12 {
        return Err(format!("invalid nonce length: {}", nonce.len()));
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("cipher init failed: {e}"))?;
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|e| format!("decrypt failed: {e}"))
}
