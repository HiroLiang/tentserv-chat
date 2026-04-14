use std::sync::{Arc, Mutex};

use tokio::sync::watch;

use crate::chat::api::ChatApiClient;
use crate::chat::queue::RuntimeQueue;
use crate::chat::ws::WsEvent;
use crate::chat::{ChatRuntimeSession, ChatSelfSenderKeySyncState};

#[derive(Default)]
pub struct ChatRuntimeManager {
    inner: Mutex<Option<SharedRuntime>>,
}

impl ChatRuntimeManager {
    pub fn replace(&self, runtime: SharedRuntime) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "lock chat runtime manager for replace failed".to_string())?;
        if let Some(existing) = inner.take() {
            existing.stop()?;
        }
        *inner = Some(runtime);
        Ok(())
    }

    pub fn current(&self) -> Result<SharedRuntime, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "lock chat runtime manager failed".to_string())?;
        inner
            .clone()
            .ok_or_else(|| "chat runtime is not started".to_string())
    }

    pub fn clear(&self) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "lock chat runtime manager for clear failed".to_string())?;
        if let Some(existing) = inner.take() {
            existing.stop()?;
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct SharedRuntime {
    pub(super) app: tauri::AppHandle,
    pub(super) session: ChatRuntimeSession,
    pub(super) api: ChatApiClient,
    pub(super) queue: RuntimeQueue<RuntimeJob>,
    pub(super) stop_tx: watch::Sender<bool>,
    pub(super) active_room_id: Arc<Mutex<Option<i64>>>,
    pub(super) participant_id: Arc<Mutex<Option<i64>>>,
    pub(super) self_sender_key_sync: Arc<Mutex<Option<ChatSelfSenderKeySyncState>>>,
}

#[derive(Debug, Clone)]
pub(super) enum RuntimeJob {
    SyncRooms {
        key: String,
    },
    SyncRoom {
        key: String,
        room_id: i64,
        before_sort_key: Option<i64>,
        limit: Option<u32>,
        emit_room: bool,
    },
    SendMessage {
        room_id: i64,
        client_message_id: String,
        content: String,
        message_type: String,
    },
    RetryMessage {
        room_id: i64,
        client_message_id: String,
        content: String,
        message_type: String,
    },
    MarkRoomRead {
        room_id: i64,
    },
    WsEvent(WsEvent),
}
