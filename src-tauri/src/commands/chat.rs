use tauri::State;

use crate::chat::runtime::{ChatRuntimeManager, SharedRuntime};
use crate::chat::{
    ChatMessageSnapshot, ChatRetryMessageInput, ChatRoomSnapshot, ChatRoomSnapshotRequest,
    ChatRoomsSnapshot, ChatRuntimeSession, ChatSendMessageInput,
};

#[tauri::command]
pub async fn chat_runtime_start(
    app: tauri::AppHandle,
    manager: State<'_, ChatRuntimeManager>,
    session: ChatRuntimeSession,
) -> Result<ChatRoomsSnapshot, String> {
    let (runtime, snapshot) = SharedRuntime::start(app, session).await?;
    manager.replace(runtime)?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn chat_runtime_stop(manager: State<'_, ChatRuntimeManager>) -> Result<(), String> {
    manager.clear()
}

#[tauri::command]
pub async fn chat_set_active_room(
    manager: State<'_, ChatRuntimeManager>,
    room_id: Option<i64>,
) -> Result<(), String> {
    let runtime = manager.current()?;
    runtime.set_active_room_id(room_id)
}

#[tauri::command]
pub async fn chat_get_rooms_snapshot(
    manager: State<'_, ChatRuntimeManager>,
    force_refresh: Option<bool>,
) -> Result<ChatRoomsSnapshot, String> {
    let runtime = manager.current()?;
    if force_refresh.unwrap_or(false) {
        runtime.force_sync_rooms().await
    } else {
        runtime.local_rooms_snapshot()
    }
}

#[tauri::command]
pub async fn chat_get_room_snapshot(
    manager: State<'_, ChatRuntimeManager>,
    request: ChatRoomSnapshotRequest,
) -> Result<Option<ChatRoomSnapshot>, String> {
    let runtime = manager.current()?;
    if request.force_refresh.unwrap_or(false) {
        runtime.force_sync_room(&request).await
    } else {
        runtime.local_room_snapshot(&request)
    }
}

#[tauri::command]
pub async fn chat_send_message(
    manager: State<'_, ChatRuntimeManager>,
    input: ChatSendMessageInput,
) -> Result<ChatMessageSnapshot, String> {
    let runtime = manager.current()?;
    runtime.enqueue_send_message(input)
}

#[tauri::command]
pub async fn chat_retry_message(
    manager: State<'_, ChatRuntimeManager>,
    input: ChatRetryMessageInput,
) -> Result<Option<ChatMessageSnapshot>, String> {
    let runtime = manager.current()?;
    runtime.enqueue_retry_message(input)
}

#[tauri::command]
pub async fn chat_mark_room_read(
    manager: State<'_, ChatRuntimeManager>,
    room_id: i64,
) -> Result<(), String> {
    let runtime = manager.current()?;
    runtime.enqueue_mark_room_read(room_id)
}
