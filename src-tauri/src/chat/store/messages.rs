use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use crate::chat::store::models::{DEFAULT_PAGE_LIMIT, EncryptedChatMessageRecord, RetryChatMessageRecord};
use crate::chat::ChatMessageSnapshot;
use crate::store::db::open_db;

pub fn load_retry_message(
    app: &tauri::AppHandle,
    account_id: i64,
    client_message_id: &str,
) -> Result<Option<RetryChatMessageRecord>, String> {
    let conn = open_db(app)?;
    conn.query_row(
        r#"
        SELECT client_message_id, server_message_id, sender_id, message_type, content,
               reply_to_id, is_edited, is_deleted, created_at, sort_key,
               delivery_status, delivery_error, is_local_echo, room_id
        FROM chat_messages
        WHERE account_id = ?1 AND client_message_id = ?2
        "#,
        params![account_id, client_message_id],
        |row| {
            Ok(RetryChatMessageRecord {
                message: ChatMessageSnapshot {
                    client_message_id: row.get(0)?,
                    message_id: row.get(1)?,
                    sender_id: row.get(2)?,
                    r#type: row.get(3)?,
                    content: row.get(4)?,
                    reply_to_id: row.get(5)?,
                    is_edited: row.get::<_, i64>(6)? != 0,
                    is_deleted: row.get::<_, i64>(7)? != 0,
                    created_at: row.get(8)?,
                    sort_key: row.get(9)?,
                    delivery_status: row.get(10)?,
                    delivery_error: row.get(11)?,
                    is_local_echo: row.get::<_, i64>(12)? != 0,
                },
                room_id: row.get::<_, i64>(13)?,
            })
        },
    )
    .optional()
    .map_err(|err| format!("query retry message failed: {err}"))
}

pub fn save_encrypted_message(
    app: &tauri::AppHandle,
    record: &EncryptedChatMessageRecord,
) -> Result<(), String> {
    let conn = open_db(app)?;
    let target_client_message_id = resolve_preferred_client_message_id(
        &conn,
        "chat_messages_encrypted",
        record.account_id,
        record.room_id,
        record.server_message_id,
        &record.client_message_id,
    )?;
    if let Some(server_message_id) = record.server_message_id {
        delete_duplicate_server_rows(
            &conn,
            "chat_messages_encrypted",
            record.account_id,
            record.room_id,
            server_message_id,
            &target_client_message_id,
        )?;
    }
    conn.execute(
        r#"
        INSERT INTO chat_messages_encrypted (
            account_id, room_id, client_message_id, server_message_id, sender_id, encrypted_content,
            message_type, created_at, received_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, unixepoch())
        ON CONFLICT(account_id, client_message_id) DO UPDATE SET
            room_id = excluded.room_id,
            server_message_id = COALESCE(excluded.server_message_id, chat_messages_encrypted.server_message_id),
            sender_id = excluded.sender_id,
            encrypted_content = excluded.encrypted_content,
            message_type = excluded.message_type,
            created_at = excluded.created_at,
            received_at = unixepoch()
        "#,
        params![
            record.account_id,
            record.room_id,
            target_client_message_id,
            record.server_message_id,
            record.sender_id,
            record.encrypted_content,
            record.message_type,
            record.created_at,
        ],
    )
    .map_err(|err| format!("save encrypted chat message failed: {err}"))?;
    Ok(())
}

pub fn link_encrypted_message_server_id(
    app: &tauri::AppHandle,
    account_id: i64,
    room_id: i64,
    client_message_id: &str,
    server_message_id: i64,
) -> Result<(), String> {
    let conn = open_db(app)?;
    let target_client_message_id = resolve_preferred_client_message_id(
        &conn,
        "chat_messages_encrypted",
        account_id,
        room_id,
        Some(server_message_id),
        client_message_id,
    )?;
    delete_duplicate_server_rows(
        &conn,
        "chat_messages_encrypted",
        account_id,
        room_id,
        server_message_id,
        &target_client_message_id,
    )?;
    conn.execute(
        r#"
        UPDATE chat_messages_encrypted
        SET server_message_id = ?4,
            received_at = unixepoch()
        WHERE account_id = ?1 AND room_id = ?2 AND client_message_id = ?3
        "#,
        params![account_id, room_id, target_client_message_id, server_message_id],
    )
    .map_err(|err| format!("link encrypted chat message failed: {err}"))?;
    Ok(())
}

pub fn save_or_update_message(
    app: &tauri::AppHandle,
    account_id: i64,
    room_id: i64,
    message: &ChatMessageSnapshot,
) -> Result<(), String> {
    let conn = open_db(app)?;
    upsert_chat_message(&conn, account_id, room_id, message)
}

pub fn update_message_delivery(
    app: &tauri::AppHandle,
    account_id: i64,
    room_id: i64,
    client_message_id: &str,
    delivery_status: &str,
    delivery_error: Option<&str>,
    server_message_id: Option<i64>,
    created_at: Option<&str>,
) -> Result<(), String> {
    let conn = open_db(app)?;
    let target_client_message_id = resolve_preferred_client_message_id(
        &conn,
        "chat_messages",
        account_id,
        room_id,
        server_message_id,
        client_message_id,
    )?;
    if let Some(server_message_id) = server_message_id {
        delete_duplicate_server_rows(
            &conn,
            "chat_messages",
            account_id,
            room_id,
            server_message_id,
            &target_client_message_id,
        )?;
    }
    let sort_key = created_at.map(sort_key_from_created_at);
    conn.execute(
        r#"
        UPDATE chat_messages
        SET server_message_id = COALESCE(?4, server_message_id),
            created_at = COALESCE(?5, created_at),
            sort_key = COALESCE(?6, sort_key),
            delivery_status = ?3,
            delivery_error = ?7,
            is_local_echo = CASE WHEN ?3 = 'sent' THEN 0 ELSE is_local_echo END,
            updated_at = unixepoch()
        WHERE account_id = ?1 AND room_id = ?2 AND client_message_id = ?8
        "#,
        params![
            account_id,
            room_id,
            delivery_status,
            server_message_id,
            created_at,
            sort_key,
            delivery_error,
            target_client_message_id,
        ],
    )
    .map_err(|err| format!("update message delivery failed: {err}"))?;
    Ok(())
}

pub(super) fn load_room_messages(
    conn: &Connection,
    account_id: i64,
    room_id: i64,
    before_sort_key: Option<i64>,
    limit: Option<u32>,
) -> Result<Vec<ChatMessageSnapshot>, String> {
    let limit = limit.unwrap_or(DEFAULT_PAGE_LIMIT);
    let mut stmt = conn
        .prepare(
            r#"
            SELECT client_message_id, server_message_id, sender_id, message_type, content, reply_to_id,
                   is_edited, is_deleted, created_at, sort_key, delivery_status, delivery_error, is_local_echo
            FROM chat_messages
            WHERE account_id = ?1 AND room_id = ?2 AND (?3 IS NULL OR sort_key < ?3)
            ORDER BY sort_key DESC
            LIMIT ?4
            "#,
        )
        .map_err(|err| format!("prepare load room messages failed: {err}"))?;

    let rows = stmt
        .query_map(params![account_id, room_id, before_sort_key, limit], |row| {
            Ok(ChatMessageSnapshot {
                client_message_id: row.get(0)?,
                message_id: row.get(1)?,
                sender_id: row.get(2)?,
                r#type: row.get(3)?,
                content: row.get(4)?,
                reply_to_id: row.get(5)?,
                is_edited: row.get::<_, i64>(6)? != 0,
                is_deleted: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                sort_key: row.get(9)?,
                delivery_status: row.get(10)?,
                delivery_error: row.get(11)?,
                is_local_echo: row.get::<_, i64>(12)? != 0,
            })
        })
        .map_err(|err| format!("query room messages failed: {err}"))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|err| format!("collect room message failed: {err}"))?);
    }
    out.reverse();
    Ok(out)
}

pub(super) fn has_more_messages(
    conn: &Connection,
    account_id: i64,
    room_id: i64,
    before_sort_key: Option<i64>,
    limit: Option<u32>,
) -> Result<bool, String> {
    let limit = limit.unwrap_or(DEFAULT_PAGE_LIMIT) as i64;
    let count: i64 = conn
        .query_row(
            r#"
            SELECT COUNT(*)
            FROM chat_messages
            WHERE account_id = ?1 AND room_id = ?2 AND (?3 IS NULL OR sort_key < ?3)
            "#,
            params![account_id, room_id, before_sort_key],
            |row| row.get(0),
        )
        .map_err(|err| format!("query has more messages failed: {err}"))?;
    Ok(count > limit)
}

pub(super) fn upsert_chat_message(
    conn: &Connection,
    account_id: i64,
    room_id: i64,
    message: &ChatMessageSnapshot,
) -> Result<(), String> {
    let sort_key = if message.sort_key == 0 {
        sort_key_from_created_at(&message.created_at)
    } else {
        message.sort_key
    };

    let target_client_message_id = resolve_preferred_client_message_id(
        conn,
        "chat_messages",
        account_id,
        room_id,
        message.message_id,
        &message.client_message_id,
    )?;
    if let Some(server_message_id) = message.message_id {
        delete_duplicate_server_rows(
            conn,
            "chat_messages",
            account_id,
            room_id,
            server_message_id,
            &target_client_message_id,
        )?;
    }

    conn.execute(
        r#"
        INSERT INTO chat_messages (
            account_id, room_id, client_message_id, server_message_id, sender_id, message_type,
            content, reply_to_id, is_edited, is_deleted, created_at, sort_key,
            delivery_status, delivery_error, is_local_echo, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, unixepoch())
        ON CONFLICT(account_id, client_message_id) DO UPDATE SET
            server_message_id = COALESCE(excluded.server_message_id, chat_messages.server_message_id),
            sender_id = excluded.sender_id,
            message_type = excluded.message_type,
            content = excluded.content,
            reply_to_id = excluded.reply_to_id,
            is_edited = excluded.is_edited,
            is_deleted = excluded.is_deleted,
            created_at = excluded.created_at,
            sort_key = excluded.sort_key,
            delivery_status = excluded.delivery_status,
            delivery_error = excluded.delivery_error,
            is_local_echo = excluded.is_local_echo,
            updated_at = unixepoch()
        "#,
        params![
            account_id,
            room_id,
            target_client_message_id,
            message.message_id,
            message.sender_id,
            message.r#type,
            message.content,
            message.reply_to_id,
            message.is_edited as i64,
            message.is_deleted as i64,
            message.created_at,
            sort_key,
            message.delivery_status,
            message.delivery_error,
            message.is_local_echo as i64,
        ],
    )
    .map_err(|err| format!("upsert chat message failed: {err}"))?;

    conn.execute(
        r#"
        UPDATE chat_rooms
        SET latest_message = ?3,
            latest_message_created_at = ?4,
            latest_message_sender_id = ?5,
            unread_count = CASE WHEN ?6 = 'sent' THEN unread_count ELSE unread_count END,
            sort_order = MAX(sort_order, ?7),
            updated_at = unixepoch()
        WHERE account_id = ?1 AND room_id = ?2
        "#,
        params![
            account_id,
            room_id,
            message.content,
            message.created_at,
            message.sender_id,
            message.delivery_status,
            sort_key,
        ],
    )
    .map_err(|err| format!("update latest message from chat message failed: {err}"))?;

    Ok(())
}

pub(super) fn resolve_preferred_client_message_id(
    conn: &Connection,
    table: &str,
    account_id: i64,
    room_id: i64,
    server_message_id: Option<i64>,
    incoming_client_message_id: &str,
) -> Result<String, String> {
    let Some(server_message_id) = server_message_id else {
        return Ok(incoming_client_message_id.to_string());
    };

    let existing_client_message_id = find_client_message_id_by_server_message_id(
        conn,
        table,
        account_id,
        room_id,
        server_message_id,
    )?;
    Ok(match existing_client_message_id {
        Some(existing_client_message_id) => {
            if is_server_client_id(incoming_client_message_id)
                && !is_server_client_id(&existing_client_message_id)
            {
                existing_client_message_id
            } else if !is_server_client_id(incoming_client_message_id)
                && is_server_client_id(&existing_client_message_id)
            {
                incoming_client_message_id.to_string()
            } else {
                existing_client_message_id
            }
        }
        None => incoming_client_message_id.to_string(),
    })
}

pub(super) fn find_client_message_id_by_server_message_id(
    conn: &Connection,
    table: &str,
    account_id: i64,
    room_id: i64,
    server_message_id: i64,
) -> Result<Option<String>, String> {
    conn.query_row(
        &format!(
            "SELECT client_message_id FROM {table} WHERE account_id = ?1 AND room_id = ?2 AND server_message_id = ?3"
        ),
        params![account_id, room_id, server_message_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|err| format!("query {table} by server_message_id failed: {err}"))
}

pub(super) fn delete_duplicate_server_rows(
    conn: &Connection,
    table: &str,
    account_id: i64,
    room_id: i64,
    server_message_id: i64,
    keep_client_message_id: &str,
) -> Result<(), String> {
    conn.execute(
        &format!(
            "DELETE FROM {table} WHERE account_id = ?1 AND room_id = ?2 AND server_message_id = ?3 AND client_message_id <> ?4"
        ),
        params![account_id, room_id, server_message_id, keep_client_message_id],
    )
    .map_err(|err| format!("delete duplicate {table} rows failed: {err}"))?;
    Ok(())
}

fn is_server_client_id(client_message_id: &str) -> bool {
    client_message_id.starts_with("server:")
}

pub fn sort_key_from_created_at(created_at: &str) -> i64 {
    DateTime::parse_from_rfc3339(created_at)
        .map(|parsed| parsed.timestamp_millis())
        .unwrap_or_else(|_| Utc::now().timestamp_millis())
}
