mod commands;

use tauri_plugin_store::Builder as StoreBuilder;
use tauri_plugin_log::{Builder, Target, TargetKind, TimezoneStrategy};
use log::LevelFilter;
use commands::device::{
    get_device_info,
    update_device_registration,
    clear_device_id,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(StoreBuilder::new().build())
        .plugin(Builder::new()
            .targets([
                Target::new(TargetKind::Stdout),
                Target::new(TargetKind::LogDir { file_name: Some("app.log".into()) }),
                Target::new(TargetKind::Webview),
            ])
            .level(LevelFilter::Info)
            .level_for("tao", LevelFilter::Warn)
            .level_for("wry", LevelFilter::Warn)
            .level_for("tauri", LevelFilter::Warn)
            .level_for("hyper", LevelFilter::Warn)
            .timezone_strategy(TimezoneStrategy::UseLocal)
            .build()
        )
        .invoke_handler(tauri::generate_handler![
            get_device_info,
            update_device_registration,
            clear_device_id,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
