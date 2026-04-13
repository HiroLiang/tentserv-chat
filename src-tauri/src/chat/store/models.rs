use crate::chat::ChatMessageSnapshot;

pub(super) const DEFAULT_PAGE_LIMIT: u32 = 30;

#[derive(Debug, Clone)]
pub struct EncryptedChatMessageRecord {
    pub account_id: i64,
    pub room_id: i64,
    pub client_message_id: String,
    pub server_message_id: Option<i64>,
    pub sender_id: i64,
    pub encrypted_content: Vec<u8>,
    pub message_type: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct RetryChatMessageRecord {
    pub room_id: i64,
    pub message: ChatMessageSnapshot,
}
