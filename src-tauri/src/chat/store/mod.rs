mod messages;
mod models;
mod rooms;
mod sync_state;

pub use messages::{
    link_encrypted_message_server_id, load_retry_message, load_room_message_by_server_message_id, save_encrypted_message,
    save_or_update_message, sort_key_from_created_at, update_message_delivery,
};
pub use models::EncryptedChatMessageRecord;
pub use rooms::{
    load_room_snapshot, load_rooms_snapshot, save_room_snapshot, save_rooms_snapshot,
    update_direct_key_status, update_room_member_reads, update_room_presence, update_room_unread,
};
pub use sync_state::{save_sync_state, update_ws_status};

#[cfg(test)]
#[path = "tests/store_tests.rs"]
mod tests;
