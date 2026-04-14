use std::time::Duration;

use chrono::Utc;
use tokio::sync::{mpsc::unbounded_channel, watch};

use crate::chat::api::ChatApiClient;
use crate::chat::events::{emit_rooms_updated, emit_sync_state_changed};
use crate::chat::queue::RuntimeQueue;
use crate::chat::store;
use crate::chat::sync;
use crate::chat::ws::spawn_ws_loop;
use crate::chat::{
    ChatMessageSnapshot, ChatRetryMessageInput, ChatRoomSnapshot, ChatRoomSnapshotRequest,
    ChatRoomsSnapshot, ChatRuntimeSession, ChatSelfSenderKeySyncState, ChatSendMessageInput,
    ChatSyncState,
};

use super::manager::RuntimeJob;
use super::SharedRuntime;

impl SharedRuntime {
    pub async fn start(
        app: tauri::AppHandle,
        session: ChatRuntimeSession,
    ) -> Result<(Self, ChatRoomsSnapshot), String> {
        log::info!(
            "chat runtime: start requested account_id={} user_id={} device_id={}",
            session.account_id,
            session.user_id,
            session.device_id
        );
        let api = ChatApiClient::new(&session)?;
        let participant = api.ensure_participant().await?;
        log::info!(
            "chat runtime: participant ready participant_id={}",
            participant.id
        );

        let (queue, business_rx, sync_rx) = RuntimeQueue::new();
        let (stop_tx, stop_rx) = watch::channel(false);

        let runtime = Self {
            app: app.clone(),
            session,
            api,
            queue,
            stop_tx,
            active_room_id: std::sync::Arc::new(std::sync::Mutex::new(None)),
            participant_id: std::sync::Arc::new(std::sync::Mutex::new(Some(participant.id))),
            self_sender_key_sync: std::sync::Arc::new(std::sync::Mutex::new(None)),
        };

        let self_sender_key_sync = sync::refresh_self_sender_key_sync_state(
            &app,
            &runtime.session,
            &runtime.api,
            Some(participant.id),
        )
        .await?;
        runtime.set_self_sender_key_sync_snapshot(Some(self_sender_key_sync.clone()))?;
        let sections =
            sync::sync_rooms(&app, &runtime.session, &runtime.api, Some(participant.id)).await?;
        let mut sync_state = store::save_sync_state(
            &app,
            runtime.session.account_id,
            Some(participant.id),
            None,
            Some(&Utc::now().to_rfc3339()),
            None,
            None,
            None,
            None,
        )?;
        sync_state.self_sender_key_sync_status = self_sender_key_sync.status.clone();
        sync_state.self_sender_key_sync_error = self_sender_key_sync.last_error.clone();
        sync_state.self_sender_key_sync = Some(self_sender_key_sync);

        let snapshot = ChatRoomsSnapshot {
            participant_id: Some(participant.id),
            rooms: sections,
            sync_state,
        };

        runtime.spawn_workers(business_rx, sync_rx, stop_rx.clone());
        runtime.spawn_poller(stop_rx.clone());
        let (ws_event_tx, mut ws_event_rx) = unbounded_channel::<crate::chat::ws::WsEvent>();
        spawn_ws_loop(runtime.session.clone(), ws_event_tx, stop_rx);
        let queue = runtime.queue.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = ws_event_rx.recv().await {
                let _ = queue.enqueue_business(RuntimeJob::WsEvent(event));
            }
        });

        store::save_rooms_snapshot(
            &app,
            runtime.session.account_id,
            Some(participant.id),
            &snapshot.rooms,
        )?;
        let _ = emit_rooms_updated(&app, &snapshot);
        let _ = emit_sync_state_changed(&app, &snapshot.sync_state);
        log::info!(
            "chat runtime: started participant_id={} direct_rooms={} group_rooms={} channel_rooms={} bot_rooms={}",
            participant.id,
            snapshot.rooms.direct.len(),
            snapshot.rooms.group.len(),
            snapshot.rooms.channel.len(),
            snapshot.rooms.bot.len()
        );

        Ok((runtime, snapshot))
    }

    pub fn stop(&self) -> Result<(), String> {
        log::info!("chat runtime: stop requested");
        self.stop_tx
            .send(true)
            .map_err(|_| "send chat runtime stop signal failed".to_string())
    }

    pub fn participant_id(&self) -> Option<i64> {
        self.participant_id.lock().ok().and_then(|guard| *guard)
    }

    pub fn active_room_id(&self) -> Option<i64> {
        self.active_room_id.lock().ok().and_then(|guard| *guard)
    }

    pub fn set_active_room_id(&self, room_id: Option<i64>) -> Result<(), String> {
        log::info!("chat runtime: set active room room_id={room_id:?}");
        let mut guard = self
            .active_room_id
            .lock()
            .map_err(|_| "lock active room id failed".to_string())?;
        *guard = room_id;
        drop(guard);

        store::save_sync_state(
            &self.app,
            self.session.account_id,
            self.participant_id(),
            room_id,
            None,
            None,
            None,
            None,
            None,
        )?;
        self.emit_sync_state_best_effort("set_active_room");

        if let Some(room_id) = room_id {
            let _ = self.queue.enqueue_sync(
                format!("room:{room_id}"),
                RuntimeJob::SyncRoom {
                    key: format!("room:{room_id}"),
                    room_id,
                    before_sort_key: None,
                    limit: None,
                    emit_room: true,
                },
            )?;
        }
        Ok(())
    }

    pub fn enqueue_send_message(
        &self,
        input: ChatSendMessageInput,
    ) -> Result<ChatMessageSnapshot, String> {
        log::info!(
            "chat runtime: enqueue send message room_id={}",
            input.room_id
        );
        let room = self.ensure_local_room(input.room_id)?;
        let current_member_id =
            sync::resolve_current_member_id_snapshot(self.participant_id(), &room.members)
                .ok_or_else(|| format!("no current member mapping for room {}", input.room_id))?;
        let client_message_id =
            format!("local:{}:{}", input.room_id, Utc::now().timestamp_millis());
        let created_at = Utc::now().to_rfc3339();
        let pending = ChatMessageSnapshot {
            client_message_id: client_message_id.clone(),
            message_id: None,
            sender_id: current_member_id,
            sender_device_id: self.session.device_id.clone(),
            sender_key_version: 0,
            r#type: input.r#type.clone().unwrap_or_else(|| "text".to_string()),
            content: input.content.clone(),
            reply_to_id: None,
            is_edited: false,
            is_deleted: false,
            created_at: created_at.clone(),
            sort_key: store::sort_key_from_created_at(&created_at),
            delivery_status: "pending".to_string(),
            delivery_error: None,
            is_local_echo: true,
        };

        store::save_or_update_message(&self.app, self.session.account_id, input.room_id, &pending)?;
        self.queue.enqueue_business(RuntimeJob::SendMessage {
            room_id: input.room_id,
            client_message_id,
            content: input.content,
            message_type: pending.r#type.clone(),
        })?;
        self.emit_rooms_snapshot_best_effort("enqueue_send_message");
        if self.active_room_id() == Some(input.room_id) {
            self.emit_room_snapshot_best_effort(input.room_id, "enqueue_send_message");
        }

        Ok(pending)
    }

    pub fn enqueue_retry_message(
        &self,
        input: ChatRetryMessageInput,
    ) -> Result<Option<ChatMessageSnapshot>, String> {
        log::info!(
            "chat runtime: enqueue retry message client_message_id={}",
            input.client_message_id
        );
        let Some(retry) = store::load_retry_message(
            &self.app,
            self.session.account_id,
            &input.client_message_id,
        )?
        else {
            return Ok(None);
        };

        store::update_message_delivery(
            &self.app,
            self.session.account_id,
            retry.room_id,
            &retry.message.client_message_id,
            "pending",
            None,
            retry.message.message_id,
            Some(&retry.message.created_at),
        )?;
        let update = crate::chat::ChatDeliveryUpdate {
            room_id: retry.room_id,
            client_message_id: retry.message.client_message_id.clone(),
            delivery_status: "pending".to_string(),
            delivery_error: None,
            server_message_id: retry.message.message_id,
        };
        let _ = crate::chat::events::emit_message_delivery_updated(&self.app, &update);

        self.queue.enqueue_business(RuntimeJob::RetryMessage {
            room_id: retry.room_id,
            client_message_id: retry.message.client_message_id.clone(),
            content: retry.message.content.clone(),
            message_type: retry.message.r#type.clone(),
        })?;

        Ok(Some(ChatMessageSnapshot {
            delivery_status: "pending".to_string(),
            delivery_error: None,
            ..retry.message
        }))
    }

    pub fn enqueue_mark_room_read(&self, room_id: i64) -> Result<(), String> {
        log::info!("chat runtime: enqueue mark room read room_id={room_id}");
        store::update_room_unread(&self.app, self.session.account_id, room_id, 0)?;
        self.queue
            .enqueue_business(RuntimeJob::MarkRoomRead { room_id })?;
        self.emit_rooms_snapshot_best_effort("enqueue_mark_room_read");
        Ok(())
    }

    pub async fn force_sync_rooms(&self) -> Result<ChatRoomsSnapshot, String> {
        log::info!("chat runtime: force sync rooms");
        let sections =
            sync::sync_rooms(&self.app, &self.session, &self.api, self.participant_id()).await?;
        let sync_state = store::save_sync_state(
            &self.app,
            self.session.account_id,
            self.participant_id(),
            self.active_room_id(),
            Some(&Utc::now().to_rfc3339()),
            None,
            None,
            None,
            None,
        )?;
        let mut sync_state = sync_state;
        self.attach_self_sender_key_sync_snapshot(&mut sync_state)?;
        let snapshot = ChatRoomsSnapshot {
            participant_id: self.participant_id(),
            rooms: sections,
            sync_state,
        };
        self.emit_rooms_snapshot_payload_best_effort(&snapshot, "force_sync_rooms");
        self.emit_sync_state_payload_best_effort(&snapshot.sync_state, "force_sync_rooms");
        Ok(snapshot)
    }

    pub async fn refresh_self_sender_key_sync(&self) -> Result<ChatSelfSenderKeySyncState, String> {
        log::info!("chat runtime: refresh self sender key sync state");
        let snapshot = sync::refresh_self_sender_key_sync_state(
            &self.app,
            &self.session,
            &self.api,
            self.participant_id(),
        )
        .await?;
        self.set_self_sender_key_sync_snapshot(Some(snapshot.clone()))?;
        self.emit_sync_state_best_effort("refresh_self_sender_key_sync");
        self.emit_rooms_snapshot_best_effort("refresh_self_sender_key_sync");
        if let Some(room_id) = self.active_room_id() {
            self.emit_room_snapshot_best_effort(room_id, "refresh_self_sender_key_sync");
        }
        Ok(snapshot)
    }

    pub async fn force_sync_room(
        &self,
        request: &ChatRoomSnapshotRequest,
    ) -> Result<Option<ChatRoomSnapshot>, String> {
        log::info!(
            "chat runtime: force sync room room_id={} before_sort_key={:?} limit={:?}",
            request.room_id,
            request.before_sort_key,
            request.limit
        );
        let result = sync::sync_room(
            &self.app,
            &self.session,
            &self.api,
            self.participant_id(),
            request.room_id,
            request.before_sort_key,
            request.limit,
        )
        .await?;

        store::save_sync_state(
            &self.app,
            self.session.account_id,
            self.participant_id(),
            self.active_room_id(),
            None,
            Some(&Utc::now().to_rfc3339()),
            None,
            None,
            None,
        )?;
        self.emit_room_snapshot_best_effort(result.snapshot.room_id, "force_sync_room");
        self.emit_rooms_snapshot_best_effort("force_sync_room");

        Ok(Some(result.snapshot))
    }

    pub fn local_rooms_snapshot(&self) -> Result<ChatRoomsSnapshot, String> {
        let mut snapshot = store::load_rooms_snapshot(&self.app, self.session.account_id)?;
        snapshot.sync_state.pending_sync_jobs = self.queue.pending_sync_jobs();
        self.attach_self_sender_key_sync_snapshot(&mut snapshot.sync_state)?;
        Ok(snapshot)
    }

    pub fn local_room_snapshot(
        &self,
        request: &ChatRoomSnapshotRequest,
    ) -> Result<Option<ChatRoomSnapshot>, String> {
        store::load_room_snapshot(
            &self.app,
            self.session.account_id,
            request.room_id,
            request.before_sort_key,
            request.limit,
        )
    }

    pub(super) fn ensure_local_room(&self, room_id: i64) -> Result<ChatRoomSnapshot, String> {
        store::load_room_snapshot(&self.app, self.session.account_id, room_id, None, None)?
            .ok_or_else(|| format!("room {room_id} is not available locally"))
    }

    fn spawn_workers(
        &self,
        mut business_rx: tokio::sync::mpsc::UnboundedReceiver<RuntimeJob>,
        mut sync_rx: tokio::sync::mpsc::UnboundedReceiver<RuntimeJob>,
        mut stop_rx: watch::Receiver<bool>,
    ) {
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                if *stop_rx.borrow() {
                    break;
                }

                if let Ok(job) = business_rx.try_recv() {
                    runtime.process_job(job).await;
                    continue;
                }

                tokio::select! {
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            break;
                        }
                    }
                    business = business_rx.recv() => {
                        if let Some(job) = business {
                            runtime.process_job(job).await;
                        } else {
                            break;
                        }
                    }
                    sync = sync_rx.recv() => {
                        if let Some(job) = sync {
                            runtime.process_job(job).await;
                        } else {
                            break;
                        }
                    }
                }
            }
        });
    }

    fn spawn_poller(&self, mut stop_rx: watch::Receiver<bool>) {
        let queue = self.queue.clone();
        let active_room_id = self.active_room_id.clone();
        tauri::async_runtime::spawn(async move {
            let mut rooms_interval = tokio::time::interval(Duration::from_secs(20));
            let mut room_interval = tokio::time::interval(Duration::from_secs(8));
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            break;
                        }
                    }
                    _ = rooms_interval.tick() => {
                        let _ = queue.enqueue_sync(
                            "rooms:poll".to_string(),
                            RuntimeJob::SyncRooms { key: "rooms:poll".to_string() },
                        );
                    }
                    _ = room_interval.tick() => {
                        if let Ok(guard) = active_room_id.lock() {
                            if let Some(room_id) = *guard {
                                let _ = queue.enqueue_sync(
                                    format!("room:poll:{room_id}"),
                                    RuntimeJob::SyncRoom {
                                        key: format!("room:poll:{room_id}"),
                                        room_id,
                                        before_sort_key: None,
                                        limit: None,
                                        emit_room: true,
                                    },
                                );
                            }
                        }
                    }
                }
            }
        });
    }

    pub(super) fn set_self_sender_key_sync_snapshot(
        &self,
        snapshot: Option<ChatSelfSenderKeySyncState>,
    ) -> Result<(), String> {
        let mut guard = self
            .self_sender_key_sync
            .lock()
            .map_err(|_| "lock self sender key sync snapshot failed".to_string())?;
        *guard = snapshot;
        Ok(())
    }

    fn current_self_sender_key_sync_snapshot(
        &self,
    ) -> Result<Option<ChatSelfSenderKeySyncState>, String> {
        let guard = self
            .self_sender_key_sync
            .lock()
            .map_err(|_| "lock current self sender key sync snapshot failed".to_string())?;
        Ok(guard.clone())
    }

    fn attach_self_sender_key_sync_snapshot(
        &self,
        sync_state: &mut ChatSyncState,
    ) -> Result<(), String> {
        let snapshot = self.current_self_sender_key_sync_snapshot()?;
        apply_self_sender_key_sync_snapshot(sync_state, snapshot.as_ref());
        Ok(())
    }
}

fn apply_self_sender_key_sync_snapshot(
    sync_state: &mut ChatSyncState,
    snapshot: Option<&ChatSelfSenderKeySyncState>,
) {
    match snapshot {
        Some(snapshot) => {
            sync_state.self_sender_key_sync_status = snapshot.status.clone();
            sync_state.self_sender_key_sync_error = snapshot.last_error.clone();
            sync_state.self_sender_key_sync = Some(snapshot.clone());
        }
        None => {
            sync_state.self_sender_key_sync = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::apply_self_sender_key_sync_snapshot;
    use crate::chat::{ChatSelfSenderKeySyncDevice, ChatSelfSenderKeySyncState, ChatSyncState};

    #[test]
    fn apply_self_sender_key_sync_snapshot_keeps_structured_snapshot_on_runtime_sync_state() {
        let mut sync_state = ChatSyncState {
            ws_status: "connected".to_string(),
            self_sender_key_sync_status: "idle".to_string(),
            ..Default::default()
        };
        let snapshot = ChatSelfSenderKeySyncState {
            exists: true,
            status: "pending_provider".to_string(),
            requester_device: Some(ChatSelfSenderKeySyncDevice {
                device_id: "device-new".to_string(),
                device_name: "New Mac".to_string(),
                platform: "macos".to_string(),
                last_ip: Some("127.0.0.1".to_string()),
                binding_status: Some("pending_sync".to_string()),
            }),
            requester_current_device: true,
            ..Default::default()
        };

        apply_self_sender_key_sync_snapshot(&mut sync_state, Some(&snapshot));

        assert_eq!(sync_state.self_sender_key_sync_status, "pending_provider");
        assert_eq!(
            sync_state
                .self_sender_key_sync
                .as_ref()
                .and_then(|value| value.requester_device.as_ref())
                .map(|value| value.device_id.as_str()),
            Some("device-new")
        );
        assert_eq!(
            sync_state
                .self_sender_key_sync
                .as_ref()
                .map(|value| value.requester_current_device),
            Some(true)
        );
    }
}
