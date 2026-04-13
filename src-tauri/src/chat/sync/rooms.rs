use crate::chat::api::{
    ChatApiClient, GetMyRoomInvitationResponse, GetUserRoomsResponse, RoomDetailResponse,
    RoomMemberResponse, RoomSummaryResponse,
};
use crate::chat::store;
use crate::chat::{
    ChatInvitationSnapshot, ChatMemberSnapshot, ChatMessageSnapshot, ChatRoomSnapshot,
    ChatRoomSummarySnapshot, ChatRoomsSections, ChatRuntimeSession,
};

use super::messages::{decrypt_message_content, decrypt_messages};
use super::sender_keys::reconcile_room_sender_keys;

#[derive(Debug, Clone)]
pub struct SyncRoomResult {
    pub snapshot: ChatRoomSnapshot,
}

pub async fn sync_rooms(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    participant_id: Option<i64>,
) -> Result<ChatRoomsSections, String> {
    log::info!(
        "chat runtime sync: sync rooms account_id={} participant_id={participant_id:?}",
        session.account_id
    );
    let rooms = api.get_rooms().await?;
    let sections = build_rooms_sections(app, session, api, rooms).await?;
    store::save_rooms_snapshot(app, session.account_id, participant_id, &sections)?;
    log::info!(
        "chat runtime sync: synced rooms direct={} group={} channel={} bot={}",
        sections.direct.len(),
        sections.group.len(),
        sections.channel.len(),
        sections.bot.len()
    );
    Ok(sections)
}

pub async fn sync_room(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    participant_id: Option<i64>,
    room_id: i64,
    before_sort_key: Option<i64>,
    limit: Option<u32>,
) -> Result<SyncRoomResult, String> {
    log::info!(
        "chat runtime sync: sync room room_id={} before_sort_key={before_sort_key:?} limit={limit:?}",
        room_id
    );
    if before_sort_key.is_some() {
        let response = api.get_room_messages(room_id, None, limit).await?;
        let current = store::load_room_snapshot(app, session.account_id, room_id, None, None)?
            .ok_or_else(|| format!("room {room_id} not found in local store"))?;
        let messages = decrypt_messages(app, session, api, room_id, response.messages).await?;
        let mut snapshot = current;
        snapshot.messages = messages;
        snapshot.has_more = response.has_more;
        store::save_room_snapshot(app, session.account_id, &snapshot)?;
        return Ok(SyncRoomResult { snapshot });
    }

    let detail = api.get_room_detail(room_id).await?;
    let invitation = api.get_my_room_invitation(room_id).await?;
    let current_member_id = resolve_current_member_id(participant_id, &detail.members);
    let direct_key_status = reconcile_room_sender_keys(
        app,
        session,
        api,
        room_id,
        &detail.members,
        current_member_id,
    )
    .await?;

    let messages = decrypt_messages(app, session, api, room_id, detail.messages.clone()).await?;
    let snapshot = build_room_snapshot(detail, invitation, messages, direct_key_status);
    store::save_room_snapshot(app, session.account_id, &snapshot)?;
    log::info!(
        "chat runtime sync: synced room room_id={} direct_key_status={} member_count={} message_count={}",
        snapshot.room_id,
        snapshot.direct_key_status,
        snapshot.member_count,
        snapshot.messages.len()
    );
    Ok(SyncRoomResult { snapshot })
}

pub async fn handle_presence_changed(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    payload: crate::chat::ws::PresenceUserStatusChangedPayload,
) -> Result<(), String> {
    store::update_room_presence(
        app,
        session.account_id,
        payload.user_id,
        &payload.status,
        payload.last_seen_at.as_deref(),
    )
}

pub fn resolve_current_member_id(
    participant_id: Option<i64>,
    members: &[RoomMemberResponse],
) -> Option<i64> {
    let participant_id = participant_id?;
    members
        .iter()
        .find(|member| member.participant_id == participant_id)
        .map(|member| member.member_id)
}

pub fn resolve_current_member_id_snapshot(
    participant_id: Option<i64>,
    members: &[ChatMemberSnapshot],
) -> Option<i64> {
    let participant_id = participant_id?;
    members
        .iter()
        .find(|member| member.participant_id == participant_id)
        .map(|member| member.member_id)
}

async fn build_rooms_sections(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    rooms: GetUserRoomsResponse,
) -> Result<ChatRoomsSections, String> {
    let direct = decrypt_room_summaries(app, session, api, rooms.direct).await?;
    let group = decrypt_room_summaries(app, session, api, rooms.group).await?;
    let channel = decrypt_room_summaries(app, session, api, rooms.channel).await?;
    let bot = decrypt_room_summaries(app, session, api, rooms.bot).await?;
    Ok(ChatRoomsSections {
        direct,
        group,
        channel,
        bot,
    })
}

async fn decrypt_room_summaries(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    rooms: Vec<RoomSummaryResponse>,
) -> Result<Vec<ChatRoomSummarySnapshot>, String> {
    let mut result = Vec::with_capacity(rooms.len());
    for room in rooms {
        let latest_message = match (&room.latest_message, room.latest_message_sender_id) {
            (Some(message), Some(sender_member_id)) => Some(
                decrypt_message_content(app, session, api, room.room_id, sender_member_id, message)
                    .await
                    .unwrap_or_else(|_| message.clone()),
            ),
            (Some(message), None) => Some(message.clone()),
            _ => None,
        };

        result.push(ChatRoomSummarySnapshot {
            room_id: room.room_id,
            room_type: room.room_type,
            display_name: room.display_name,
            avatar_url: room.avatar_url,
            peer_user_id: room.peer_user_id,
            presence_status: room.presence_status,
            last_seen_at: room.last_seen_at,
            status: room.status,
            latest_message,
            latest_message_created_at: room.latest_message_created_at,
            latest_message_sender_id: room.latest_message_sender_id,
            unread_count: room.unread_count,
            blocked_by_peer: room.blocked_by_peer.unwrap_or(false),
            blocked_by_me: room.blocked_by_me.unwrap_or(false),
            direct_key_status: None,
            member_count: None,
        });
    }
    result.sort_by(|left, right| {
        let left_key = left
            .latest_message_created_at
            .as_deref()
            .map(store::sort_key_from_created_at)
            .unwrap_or(i64::MIN);
        let right_key = right
            .latest_message_created_at
            .as_deref()
            .map(store::sort_key_from_created_at)
            .unwrap_or(i64::MIN);
        right_key.cmp(&left_key)
    });
    Ok(result)
}

fn build_room_snapshot(
    detail: RoomDetailResponse,
    invitation: GetMyRoomInvitationResponse,
    messages: Vec<ChatMessageSnapshot>,
    direct_key_status: String,
) -> ChatRoomSnapshot {
    let member_count = detail.members.len() as i64;
    ChatRoomSnapshot {
        room_id: detail.room_id,
        room_type: detail.room_type,
        name: detail.name,
        description: detail.description,
        avatar_url: detail.avatar_url,
        blocked_by_peer: detail.blocked_by_peer.unwrap_or(false),
        blocked_by_me: detail.blocked_by_me.unwrap_or(false),
        status: detail.status.unwrap_or_else(|| "active".to_string()),
        members: detail
            .members
            .into_iter()
            .map(|member| ChatMemberSnapshot {
                member_id: member.member_id,
                participant_id: member.participant_id,
                user_id: member.user_id,
                display_name: member.display_name,
                avatar_url: member.avatar_url,
                role: member.role,
                last_read_at: member.last_read_at,
                joined_at: member.joined_at,
            })
            .collect::<Vec<_>>(),
        messages,
        has_more: detail.messages.len() >= 20,
        pending_invitation: if invitation.found {
            Some(ChatInvitationSnapshot {
                found: invitation.found,
                invitation_id: invitation.invitation_id,
                role: invitation.role,
                inviter_name: invitation.inviter_name,
                inviter_avatar: invitation.inviter_avatar,
                inviter_user_id: invitation.inviter_user_id,
            })
        } else {
            None
        },
        direct_key_status,
        member_count,
    }
}
