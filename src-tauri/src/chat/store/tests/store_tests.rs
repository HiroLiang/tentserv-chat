use rusqlite::{params, Connection};

use super::messages::{resolve_preferred_client_message_id, upsert_chat_message};
use crate::chat::ChatMessageSnapshot;
use crate::store::db::{init_schema, migrate_schema};

fn open_test_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory db must open");
    init_schema(&conn).expect("init_schema must succeed");
    migrate_schema(&conn).expect("migrate_schema must succeed");
    conn
}

fn message_snapshot(
    client_message_id: &str,
    message_id: Option<i64>,
    content: &str,
    created_at: &str,
    delivery_status: &str,
    is_local_echo: bool,
) -> ChatMessageSnapshot {
    ChatMessageSnapshot {
        client_message_id: client_message_id.to_string(),
        message_id,
        sender_id: 6,
        sender_device_id: "device-6".to_string(),
        sender_key_version: 1776090000000,
        r#type: "text".to_string(),
        content: content.to_string(),
        reply_to_id: None,
        is_edited: false,
        is_deleted: false,
        created_at: created_at.to_string(),
        sort_key: 0,
        delivery_status: delivery_status.to_string(),
        delivery_error: None,
        is_local_echo,
    }
}

#[test]
fn upsert_chat_message_merges_server_backfill_into_existing_local_row() {
    let conn = open_test_conn();
    let account_id = 1;
    let room_id = 3;
    let local_client_message_id = "local:3:1776020000000";
    let server_message_id = 42;

    println!("Given: a pending local echo already exists for the room");
    upsert_chat_message(
        &conn,
        account_id,
        room_id,
        &message_snapshot(
            local_client_message_id,
            None,
            "pending message",
            "2026-04-13T03:00:00Z",
            "pending",
            true,
        ),
    )
    .expect("local echo insert must succeed");

    conn.execute(
        r#"
        UPDATE chat_messages
        SET server_message_id = ?4,
            delivery_status = 'sent',
            is_local_echo = 0
        WHERE account_id = ?1 AND room_id = ?2 AND client_message_id = ?3
        "#,
        params![
            account_id,
            room_id,
            local_client_message_id,
            server_message_id
        ],
    )
    .expect("local echo should be linked to the server id");

    println!(
        "Action: room sync backfills the same message using server:{}",
        server_message_id
    );
    upsert_chat_message(
        &conn,
        account_id,
        room_id,
        &message_snapshot(
            "server:42",
            Some(server_message_id),
            "confirmed message",
            "2026-04-13T03:00:01Z",
            "sent",
            false,
        ),
    )
    .expect("server backfill merge must succeed");

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chat_messages WHERE account_id = ?1 AND room_id = ?2 AND server_message_id = ?3",
            params![account_id, room_id, server_message_id],
            |row| row.get(0),
        )
        .expect("message count should be readable");
    let (client_message_id, content, created_at): (String, String, String) = conn
        .query_row(
            "SELECT client_message_id, content, created_at FROM chat_messages WHERE account_id = ?1 AND room_id = ?2 AND server_message_id = ?3",
            params![account_id, room_id, server_message_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("merged row should exist");

    println!("Output: merged_row_count={count} client_message_id={client_message_id}");
    assert_eq!(count, 1, "same server message must collapse to one row");
    assert_eq!(client_message_id, local_client_message_id);
    assert_eq!(content, "confirmed message");
    assert_eq!(created_at, "2026-04-13T03:00:01Z");
}

#[test]
fn resolve_preferred_client_message_id_prefers_local_encrypted_row_over_server_alias() {
    let conn = open_test_conn();
    conn.execute(
        r#"
        INSERT INTO chat_messages_encrypted (
            account_id, room_id, client_message_id, server_message_id, sender_id,
            sender_device_id, sender_key_version, encrypted_content, message_type, created_at, received_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, unixepoch())
        "#,
        params![
            1,
            3,
            "local:3:1776020001234",
            77,
            6,
            "device-6",
            1776090000000_i64,
            b"e2ee:v1:ciphertext".to_vec(),
            "text",
            "2026-04-13T03:00:00Z",
        ],
    )
    .expect("encrypted local echo insert must succeed");

    let target = resolve_preferred_client_message_id(
        &conn,
        "chat_messages_encrypted",
        1,
        3,
        Some(77),
        "server:77",
    )
    .expect("target client message id must resolve");

    assert_eq!(target, "local:3:1776020001234");
}

#[test]
fn upsert_chat_message_updates_room_latest_message_metadata_with_sort_order_and_sender_key_version() {
    let conn = open_test_conn();
    let account_id = 1;
    let room_id = 8;

    conn.execute(
        r#"
        INSERT INTO chat_rooms (
            account_id, room_id, room_type, display_name, unread_count, sort_order, updated_at
        )
        VALUES (?1, ?2, 'direct', 'Bell', 0, 0, unixepoch())
        "#,
        params![account_id, room_id],
    )
    .expect("room summary seed must succeed");

    let message = ChatMessageSnapshot {
        client_message_id: "server:501".to_string(),
        message_id: Some(501),
        sender_id: 9,
        sender_device_id: "device-bell-2".to_string(),
        sender_key_version: 1776100000001,
        r#type: "text".to_string(),
        content: "decrypted preview".to_string(),
        reply_to_id: None,
        is_edited: false,
        is_deleted: false,
        created_at: "2026-04-14T03:02:18Z".to_string(),
        sort_key: 1776100001234,
        delivery_status: "sent".to_string(),
        delivery_error: None,
        is_local_echo: false,
    };

    upsert_chat_message(&conn, account_id, room_id, &message)
        .expect("message upsert must succeed");

    let row: (Option<i64>, Option<String>, Option<i64>, i64) = conn
        .query_row(
            r#"
            SELECT latest_message_id, latest_message_sender_device_id,
                   latest_message_sender_key_version, sort_order
            FROM chat_rooms
            WHERE account_id = ?1 AND room_id = ?2
            "#,
            params![account_id, room_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .expect("room latest metadata should be readable");

    assert_eq!(row.0, Some(501));
    assert_eq!(row.1.as_deref(), Some("device-bell-2"));
    assert_eq!(row.2, Some(1776100000001));
    assert_eq!(row.3, 1776100001234);
}
