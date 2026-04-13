use rusqlite::{params, Connection, OptionalExtension};

use crate::chat::ChatSyncState;
use crate::store::db::open_db;

pub fn save_sync_state(
    app: &tauri::AppHandle,
    account_id: i64,
    participant_id: Option<i64>,
    active_room_id: Option<i64>,
    last_rooms_sync_at: Option<&str>,
    last_active_room_sync_at: Option<&str>,
    self_sender_key_sync_status: Option<&str>,
    self_sender_key_sync_error: Option<&str>,
    error: Option<&str>,
) -> Result<ChatSyncState, String> {
    let conn = open_db(app)?;
    save_sync_state_inner(
        &conn,
        account_id,
        participant_id,
        active_room_id,
        last_rooms_sync_at,
        last_active_room_sync_at,
        self_sender_key_sync_status,
        self_sender_key_sync_error,
        error,
    )?;
    load_sync_state(&conn, account_id)
}

pub fn update_ws_status(
    app: &tauri::AppHandle,
    account_id: i64,
    ws_status: &str,
    error: Option<&str>,
) -> Result<ChatSyncState, String> {
    let conn = open_db(app)?;
    conn.execute(
        r#"
        INSERT INTO chat_sync_state (
            account_id, ws_status, self_sender_key_sync_status, updated_at
        )
        VALUES (?1, ?2, 'idle', unixepoch())
        ON CONFLICT(account_id) DO UPDATE SET
            ws_status = excluded.ws_status,
            error = ?3,
            updated_at = unixepoch()
        "#,
        params![account_id, ws_status, error],
    )
    .map_err(|err| format!("update ws status failed: {err}"))?;
    load_sync_state(&conn, account_id)
}

pub(super) fn load_sync_state(conn: &Connection, account_id: i64) -> Result<ChatSyncState, String> {
    Ok(conn
        .query_row(
            r#"
            SELECT active_participant_id, active_room_id, ws_status, last_rooms_sync_at,
                   last_active_room_sync_at, self_sender_key_sync_status,
                   self_sender_key_sync_error, error
            FROM chat_sync_state
            WHERE account_id = ?1
            "#,
            params![account_id],
            |row| {
                Ok(ChatSyncState {
                    active_room_id: row.get(1)?,
                    ws_status: row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "idle".to_string()),
                    last_rooms_sync_at: row.get(3)?,
                    last_active_room_sync_at: row.get(4)?,
                    self_sender_key_sync_status: row
                        .get::<_, Option<String>>(5)?
                        .unwrap_or_else(|| "idle".to_string()),
                    self_sender_key_sync_error: row.get(6)?,
                    error: row.get(7)?,
                    pending_business_jobs: 0,
                    pending_sync_jobs: 0,
                })
            },
        )
        .optional()
        .map_err(|err| format!("query sync state failed: {err}"))?
        .unwrap_or_default())
}

pub(super) fn save_sync_state_inner(
    conn: &Connection,
    account_id: i64,
    participant_id: Option<i64>,
    active_room_id: Option<i64>,
    last_rooms_sync_at: Option<&str>,
    last_active_room_sync_at: Option<&str>,
    self_sender_key_sync_status: Option<&str>,
    self_sender_key_sync_error: Option<&str>,
    error: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO chat_sync_state (
            account_id, active_participant_id, active_room_id, ws_status,
            last_rooms_sync_at, last_active_room_sync_at, self_sender_key_sync_status,
            self_sender_key_sync_error, error, updated_at
        )
        VALUES (?1, ?2, ?3, COALESCE((SELECT ws_status FROM chat_sync_state WHERE account_id = ?1), 'idle'),
                ?4, ?5, COALESCE(?6, 'idle'), ?7, ?8, unixepoch())
        ON CONFLICT(account_id) DO UPDATE SET
            active_participant_id = COALESCE(excluded.active_participant_id, chat_sync_state.active_participant_id),
            active_room_id = excluded.active_room_id,
            last_rooms_sync_at = COALESCE(excluded.last_rooms_sync_at, chat_sync_state.last_rooms_sync_at),
            last_active_room_sync_at = COALESCE(excluded.last_active_room_sync_at, chat_sync_state.last_active_room_sync_at),
            self_sender_key_sync_status = COALESCE(excluded.self_sender_key_sync_status, chat_sync_state.self_sender_key_sync_status),
            self_sender_key_sync_error = excluded.self_sender_key_sync_error,
            error = excluded.error,
            updated_at = unixepoch()
        "#,
        params![
            account_id,
            participant_id,
            active_room_id,
            last_rooms_sync_at,
            last_active_room_sync_at,
            self_sender_key_sync_status,
            self_sender_key_sync_error,
            error,
        ],
    )
    .map_err(|err| format!("upsert chat sync state failed: {err}"))?;
    Ok(())
}
