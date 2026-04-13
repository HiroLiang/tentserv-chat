use tauri::{AppHandle, Emitter};

use crate::chat::{ChatDeliveryUpdate, ChatRoomSnapshot, ChatRoomsSnapshot, ChatSyncState};

pub const ROOMS_UPDATED_EVENT: &str = "chat:rooms_updated";
pub const ROOM_UPDATED_EVENT: &str = "chat:room_updated";
pub const MESSAGE_DELIVERY_UPDATED_EVENT: &str = "chat:message_delivery_updated";
pub const SYNC_STATE_CHANGED_EVENT: &str = "chat:sync_state_changed";

pub fn emit_rooms_updated(app: &AppHandle, snapshot: &ChatRoomsSnapshot) -> Result<(), String> {
    app.emit(ROOMS_UPDATED_EVENT, snapshot)
        .map_err(|err| format!("emit {ROOMS_UPDATED_EVENT} failed: {err}"))
}

pub fn emit_room_updated(app: &AppHandle, snapshot: &ChatRoomSnapshot) -> Result<(), String> {
    app.emit(ROOM_UPDATED_EVENT, snapshot)
        .map_err(|err| format!("emit {ROOM_UPDATED_EVENT} failed: {err}"))
}

pub fn emit_message_delivery_updated(
    app: &AppHandle,
    update: &ChatDeliveryUpdate,
) -> Result<(), String> {
    app.emit(MESSAGE_DELIVERY_UPDATED_EVENT, update)
        .map_err(|err| format!("emit {MESSAGE_DELIVERY_UPDATED_EVENT} failed: {err}"))
}

pub fn emit_sync_state_changed(app: &AppHandle, snapshot: &ChatSyncState) -> Result<(), String> {
    app.emit(SYNC_STATE_CHANGED_EVENT, snapshot)
        .map_err(|err| format!("emit {SYNC_STATE_CHANGED_EVENT} failed: {err}"))
}
