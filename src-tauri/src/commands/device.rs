//! # Device Commands
//!
//! Manages the device's identity (UUID, platform, name, registration state).
//! Device info is stored in the `device_info` SQLite table via `store::device_store`.
//!
//! If no device exists on the first call, a new UUID is generated and persisted.
//! Subsequent calls return the stored record — the UUID never changes.

use crate::commands::core::{
    clear_device_core, get_or_create_device_core, update_device_registration_core,
};
use crate::store::db::open_db;
use crate::store::device_store::DeviceInfo;
use sysinfo::System;

// ── Commands ──────────────────────────────────────────────────────

/// Return the device's persistent info, creating a new record on first launch.
///
/// The `device_name` is refreshed from the OS on every call (hostname can change),
/// but `device_id`, `platform`, and `created_at` are immutable once written.
#[tauri::command]
pub fn get_device_info(app: tauri::AppHandle) -> Result<DeviceInfo, String> {
    let device_full_name = System::host_name().unwrap_or_else(|| "Unknown".to_string());
    let device_name = device_full_name
        .strip_suffix(".local")
        .unwrap_or(&device_full_name)
        .to_string();
    let conn = open_db(&app)?;
    get_or_create_device_core(&conn, &device_name)
}

/// Mark the device as registered (or unregistered) with the backend.
#[tauri::command]
pub fn update_device_registration(app: tauri::AppHandle, registered: bool) -> Result<(), String> {
    let conn = open_db(&app)?;
    update_device_registration_core(&conn, registered)
}

/// Remove the device record. Used during factory-reset / full uninstallation flows.
#[tauri::command]
pub fn clear_device_id(app: tauri::AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    clear_device_core(&conn)
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "tests/device_tests.rs"]
mod tests;
