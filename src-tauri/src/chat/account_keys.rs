use std::collections::HashMap;

use rusqlite::Connection;

use crate::commands::core::{
    consume_sender_key_distribution_core, decrypt_with_sender_key_result_core,
    encrypt_with_sender_key_core, get_sender_key_states_core, prepare_sender_key_distribution_core,
    replenish_otp_keys_core, ConsumeSenderKeyDistributionResult, PreparedSenderKeyDistribution,
    SenderKeyDecryptResult,
};
use crate::commands::e2ee::{OneTimePreKey, SenderKeyEncryptedMessage, SenderKeyStatePayload};
use crate::crypto::x3dh::PublicKeyBundle;
use crate::store::db::{get_or_create_master_key, open_db};

pub fn account_namespace(owner_account_id: i64) -> String {
    owner_account_id.to_string()
}

pub fn replenish_otp_keys(
    app: &tauri::AppHandle,
    owner_account_id: i64,
    delta: u32,
) -> Result<Vec<OneTimePreKey>, String> {
    let conn = open_db(app)?;
    let account_namespace = account_namespace(owner_account_id);
    let key = get_or_create_master_key(app, &account_namespace)?;
    replenish_otp_keys_core(&conn, &key, &account_namespace, delta)
}

pub fn get_sender_key_states(
    app: &tauri::AppHandle,
    owner_account_id: i64,
    member_ids: &[i64],
) -> Result<HashMap<i64, SenderKeyStatePayload>, String> {
    let conn = open_db(app)?;
    let account_namespace = account_namespace(owner_account_id);
    let ids = member_ids
        .iter()
        .map(|member_id| member_id.to_string())
        .collect::<Vec<_>>();
    let states = get_sender_key_states_core(&conn, &account_namespace, &ids)?;
    Ok(states
        .into_iter()
        .filter_map(|state| {
            state.member_id.parse::<i64>().ok().map(|member_id| {
                (
                    member_id,
                    SenderKeyStatePayload {
                        member_id: state.member_id,
                        is_own_key: state.is_own_key,
                        sender_key_version: state.sender_key_version,
                        updated_at: state.updated_at,
                    },
                )
            })
        })
        .collect())
}

pub fn prepare_sender_key_distribution(
    app: &tauri::AppHandle,
    owner_account_id: i64,
    owner_member_id: i64,
    public_key_bundle: &PublicKeyBundle,
) -> Result<PreparedSenderKeyDistribution, String> {
    let conn = open_db(app)?;
    let account_namespace = account_namespace(owner_account_id);
    let key = get_or_create_master_key(app, &account_namespace)?;
    prepare_sender_key_distribution_core(
        &conn,
        &key,
        &account_namespace,
        &owner_member_id.to_string(),
        public_key_bundle,
    )
}

pub fn consume_sender_key_distribution(
    app: &tauri::AppHandle,
    owner_account_id: i64,
    sender_member_id: i64,
    distribution_message: &[u8],
    sender_key_version: i64,
) -> Result<ConsumeSenderKeyDistributionResult, String> {
    let conn = open_db(app)?;
    consume_sender_key_distribution_with_conn(
        &conn,
        app,
        owner_account_id,
        sender_member_id,
        distribution_message,
        sender_key_version,
    )
}

pub fn consume_sender_key_distribution_with_conn(
    conn: &Connection,
    app: &tauri::AppHandle,
    owner_account_id: i64,
    sender_member_id: i64,
    distribution_message: &[u8],
    sender_key_version: i64,
) -> Result<ConsumeSenderKeyDistributionResult, String> {
    let account_namespace = account_namespace(owner_account_id);
    let key = get_or_create_master_key(app, &account_namespace)?;
    consume_sender_key_distribution_core(
        conn,
        &key,
        &account_namespace,
        &sender_member_id.to_string(),
        distribution_message,
        sender_key_version,
    )
}

pub fn encrypt_message(
    app: &tauri::AppHandle,
    owner_account_id: i64,
    owner_member_id: i64,
    plaintext: &[u8],
) -> Result<SenderKeyEncryptedMessage, String> {
    let conn = open_db(app)?;
    let account_namespace = account_namespace(owner_account_id);
    let key = get_or_create_master_key(app, &account_namespace)?;
    encrypt_with_sender_key_core(
        &conn,
        &key,
        &account_namespace,
        &owner_member_id.to_string(),
        plaintext,
    )
}

pub fn decrypt_message(
    app: &tauri::AppHandle,
    owner_account_id: i64,
    sender_member_id: i64,
    ciphertext: &[u8],
    nonce: &[u8],
) -> Result<SenderKeyDecryptResult, String> {
    let conn = open_db(app)?;
    let account_namespace = account_namespace(owner_account_id);
    let key = get_or_create_master_key(app, &account_namespace)?;
    decrypt_with_sender_key_result_core(
        &conn,
        &key,
        &account_namespace,
        &sender_member_id.to_string(),
        ciphertext,
        nonce,
    )
}
