mod commands;
mod crypto;
mod store;

use commands::auth::{
    clear_auth_token, get_auth_token, get_auth_token_by_account, save_auth_token,
};
use commands::device::{clear_device_id, get_device_info, update_device_registration};
use commands::e2ee::{
    bootstrap_local_e2ee_keys, clear_e2ee_keys, consume_sender_key_distribution,
    decrypt_with_sender_key, encrypt_with_sender_key, generate_identity_keys, generate_sender_key,
    generate_signed_pre_key, get_identity_keys, get_sender_key_states, get_signed_pre_key,
    has_identity_keys, has_sender_key, perform_x3dh_receive, perform_x3dh_send,
    prepare_sender_key_distribution, replenish_otp_keys, store_member_sender_key,
    validate_e2ee_key_material, validate_identity_keys, validate_signed_pre_key,
};
use commands::messages::{
    get_decrypted_messages, get_encrypted_messages, store_decrypted_message,
    store_encrypted_message,
};
use log::LevelFilter;
use tauri_plugin_log::{Builder, Target, TargetKind, TimezoneStrategy};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("app.log".into()),
                    }),
                    Target::new(TargetKind::Webview),
                ])
                .level(LevelFilter::Info)
                .level_for("tao", LevelFilter::Warn)
                .level_for("wry", LevelFilter::Warn)
                .level_for("tauri", LevelFilter::Warn)
                .level_for("hyper", LevelFilter::Warn)
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            // Device lifecycle
            get_device_info,
            update_device_registration,
            clear_device_id,
            // Auth tokens
            get_auth_token,
            get_auth_token_by_account,
            save_auth_token,
            clear_auth_token,
            // E2EE identity & pre-keys
            bootstrap_local_e2ee_keys,
            has_identity_keys,
            generate_identity_keys,
            get_identity_keys,
            validate_e2ee_key_material,
            validate_identity_keys,
            validate_signed_pre_key,
            generate_signed_pre_key,
            get_signed_pre_key,
            replenish_otp_keys,
            clear_e2ee_keys,
            perform_x3dh_send,
            perform_x3dh_receive,
            // Sender keys
            generate_sender_key,
            has_sender_key,
            get_sender_key_states,
            store_member_sender_key,
            prepare_sender_key_distribution,
            consume_sender_key_distribution,
            encrypt_with_sender_key,
            decrypt_with_sender_key,
            // Messages
            store_encrypted_message,
            get_encrypted_messages,
            store_decrypted_message,
            get_decrypted_messages,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
