use rusqlite::{params, Connection, OptionalExtension};

use super::messages::{
    has_more_messages, load_room_messages, sort_key_from_created_at, upsert_chat_message,
};
use super::sync_state::{load_sync_state, save_sync_state_inner};
use crate::chat::{
    ChatInvitationSnapshot, ChatMemberSnapshot, ChatRoomSnapshot, ChatRoomSummarySnapshot,
    ChatRoomsSections, ChatRoomsSnapshot,
};
use crate::store::db::open_db;

pub fn load_rooms_snapshot(
    app: &tauri::AppHandle,
    account_id: i64,
) -> Result<ChatRoomsSnapshot, String> {
    let conn = open_db(app)?;
    let sync_state = load_sync_state(&conn, account_id)?;
    let participant_id = conn
        .query_row(
            "SELECT active_participant_id FROM chat_sync_state WHERE account_id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| format!("query active participant failed: {err}"))?;
    Ok(ChatRoomsSnapshot {
        participant_id,
        rooms: load_rooms_sections(&conn, account_id)?,
        sync_state,
    })
}

pub fn load_room_snapshot(
    app: &tauri::AppHandle,
    account_id: i64,
    room_id: i64,
    before_sort_key: Option<i64>,
    limit: Option<u32>,
) -> Result<Option<ChatRoomSnapshot>, String> {
    let conn = open_db(app)?;
    load_room_snapshot_with_conn(&conn, account_id, room_id, before_sort_key, limit)
}

pub fn save_rooms_snapshot(
    app: &tauri::AppHandle,
    account_id: i64,
    participant_id: Option<i64>,
    sections: &ChatRoomsSections,
) -> Result<(), String> {
    let mut conn = open_db(app)?;
    let tx = conn
        .transaction()
        .map_err(|err| format!("begin save rooms snapshot tx failed: {err}"))?;

    save_sync_state_inner(
        &tx,
        account_id,
        participant_id,
        None,
        None,
        None,
        None,
        None,
        None,
    )?;

    let mut room_ids = Vec::new();
    for room in sections
        .direct
        .iter()
        .chain(sections.group.iter())
        .chain(sections.channel.iter())
        .chain(sections.bot.iter())
    {
        room_ids.push(room.room_id);
        upsert_room_summary(&tx, account_id, room)?;
    }

    if room_ids.is_empty() {
        tx.execute(
            "DELETE FROM chat_rooms WHERE account_id = ?1",
            params![account_id],
        )
        .map_err(|err| format!("clear rooms failed: {err}"))?;
    } else {
        let placeholders = std::iter::repeat("?")
            .take(room_ids.len())
            .collect::<Vec<_>>()
            .join(", ");
        let mut params_vec: Vec<rusqlite::types::Value> = Vec::with_capacity(room_ids.len() + 1);
        params_vec.push(account_id.into());
        params_vec.extend(room_ids.iter().copied().map(Into::into));
        tx.execute(
            &format!(
                "DELETE FROM chat_rooms WHERE account_id = ?1 AND room_id NOT IN ({placeholders})"
            ),
            rusqlite::params_from_iter(params_vec),
        )
        .map_err(|err| format!("delete stale rooms failed: {err}"))?;
    }

    tx.commit()
        .map_err(|err| format!("commit save rooms snapshot failed: {err}"))
}

pub fn save_room_snapshot(
    app: &tauri::AppHandle,
    account_id: i64,
    snapshot: &ChatRoomSnapshot,
) -> Result<(), String> {
    let mut conn = open_db(app)?;
    let tx = conn
        .transaction()
        .map_err(|err| format!("begin save room snapshot tx failed: {err}"))?;

    upsert_room_detail(&tx, account_id, snapshot)?;
    replace_room_members(&tx, account_id, snapshot.room_id, &snapshot.members)?;
    save_invitation(
        &tx,
        account_id,
        snapshot.room_id,
        snapshot.pending_invitation.as_ref(),
    )?;

    for message in &snapshot.messages {
        upsert_chat_message(&tx, account_id, snapshot.room_id, message)?;
    }

    tx.commit()
        .map_err(|err| format!("commit save room snapshot failed: {err}"))
}

pub fn update_room_member_reads(
    app: &tauri::AppHandle,
    account_id: i64,
    room_id: i64,
    members: &[ChatMemberSnapshot],
) -> Result<(), String> {
    let conn = open_db(app)?;
    for member in members {
        conn.execute(
            r#"
            UPDATE chat_room_members
            SET last_read_at = ?4
            WHERE account_id = ?1 AND room_id = ?2 AND member_id = ?3
            "#,
            params![account_id, room_id, member.member_id, member.last_read_at],
        )
        .map_err(|err| format!("update room member last_read_at failed: {err}"))?;
    }
    Ok(())
}

pub fn update_room_unread(
    app: &tauri::AppHandle,
    account_id: i64,
    room_id: i64,
    unread_count: i64,
) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute(
        "UPDATE chat_rooms SET unread_count = ?3, updated_at = unixepoch() WHERE account_id = ?1 AND room_id = ?2",
        params![account_id, room_id, unread_count],
    )
    .map_err(|err| format!("update room unread failed: {err}"))?;
    Ok(())
}

pub fn update_room_presence(
    app: &tauri::AppHandle,
    account_id: i64,
    peer_user_id: i64,
    presence_status: &str,
    last_seen_at: Option<&str>,
) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute(
        r#"
        UPDATE chat_rooms
        SET presence_status = ?3,
            last_seen_at = ?4,
            updated_at = unixepoch()
        WHERE account_id = ?1 AND peer_user_id = ?2
        "#,
        params![account_id, peer_user_id, presence_status, last_seen_at],
    )
    .map_err(|err| format!("update room presence failed: {err}"))?;
    Ok(())
}

pub fn update_direct_key_status(
    app: &tauri::AppHandle,
    account_id: i64,
    room_id: i64,
    status: &str,
) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute(
        "UPDATE chat_rooms SET direct_key_status = ?3, updated_at = unixepoch() WHERE account_id = ?1 AND room_id = ?2",
        params![account_id, room_id, status],
    )
    .map_err(|err| format!("update direct key status failed: {err}"))?;
    Ok(())
}

fn load_rooms_sections(conn: &Connection, account_id: i64) -> Result<ChatRoomsSections, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT room_id, room_type, display_name, avatar_url, peer_user_id, presence_status,
                   last_seen_at, status, latest_message, latest_message_id, latest_message_created_at,
                   latest_message_sender_id, latest_message_sender_device_id, latest_message_sender_key_version,
                   unread_count, blocked_by_peer, blocked_by_me, direct_key_status, member_count
            FROM chat_rooms
            WHERE account_id = ?1
            ORDER BY CASE room_type
                       WHEN 'direct' THEN 0
                       WHEN 'group' THEN 1
                       WHEN 'channel' THEN 2
                       ELSE 3
                     END,
                     sort_order DESC,
                     room_id ASC
            "#,
        )
        .map_err(|err| format!("prepare load rooms sections failed: {err}"))?;

    let rows = stmt
        .query_map(params![account_id], |row| {
            Ok(ChatRoomSummarySnapshot {
                room_id: row.get(0)?,
                room_type: row.get(1)?,
                display_name: row.get(2)?,
                avatar_url: row.get(3)?,
                peer_user_id: row.get(4)?,
                presence_status: row.get(5)?,
                last_seen_at: row.get(6)?,
                status: row.get(7)?,
                latest_message: row.get(8)?,
                latest_message_id: row.get(9)?,
                latest_message_created_at: row.get(10)?,
                latest_message_sender_id: row.get(11)?,
                latest_message_sender_device_id: row.get(12)?,
                latest_message_sender_key_version: row.get(13)?,
                unread_count: row.get(14)?,
                blocked_by_peer: row.get::<_, i64>(15)? != 0,
                blocked_by_me: row.get::<_, i64>(16)? != 0,
                direct_key_status: row.get(17)?,
                member_count: row.get(18)?,
            })
        })
        .map_err(|err| format!("query load rooms sections failed: {err}"))?;

    let mut sections = ChatRoomsSections::default();
    for row in rows {
        let room = row.map_err(|err| format!("collect room summary row failed: {err}"))?;
        match room.room_type.as_str() {
            "direct" => sections.direct.push(room),
            "group" => sections.group.push(room),
            "channel" => sections.channel.push(room),
            _ => sections.bot.push(room),
        }
    }
    Ok(sections)
}

fn load_room_snapshot_with_conn(
    conn: &Connection,
    account_id: i64,
    room_id: i64,
    before_sort_key: Option<i64>,
    limit: Option<u32>,
) -> Result<Option<ChatRoomSnapshot>, String> {
    let room = conn
        .query_row(
            r#"
            SELECT room_id, room_type, detail_name, detail_description, detail_avatar_url,
                   blocked_by_peer, blocked_by_me, COALESCE(status, 'active'),
                   COALESCE(direct_key_status, 'loading'), COALESCE(member_count, 0)
            FROM chat_rooms
            WHERE account_id = ?1 AND room_id = ?2
            "#,
            params![account_id, room_id],
            |row| {
                Ok(ChatRoomSnapshot {
                    room_id: row.get(0)?,
                    room_type: row.get(1)?,
                    name: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    description: row.get(3)?,
                    avatar_url: row.get(4)?,
                    blocked_by_peer: row.get::<_, i64>(5)? != 0,
                    blocked_by_me: row.get::<_, i64>(6)? != 0,
                    status: row.get(7)?,
                    direct_key_status: row.get(8)?,
                    member_count: row.get(9)?,
                    members: Vec::new(),
                    messages: Vec::new(),
                    has_more: false,
                    pending_invitation: None,
                })
            },
        )
        .optional()
        .map_err(|err| format!("query room snapshot failed: {err}"))?;

    let Some(mut room) = room else {
        return Ok(None);
    };

    room.members = load_room_members(conn, account_id, room_id)?;
    room.messages = load_room_messages(conn, account_id, room_id, before_sort_key, limit)?;
    room.has_more = has_more_messages(conn, account_id, room_id, before_sort_key, limit)?;
    room.pending_invitation = load_invitation(conn, account_id, room_id)?;
    if room.member_count == 0 {
        room.member_count = room.members.len() as i64;
    }

    Ok(Some(room))
}

fn load_room_members(
    conn: &Connection,
    account_id: i64,
    room_id: i64,
) -> Result<Vec<ChatMemberSnapshot>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT member_id, participant_id, user_id, display_name, avatar_url, role, last_read_at, joined_at
            FROM chat_room_members
            WHERE account_id = ?1 AND room_id = ?2
            ORDER BY joined_at ASC, member_id ASC
            "#,
        )
        .map_err(|err| format!("prepare load room members failed: {err}"))?;

    let rows = stmt
        .query_map(params![account_id, room_id], |row| {
            Ok(ChatMemberSnapshot {
                member_id: row.get(0)?,
                participant_id: row.get(1)?,
                user_id: row.get(2)?,
                display_name: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                avatar_url: row.get(4)?,
                role: row
                    .get::<_, Option<String>>(5)?
                    .unwrap_or_else(|| "member".to_string()),
                last_read_at: row.get(6)?,
                joined_at: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
            })
        })
        .map_err(|err| format!("query room members failed: {err}"))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|err| format!("collect room member failed: {err}"))?);
    }
    Ok(out)
}

fn load_invitation(
    conn: &Connection,
    account_id: i64,
    room_id: i64,
) -> Result<Option<ChatInvitationSnapshot>, String> {
    conn.query_row(
        r#"
        SELECT found, invitation_id, role, inviter_name, inviter_avatar, inviter_user_id
        FROM chat_invitations
        WHERE account_id = ?1 AND room_id = ?2
        "#,
        params![account_id, room_id],
        |row| {
            Ok(ChatInvitationSnapshot {
                found: row.get::<_, i64>(0)? != 0,
                invitation_id: row.get(1)?,
                role: row.get(2)?,
                inviter_name: row.get(3)?,
                inviter_avatar: row.get(4)?,
                inviter_user_id: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|err| format!("query invitation failed: {err}"))
}

fn upsert_room_summary(
    conn: &Connection,
    account_id: i64,
    room: &ChatRoomSummarySnapshot,
) -> Result<(), String> {
    let sort_order = room
        .latest_message_created_at
        .as_deref()
        .map(sort_key_from_created_at)
        .unwrap_or(i64::MIN / 2);

    conn.execute(
        r#"
        INSERT INTO chat_rooms (
            account_id, room_id, room_type, display_name, avatar_url, peer_user_id, presence_status,
            last_seen_at, status, latest_message, latest_message_id, latest_message_created_at, latest_message_sender_id,
            latest_message_sender_device_id, latest_message_sender_key_version, unread_count, blocked_by_peer, blocked_by_me, direct_key_status, member_count,
            detail_name, detail_description, detail_avatar_url, sort_order, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, NULL, ?22, ?23, unixepoch())
        ON CONFLICT(account_id, room_id) DO UPDATE SET
            room_type = excluded.room_type,
            display_name = excluded.display_name,
            avatar_url = excluded.avatar_url,
            peer_user_id = excluded.peer_user_id,
            presence_status = excluded.presence_status,
            last_seen_at = excluded.last_seen_at,
            status = excluded.status,
            latest_message = excluded.latest_message,
            latest_message_id = excluded.latest_message_id,
            latest_message_created_at = excluded.latest_message_created_at,
            latest_message_sender_id = excluded.latest_message_sender_id,
            latest_message_sender_device_id = excluded.latest_message_sender_device_id,
            latest_message_sender_key_version = excluded.latest_message_sender_key_version,
            unread_count = excluded.unread_count,
            blocked_by_peer = excluded.blocked_by_peer,
            blocked_by_me = excluded.blocked_by_me,
            direct_key_status = COALESCE(excluded.direct_key_status, chat_rooms.direct_key_status),
            member_count = COALESCE(excluded.member_count, chat_rooms.member_count),
            detail_name = COALESCE(chat_rooms.detail_name, excluded.detail_name),
            detail_avatar_url = COALESCE(chat_rooms.detail_avatar_url, excluded.detail_avatar_url),
            sort_order = excluded.sort_order,
            updated_at = unixepoch()
        "#,
        params![
            account_id,
            room.room_id,
            room.room_type,
            room.display_name,
            room.avatar_url,
            room.peer_user_id,
            room.presence_status,
            room.last_seen_at,
            room.status.as_deref().unwrap_or("active"),
            room.latest_message,
            room.latest_message_id,
            room.latest_message_created_at,
            room.latest_message_sender_id,
            room.latest_message_sender_device_id,
            room.latest_message_sender_key_version,
            room.unread_count,
            room.blocked_by_peer as i64,
            room.blocked_by_me as i64,
            room.direct_key_status,
            room.member_count,
            room.display_name,
            room.avatar_url,
            sort_order,
        ],
    )
    .map_err(|err| format!("upsert room summary failed: {err}"))?;
    Ok(())
}

fn upsert_room_detail(
    conn: &Connection,
    account_id: i64,
    room: &ChatRoomSnapshot,
) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO chat_rooms (
            account_id, room_id, room_type, display_name, avatar_url, status,
            blocked_by_peer, blocked_by_me, direct_key_status, member_count,
            detail_name, detail_description, detail_avatar_url, sort_order, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, unixepoch())
        ON CONFLICT(account_id, room_id) DO UPDATE SET
            room_type = excluded.room_type,
            display_name = CASE
                WHEN excluded.room_type IN ('direct', 'bot')
                    THEN COALESCE(NULLIF(chat_rooms.display_name, ''), NULLIF(excluded.display_name, ''), chat_rooms.display_name, excluded.display_name)
                ELSE COALESCE(NULLIF(excluded.display_name, ''), chat_rooms.display_name)
            END,
            avatar_url = CASE
                WHEN excluded.room_type IN ('direct', 'bot')
                    THEN COALESCE(chat_rooms.avatar_url, excluded.avatar_url)
                ELSE COALESCE(excluded.avatar_url, chat_rooms.avatar_url)
            END,
            status = excluded.status,
            blocked_by_peer = excluded.blocked_by_peer,
            blocked_by_me = excluded.blocked_by_me,
            direct_key_status = excluded.direct_key_status,
            member_count = excluded.member_count,
            detail_name = COALESCE(NULLIF(excluded.detail_name, ''), chat_rooms.detail_name),
            detail_description = excluded.detail_description,
            detail_avatar_url = COALESCE(excluded.detail_avatar_url, chat_rooms.detail_avatar_url),
            sort_order = MAX(chat_rooms.sort_order, excluded.sort_order),
            updated_at = unixepoch()
        "#,
        params![
            account_id,
            room.room_id,
            room.room_type,
            room.name,
            room.avatar_url,
            room.status,
            room.blocked_by_peer as i64,
            room.blocked_by_me as i64,
            room.direct_key_status,
            room.member_count,
            room.name,
            room.description,
            room.avatar_url,
            room.messages.last().map(|message| message.sort_key).unwrap_or(i64::MIN / 2),
        ],
    )
    .map_err(|err| format!("upsert room detail failed: {err}"))?;
    Ok(())
}

fn replace_room_members(
    conn: &Connection,
    account_id: i64,
    room_id: i64,
    members: &[ChatMemberSnapshot],
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM chat_room_members WHERE account_id = ?1 AND room_id = ?2",
        params![account_id, room_id],
    )
    .map_err(|err| format!("delete room members failed: {err}"))?;

    for member in members {
        conn.execute(
            r#"
            INSERT INTO chat_room_members (
                account_id, room_id, member_id, participant_id, user_id, display_name,
                avatar_url, role, last_read_at, joined_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
            params![
                account_id,
                room_id,
                member.member_id,
                member.participant_id,
                member.user_id,
                member.display_name,
                member.avatar_url,
                member.role,
                member.last_read_at,
                member.joined_at,
            ],
        )
        .map_err(|err| format!("insert room member failed: {err}"))?;
    }

    Ok(())
}

fn save_invitation(
    conn: &Connection,
    account_id: i64,
    room_id: i64,
    invitation: Option<&ChatInvitationSnapshot>,
) -> Result<(), String> {
    match invitation {
        Some(invitation) => {
            conn.execute(
                r#"
                INSERT INTO chat_invitations (
                    account_id, room_id, found, invitation_id, role, inviter_name,
                    inviter_avatar, inviter_user_id, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, unixepoch())
                ON CONFLICT(account_id, room_id) DO UPDATE SET
                    found = excluded.found,
                    invitation_id = excluded.invitation_id,
                    role = excluded.role,
                    inviter_name = excluded.inviter_name,
                    inviter_avatar = excluded.inviter_avatar,
                    inviter_user_id = excluded.inviter_user_id,
                    updated_at = unixepoch()
                "#,
                params![
                    account_id,
                    room_id,
                    invitation.found as i64,
                    invitation.invitation_id,
                    invitation.role,
                    invitation.inviter_name,
                    invitation.inviter_avatar,
                    invitation.inviter_user_id,
                ],
            )
            .map_err(|err| format!("upsert invitation failed: {err}"))?;
        }
        None => {
            conn.execute(
                "DELETE FROM chat_invitations WHERE account_id = ?1 AND room_id = ?2",
                params![account_id, room_id],
            )
            .map_err(|err| format!("delete invitation failed: {err}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{load_rooms_sections, upsert_room_detail, upsert_room_summary};
    use crate::chat::{ChatRoomSnapshot, ChatRoomSummarySnapshot};
    use crate::store::db::{init_schema, migrate_schema};

    fn open_test_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db must open");
        init_schema(&conn).expect("schema init must succeed");
        migrate_schema(&conn).expect("schema migration must succeed");
        conn
    }

    #[test]
    fn upsert_room_detail_keeps_direct_summary_identity_when_detail_name_is_blank() {
        let conn = open_test_conn();
        let account_id = 9;

        upsert_room_summary(
            &conn,
            account_id,
            &ChatRoomSummarySnapshot {
                room_id: 21,
                room_type: "direct".to_string(),
                display_name: "Mizi Liang".to_string(),
                avatar_url: Some("avatars/mizi.png".to_string()),
                ..Default::default()
            },
        )
        .expect("summary insert must succeed");

        upsert_room_detail(
            &conn,
            account_id,
            &ChatRoomSnapshot {
                room_id: 21,
                room_type: "direct".to_string(),
                name: String::new(),
                avatar_url: None,
                status: "active".to_string(),
                direct_key_status: "locked".to_string(),
                member_count: 2,
                ..Default::default()
            },
        )
        .expect("detail upsert must succeed");

        let sections = load_rooms_sections(&conn, account_id).expect("sections should load");
        let room = sections.direct.first().expect("direct room should exist");

        assert_eq!(room.display_name, "Mizi Liang");
        assert_eq!(room.avatar_url.as_deref(), Some("avatars/mizi.png"));
    }
}
