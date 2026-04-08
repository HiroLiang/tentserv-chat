//! # Device Store
//!
//! Manages the single-row `device_info` table in SQLite.
//! Stores the device's UUID, platform, name, and server-registration state.
//!
//! Previously stored in `tauri-plugin-store` (store.json); moved to SQLite
//! for consistency with all other persistent state.
//!
//! Device info is NOT encrypted — it is not sensitive and must be readable
//! before any user has authenticated.

#[cfg(test)]
use crate::store::db::init_schema;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

// ── Data type ─────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DeviceInfo {
    pub device_id: String,
    pub platform: String,
    pub device_name: String,
    /// `true` once the device has been registered with the backend.
    pub registered: bool,
    /// Unix timestamp (milliseconds) when the device was first seen.
    pub created_at: i64,
}

// ── Inner functions (pub(super) for test access) ──────────────────

pub(crate) fn store_device_info_inner(conn: &Connection, info: &DeviceInfo) -> Result<(), String> {
    conn.execute(
        r#"INSERT INTO device_info (id, device_id, platform, device_name, registered, created_at)
           VALUES (1, ?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(id) DO UPDATE SET
               device_id   = excluded.device_id,
               platform    = excluded.platform,
               device_name = excluded.device_name,
               registered  = excluded.registered,
               created_at  = excluded.created_at"#,
        params![
            info.device_id,
            info.platform,
            info.device_name,
            info.registered as i64,
            info.created_at,
        ],
    )
    .map_err(|e| format!("store device info failed: {e}"))?;
    Ok(())
}

pub(crate) fn load_device_info_inner(conn: &Connection) -> Result<Option<DeviceInfo>, String> {
    let result = conn.query_row(
        "SELECT device_id, platform, device_name, registered, created_at FROM device_info WHERE id = 1",
        [],
        |row| {
            Ok(DeviceInfo {
                device_id:   row.get(0)?,
                platform:    row.get(1)?,
                device_name: row.get(2)?,
                registered:  row.get::<_, i64>(3)? != 0,
                created_at:  row.get(4)?,
            })
        },
    );
    match result {
        Ok(info) => Ok(Some(info)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("load device info failed: {e}")),
    }
}

pub(crate) fn update_device_registered_inner(
    conn: &Connection,
    registered: bool,
) -> Result<(), String> {
    let rows = conn
        .execute(
            "UPDATE device_info SET registered = ?1 WHERE id = 1",
            params![registered as i64],
        )
        .map_err(|e| format!("update device registration failed: {e}"))?;
    if rows == 0 {
        Err("device info not found".to_string())
    } else {
        Ok(())
    }
}

pub(crate) fn clear_device_info_inner(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM device_info WHERE id = 1", [])
        .map_err(|e| format!("clear device info failed: {e}"))?;
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "tests/device_tests.rs"]
mod tests;

// Helper exposed only during tests — creates a schema-initialised in-memory connection
// that test files in this module can use directly.
#[cfg(test)]
pub(super) fn test_conn_with_schema() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::TempDir::new().unwrap();
    let conn = Connection::open(dir.path().join("test.db")).unwrap();
    init_schema(&conn).unwrap();
    (dir, conn)
}
