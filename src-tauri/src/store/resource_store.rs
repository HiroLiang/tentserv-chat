use std::fs;
use std::path::PathBuf;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use tauri::Manager;
use rand:: RngExt;

const DB_FILE_NAME: &str = "e2ee.db";

fn master_key() -> [u8; 32] {
    // 開發期先寫死，之後再換
    let secret = b"dev-only-master-key-change-me";
    let digest = Sha256::digest(secret);
    let mut key = [0u8; 32];
    key.copy_from_slice(&digest);
    key
}

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir failed: {e}"))?;

    fs::create_dir_all(&base).map_err(|e| format!("create app data dir failed: {e}"))?;
    Ok(base.join(DB_FILE_NAME))
}

fn open_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(path).map_err(|e| format!("open sqlite failed: {e}"))?;

    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS secure_keys (
            label TEXT PRIMARY KEY,
            nonce BLOB NOT NULL,
            ciphertext BLOB NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS key_meta (
            key TEXT PRIMARY KEY,
            value INTEGER
        );
        "#,
    )
        .map_err(|e| format!("create schema failed: {e}"))?;

    Ok(conn)
}

pub fn store_private_key(
    app: &tauri::AppHandle,
    label: &str,
    secret: &[u8; 32],
) -> Result<(), String> {
    let conn = open_db(app)?;

    let key = master_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("cipher init failed: {e}"))?;

    let mut nonce_bytes = [0u8; 12];
    rand::rng().fill(&mut nonce_bytes);

    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), secret.as_slice())
        .map_err(|e| format!("encrypt failed: {e}"))?;

    conn.execute(
        r#"
        INSERT INTO secure_keys (label, nonce, ciphertext, updated_at)
        VALUES (?1, ?2, ?3, unixepoch())
        ON CONFLICT(label) DO UPDATE SET
            nonce = excluded.nonce,
            ciphertext = excluded.ciphertext,
            updated_at = excluded.updated_at
        "#,
        params![label, nonce_bytes.to_vec(), ciphertext],
    )
        .map_err(|e| format!("upsert key failed: {e}"))?;

    Ok(())
}

pub fn load_private_key(app: &tauri::AppHandle, label: &str) -> Result<[u8; 32], String> {
    let conn = open_db(app)?;

    let (nonce, ciphertext): (Vec<u8>, Vec<u8>) = conn
        .query_row(
            "SELECT nonce, ciphertext FROM secure_keys WHERE label = ?1",
            params![label],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("load key failed for {label}: {e}"))?;

    if nonce.len() != 12 {
        return Err(format!("invalid nonce length for {label}: {}", nonce.len()));
    }

    let key = master_key();
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("cipher init failed: {e}"))?;

    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|e| format!("decrypt failed for {label}: {e}"))?;

    let arr: [u8; 32] = plaintext
        .try_into()
        .map_err(|_| format!("decrypted key is not 32 bytes for {label}"))?;

    Ok(arr)
}

pub fn delete_private_key(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute("DELETE FROM secure_keys WHERE label = ?1", params![label])
        .map_err(|e| format!("delete key failed: {e}"))?;
    Ok(())
}

pub fn has_private_key(app: &tauri::AppHandle, label: &str) -> Result<bool, String> {
    let conn = open_db(app)?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM secure_keys WHERE label = ?1",
            params![label],
            |row| row.get(0),
        )
        .map_err(|e| format!("count key failed: {e}"))?;
    Ok(count > 0)
}

pub fn clear_private_keys(app: &tauri::AppHandle) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute("DELETE FROM secure_keys", [])
        .map_err(|e| format!("clear keys failed: {e}"))?;
    Ok(())
}

pub fn next_opk_ids(app: &tauri::AppHandle, count: u32) -> Result<Vec<u32>, String> {
    use rusqlite::params;

    let conn = open_db(app)?;

    let last: u32 = conn
        .query_row(
            "SELECT value FROM key_meta WHERE key = 'last_opk_id'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let start = last + 1;
    let end = start + count;

    // 更新 last_opk_id
    conn.execute(
        "INSERT INTO key_meta (key, value) VALUES ('last_opk_id', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![end - 1],
    )
        .map_err(|e| e.to_string())?;

    Ok((start..end).collect())
}
