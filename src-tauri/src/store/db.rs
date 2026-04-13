//! # Database Foundation
//!
//! Core infrastructure shared by all store modules:
//! - SQLite connection management (`open_db`, `init_schema`)
//! - Per-user AES-256-GCM master key via local file storage (`get_or_create_master_key`)
//! - Encryption/decryption helpers (`encrypt_bytes`, `decrypt_bytes`)
//! - Key file validation (`validate_master_key`)
//!
//! All sensitive fields in every table are encrypted with the owner account's master key
//! before hitting the database.  The master key itself is stored as a hex-encoded file at
//! `{app_data_dir}/keys/mk_{account_id}` via [`crate::store::key_provider::LocalKeyStore`].
//!
//! ## Schema versioning
//!
//! `PRAGMA user_version` tracks the schema revision:
//! - 0 (default): initial schema with `sender_keys(user_id, room_id, member_id, ...)`
//! - 1: `sender_keys` keyed by `(user_id, member_id)` with `is_private` / `key_blob`
//! - 2: `one_time_pre_keys` drops dead `used` column; `decrypted_messages` gains
//!      `reply_to_id`, `is_edited`, `is_deleted`
//! - 3: `user_tokens` primary key column renamed from `user_id` to `account_id`
//! - 4: `sender_keys` gains `sender_key_version` for sender-key state reconciliation
//! - 5: add chat runtime read model tables for local-first rooms/messages sync

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngExt;
use rusqlite::{params, Connection};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

use crate::store::key_provider::LocalKeyStore;

pub(crate) const DB_FILE_NAME: &str = "tentserv.db";

// ── Master key ────────────────────────────────────────────────────
//
// Each account has exactly ONE key file: `{app_data_dir}/keys/mk_{account_id}`.
// That key encrypts every sensitive column belonging to that account.
// Trade-off: O(N accounts) files instead of O(N private keys).
//
// All I/O is delegated to `LocalKeyStore` so the backend can be replaced
// (e.g., back to OS keyring) by changing only that module.

pub(crate) fn get_or_create_master_key(
    app: &tauri::AppHandle,
    account_id: &str,
) -> Result<[u8; 32], String> {
    LocalKeyStore::new(app)?.get_or_create_master_key(account_id)
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
            sender_key_version INTEGER NOT NULL DEFAULT 0,
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

        -- ── Chat runtime read model ──────────────────────────────
        CREATE TABLE IF NOT EXISTS chat_rooms (
            account_id                INTEGER NOT NULL,
            room_id                   INTEGER NOT NULL,
            room_type                 TEXT    NOT NULL,
            display_name              TEXT    NOT NULL,
            avatar_url                TEXT,
            peer_user_id              INTEGER,
            presence_status           TEXT,
            last_seen_at              TEXT,
            status                    TEXT    NOT NULL DEFAULT 'active',
            latest_message            TEXT,
            latest_message_created_at TEXT,
            latest_message_sender_id  INTEGER,
            unread_count              INTEGER NOT NULL DEFAULT 0,
            blocked_by_peer           INTEGER NOT NULL DEFAULT 0,
            blocked_by_me             INTEGER NOT NULL DEFAULT 0,
            direct_key_status         TEXT,
            member_count              INTEGER,
            detail_name               TEXT,
            detail_description        TEXT,
            detail_avatar_url         TEXT,
            sort_order                INTEGER NOT NULL DEFAULT 0,
            updated_at                INTEGER NOT NULL,
            PRIMARY KEY (account_id, room_id)
        );
        CREATE INDEX IF NOT EXISTS idx_chat_rooms_account_type_sort
            ON chat_rooms(account_id, room_type, sort_order DESC, room_id);

        CREATE TABLE IF NOT EXISTS chat_room_members (
            account_id     INTEGER NOT NULL,
            room_id        INTEGER NOT NULL,
            member_id      INTEGER NOT NULL,
            participant_id INTEGER NOT NULL,
            user_id        INTEGER,
            display_name   TEXT    NOT NULL,
            avatar_url     TEXT,
            role           TEXT    NOT NULL,
            last_read_at   TEXT,
            joined_at      TEXT    NOT NULL,
            PRIMARY KEY (account_id, room_id, member_id)
        );
        CREATE INDEX IF NOT EXISTS idx_chat_room_members_account_room
            ON chat_room_members(account_id, room_id, joined_at, member_id);

        CREATE TABLE IF NOT EXISTS chat_invitations (
            account_id      INTEGER NOT NULL,
            room_id         INTEGER NOT NULL,
            found           INTEGER NOT NULL DEFAULT 0,
            invitation_id   INTEGER,
            role            TEXT,
            inviter_name    TEXT,
            inviter_avatar  TEXT,
            inviter_user_id INTEGER,
            updated_at      INTEGER NOT NULL,
            PRIMARY KEY (account_id, room_id)
        );

        CREATE TABLE IF NOT EXISTS chat_messages_encrypted (
            account_id         INTEGER NOT NULL,
            room_id            INTEGER NOT NULL,
            client_message_id  TEXT    NOT NULL,
            server_message_id  INTEGER,
            sender_id          INTEGER NOT NULL,
            encrypted_content  BLOB    NOT NULL,
            message_type       TEXT    NOT NULL,
            created_at         TEXT    NOT NULL,
            received_at        INTEGER NOT NULL,
            PRIMARY KEY (account_id, client_message_id),
            UNIQUE (account_id, server_message_id)
        );
        CREATE INDEX IF NOT EXISTS idx_chat_messages_encrypted_room
            ON chat_messages_encrypted(account_id, room_id, created_at DESC, client_message_id);

        CREATE TABLE IF NOT EXISTS chat_messages (
            account_id        INTEGER NOT NULL,
            room_id           INTEGER NOT NULL,
            client_message_id TEXT    NOT NULL,
            server_message_id INTEGER,
            sender_id         INTEGER NOT NULL,
            message_type      TEXT    NOT NULL,
            content           TEXT    NOT NULL,
            reply_to_id       INTEGER,
            is_edited         INTEGER NOT NULL DEFAULT 0,
            is_deleted        INTEGER NOT NULL DEFAULT 0,
            created_at        TEXT    NOT NULL,
            sort_key          INTEGER NOT NULL,
            delivery_status   TEXT    NOT NULL DEFAULT 'sent',
            delivery_error    TEXT,
            is_local_echo     INTEGER NOT NULL DEFAULT 0,
            updated_at        INTEGER NOT NULL,
            PRIMARY KEY (account_id, client_message_id),
            UNIQUE (account_id, server_message_id)
        );
        CREATE INDEX IF NOT EXISTS idx_chat_messages_account_room_sort
            ON chat_messages(account_id, room_id, sort_key DESC, client_message_id);

        CREATE TABLE IF NOT EXISTS chat_sync_state (
            account_id                  INTEGER PRIMARY KEY,
            active_participant_id       INTEGER,
            active_room_id              INTEGER,
            ws_status                   TEXT    NOT NULL DEFAULT 'idle',
            last_rooms_sync_at          TEXT,
            last_active_room_sync_at    TEXT,
            self_sender_key_sync_status TEXT    NOT NULL DEFAULT 'idle',
            self_sender_key_sync_error  TEXT,
            error                       TEXT,
            updated_at                  INTEGER NOT NULL
        );
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

    // version 2 → 3: rebuild user_tokens with account_id as primary key.
    // DROP + CREATE ensures the column name is correct regardless of prior schema.
    if version < 3 {
        conn.execute_batch(
            r#"
            BEGIN;

            DROP TABLE IF EXISTS user_tokens;
            CREATE TABLE user_tokens (
                account_id      TEXT PRIMARY KEY,
                encrypted_token BLOB NOT NULL,
                nonce           BLOB NOT NULL,
                updated_at      INTEGER NOT NULL
            );

            PRAGMA user_version = 3;

            COMMIT;
            "#,
        )
        .map_err(|e| format!("migrate_schema (2→3) failed: {e}"))?;
    }

    // version 3 → 4: add sender_key_version to sender_keys and seed it from updated_at.
    // Guard: check if the column already exists before attempting ALTER TABLE.
    // (Fresh installs via init_schema already include this column, so ALTER would fail and
    // leave a dangling transaction that causes the fallback BEGIN to error.)
    if version < 4 {
        let column_already_exists: bool = conn
            .prepare("PRAGMA table_info(sender_keys)")
            .ok()
            .and_then(|mut stmt| {
                stmt.query_map([], |row| row.get::<_, String>(1))
                    .ok()
                    .map(|rows| {
                        rows.filter_map(|r| r.ok())
                            .any(|name| name == "sender_key_version")
                    })
            })
            .unwrap_or(false);

        if column_already_exists {
            // Column already present (fresh install via init_schema, or a prior partial run).
            // Skip ALTER TABLE; only seed existing rows and bump version.
            conn.execute_batch(
                r#"
                BEGIN;
                UPDATE sender_keys
                SET sender_key_version = CASE
                    WHEN sender_key_version > 0 THEN sender_key_version
                    ELSE updated_at
                END;
                PRAGMA user_version = 4;
                COMMIT;
                "#,
            )
            .map_err(|e| format!("migrate_schema (3→4) failed: {e}"))?;
        } else {
            // Upgrading from a real v3 DB that does not yet have sender_key_version.
            conn.execute_batch(
                r#"
                BEGIN;
                ALTER TABLE sender_keys
                    ADD COLUMN sender_key_version INTEGER NOT NULL DEFAULT 0;
                UPDATE sender_keys
                SET sender_key_version = CASE
                    WHEN sender_key_version > 0 THEN sender_key_version
                    ELSE updated_at
                END;
                PRAGMA user_version = 4;
                COMMIT;
                "#,
            )
            .map_err(|e| format!("migrate_schema (3→4) failed: {e}"))?;
        }
    }

    if version < 5 {
        conn.execute_batch("PRAGMA user_version = 5;")
            .map_err(|e| format!("set user_version=5 failed: {e}"))?;
    }

    if version < 6 {
        let has_chat_messages = sqlite_table_exists(conn, "chat_messages")?;
        let has_chat_messages_encrypted = sqlite_table_exists(conn, "chat_messages_encrypted")?;
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("migrate_schema (5→6) begin tx failed: {e}"))?;

        tx.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS chat_messages_encrypted_new (
                account_id         INTEGER NOT NULL,
                room_id            INTEGER NOT NULL,
                client_message_id  TEXT    NOT NULL,
                server_message_id  INTEGER,
                sender_id          INTEGER NOT NULL,
                encrypted_content  BLOB    NOT NULL,
                message_type       TEXT    NOT NULL,
                created_at         TEXT    NOT NULL,
                received_at        INTEGER NOT NULL,
                PRIMARY KEY (account_id, client_message_id),
                UNIQUE (account_id, server_message_id)
            );
            CREATE TABLE IF NOT EXISTS chat_messages_new (
                account_id        INTEGER NOT NULL,
                room_id           INTEGER NOT NULL,
                client_message_id TEXT    NOT NULL,
                server_message_id INTEGER,
                sender_id         INTEGER NOT NULL,
                message_type      TEXT    NOT NULL,
                content           TEXT    NOT NULL,
                reply_to_id       INTEGER,
                is_edited         INTEGER NOT NULL DEFAULT 0,
                is_deleted        INTEGER NOT NULL DEFAULT 0,
                created_at        TEXT    NOT NULL,
                sort_key          INTEGER NOT NULL,
                delivery_status   TEXT    NOT NULL DEFAULT 'sent',
                delivery_error    TEXT,
                is_local_echo     INTEGER NOT NULL DEFAULT 0,
                updated_at        INTEGER NOT NULL,
                PRIMARY KEY (account_id, client_message_id),
                UNIQUE (account_id, server_message_id)
            );
            "#,
        )
        .map_err(|e| format!("migrate_schema (5→6) create staging tables failed: {e}"))?;

        if has_chat_messages_encrypted {
            tx.execute_batch(
                r#"
                INSERT OR REPLACE INTO chat_messages_encrypted_new
                    (account_id, room_id, client_message_id, server_message_id, sender_id, encrypted_content, message_type, created_at, received_at)
                SELECT account_id, room_id, 'server:' || server_message_id, server_message_id, sender_id, encrypted_content, message_type, created_at, received_at
                FROM chat_messages_encrypted;
                DROP TABLE chat_messages_encrypted;
                "#,
            )
            .map_err(|e| format!("migrate_schema (5→6) rebuild encrypted messages failed: {e}"))?;
        }

        if has_chat_messages {
            tx.execute_batch(
                r#"
                INSERT OR REPLACE INTO chat_messages_new
                    (account_id, room_id, client_message_id, server_message_id, sender_id, message_type, content, reply_to_id,
                     is_edited, is_deleted, created_at, sort_key, delivery_status, delivery_error, is_local_echo, updated_at)
                SELECT account_id, room_id, client_message_id, server_message_id, sender_id, message_type, content, reply_to_id,
                       is_edited, is_deleted, created_at, sort_key, delivery_status, delivery_error, is_local_echo, updated_at
                FROM chat_messages
                ORDER BY CASE WHEN client_message_id LIKE 'server:%' THEN 0 ELSE 1 END, updated_at ASC;
                DROP TABLE chat_messages;
                "#,
            )
            .map_err(|e| format!("migrate_schema (5→6) rebuild chat messages failed: {e}"))?;
        }

        tx.execute_batch(
            r#"
            ALTER TABLE chat_messages_encrypted_new RENAME TO chat_messages_encrypted;
            CREATE INDEX IF NOT EXISTS idx_chat_messages_encrypted_room
                ON chat_messages_encrypted(account_id, room_id, created_at DESC, client_message_id);
            ALTER TABLE chat_messages_new RENAME TO chat_messages;
            CREATE INDEX IF NOT EXISTS idx_chat_messages_account_room_sort
                ON chat_messages(account_id, room_id, sort_key DESC, client_message_id);
            PRAGMA user_version = 6;
            "#,
        )
        .map_err(|e| format!("migrate_schema (5→6) finalize rebuilt tables failed: {e}"))?;

        tx.commit()
            .map_err(|e| format!("migrate_schema (5→6) commit failed: {e}"))?;
    }

    Ok(())
}

fn sqlite_table_exists(conn: &Connection, table_name: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table_name],
            |row| row.get(0),
        )
        .map_err(|err| format!("query sqlite_master for table {table_name} failed: {err}"))?;
    Ok(count > 0)
}

// ── Key file validation ───────────────────────────────────────────

/// Read-only validation: confirms the key file for `account_id` exists and
/// contains a valid 32-byte hex-encoded master key.
/// Returns `Ok(())` on success; returns `Err` with a description on failure.
/// Unlike `get_or_create_master_key`, this function never creates a new entry.
#[allow(dead_code)]
pub(crate) fn validate_master_key(app: &tauri::AppHandle, account_id: &str) -> Result<(), String> {
    LocalKeyStore::new(app)?.validate_master_key(account_id)
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

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "tests/db_tests.rs"]
mod tests;
