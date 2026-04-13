pub mod account_keys;
pub mod api;
pub mod events;
pub mod queue;
pub mod runtime;
pub mod store;
pub mod sync;
pub mod ws;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRuntimeSession {
    pub api_base_url: String,
    pub ws_base_url: String,
    pub token: String,
    pub account_id: i64,
    pub user_id: i64,
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatRoomsSections {
    pub direct: Vec<ChatRoomSummarySnapshot>,
    pub group: Vec<ChatRoomSummarySnapshot>,
    pub channel: Vec<ChatRoomSummarySnapshot>,
    pub bot: Vec<ChatRoomSummarySnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatRoomsSnapshot {
    pub participant_id: Option<i64>,
    pub rooms: ChatRoomsSections,
    pub sync_state: ChatSyncState,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatSyncState {
    pub ws_status: String,
    pub active_room_id: Option<i64>,
    pub pending_business_jobs: usize,
    pub pending_sync_jobs: usize,
    pub last_rooms_sync_at: Option<String>,
    pub last_active_room_sync_at: Option<String>,
    pub self_sender_key_sync_status: String,
    pub self_sender_key_sync_error: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatRoomSummarySnapshot {
    pub room_id: i64,
    pub room_type: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub peer_user_id: Option<i64>,
    pub presence_status: Option<String>,
    pub last_seen_at: Option<String>,
    pub status: Option<String>,
    pub latest_message: Option<String>,
    pub latest_message_created_at: Option<String>,
    pub latest_message_sender_id: Option<i64>,
    pub unread_count: i64,
    pub blocked_by_peer: bool,
    pub blocked_by_me: bool,
    pub direct_key_status: Option<String>,
    pub member_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatMemberSnapshot {
    pub member_id: i64,
    pub participant_id: i64,
    pub user_id: Option<i64>,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub role: String,
    pub last_read_at: Option<String>,
    pub joined_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatInvitationSnapshot {
    pub found: bool,
    pub invitation_id: Option<i64>,
    pub role: Option<String>,
    pub inviter_name: Option<String>,
    pub inviter_avatar: Option<String>,
    pub inviter_user_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatMessageSnapshot {
    pub client_message_id: String,
    pub message_id: Option<i64>,
    pub sender_id: i64,
    pub r#type: String,
    pub content: String,
    pub reply_to_id: Option<i64>,
    pub is_edited: bool,
    pub is_deleted: bool,
    pub created_at: String,
    pub sort_key: i64,
    pub delivery_status: String,
    pub delivery_error: Option<String>,
    pub is_local_echo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatRoomSnapshot {
    pub room_id: i64,
    pub room_type: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar_url: Option<String>,
    pub blocked_by_peer: bool,
    pub blocked_by_me: bool,
    pub status: String,
    pub members: Vec<ChatMemberSnapshot>,
    pub messages: Vec<ChatMessageSnapshot>,
    pub has_more: bool,
    pub pending_invitation: Option<ChatInvitationSnapshot>,
    pub direct_key_status: String,
    pub member_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatRoomSnapshotRequest {
    pub room_id: i64,
    pub before_sort_key: Option<i64>,
    pub limit: Option<u32>,
    pub force_refresh: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSendMessageInput {
    pub room_id: i64,
    pub content: String,
    pub r#type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRetryMessageInput {
    pub client_message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatDeliveryUpdate {
    pub room_id: i64,
    pub client_message_id: String,
    pub delivery_status: String,
    pub delivery_error: Option<String>,
    pub server_message_id: Option<i64>,
}
