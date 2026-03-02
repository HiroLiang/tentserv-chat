use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri_plugin_store::StoreExt;
use uuid::Uuid;
use chrono::Utc;
use sysinfo::System;

#[allow(dead_code)]
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DeviceInfo {
    pub device_id: String,
    pub platform: String,
    pub device_name: String,
    pub registered: bool,
    pub created_at: i64,
}

#[allow(dead_code)]
#[tauri::command]
pub fn get_device_info(app: tauri::AppHandle) -> Result<DeviceInfo, String> {

    // Get store
    let store = app.store("store.json").map_err(|e| e.to_string())?;

    // Get device name
    let device_full_name = System::host_name().unwrap_or_else(|| "Unknown".to_string());
    let device_name = device_full_name.strip_suffix(".local")
        .unwrap_or(&device_full_name).to_string();

    // Check if device_info exists
    if let Some(device_info_value) = store.get("device_info") {
        if let Ok(mut device_info) = serde_json::from_value::<DeviceInfo>(device_info_value) {
            device_info.device_name = device_name;

            store.set("device_info", json!(device_info));
            store.save().map_err(|e| e.to_string())?;

            return Ok(device_info);
        }
    }

    // Create device_info
    let platform = std::env::consts::OS;
    let device_info = DeviceInfo {
        device_id: Uuid::new_v4().to_string(),
        platform: platform.to_string(),
        device_name,
        registered: false,
        created_at: Utc::now().timestamp_millis(),
    };

    // Save device_info
    store.set("device_info", json!(device_info));
    store.save().map_err(|e| e.to_string())?;

    Ok(device_info)
}

#[allow(dead_code)]
#[tauri::command]
pub fn update_device_registration(
    app: tauri::AppHandle,
    registered: bool,
) -> Result<(), String> {
    let store = app.store("store.json").map_err(|e| e.to_string())?;

    if let Some(device_info_value) = store.get("device_info") {
        if let Ok(mut device_info) = serde_json::from_value::<DeviceInfo>(device_info_value) {
            device_info.registered = registered;
            store.set("device_info", json!(device_info));
            store.save().map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    Err("Device info not found".to_string())
}

#[allow(dead_code)]
#[tauri::command]
pub fn clear_device_id(app: tauri::AppHandle) -> Result<(), String> {
    let store = app.store("store.json").map_err(|e| e.to_string())?;

    store.delete("device_info");
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}