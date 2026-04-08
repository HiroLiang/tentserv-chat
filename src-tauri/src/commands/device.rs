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
/// [EN] `device_name` is refreshed from the OS on every call because hostname can change.
///      `device_id`, `platform`, and `created_at` remain stable once written.
/// [中] 每次呼叫都會從 OS 重新取得 `device_name`，因為主機名稱可能改變。
///      `device_id`、`platform`、`created_at` 一旦寫入就保持穩定。
/// [日] hostname が変わる可能性があるため、呼び出しごとに OS から `device_name` を更新する。
///      `device_id`、`platform`、`created_at` は一度保存された後は固定する。
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
///
/// [EN] This flag mirrors backend registration success; it is not used as proof of authentication.
/// [中] 此旗標只反映後端註冊是否成功，不代表使用者已驗證。
/// [日] このフラグは backend 登録成功を反映するだけで、認証済みの証明ではない。
#[tauri::command]
pub fn update_device_registration(app: tauri::AppHandle, registered: bool) -> Result<(), String> {
    let conn = open_db(&app)?;
    update_device_registration_core(&conn, registered)
}

/// Remove the device record. Used during factory-reset / full uninstallation flows.
///
/// [EN] Clearing the row makes the next startup generate a brand-new local device UUID.
/// [中] 清除資料列後，下一次啟動會產生全新的本地裝置 UUID。
/// [日] 行を削除すると、次回起動時に新しいローカル端末 UUID が生成される。
#[tauri::command]
pub fn clear_device_id(app: tauri::AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    clear_device_core(&conn)
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "tests/device_tests.rs"]
mod tests;
