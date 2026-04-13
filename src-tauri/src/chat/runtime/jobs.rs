use crate::chat::events::emit_message_delivery_updated;
use crate::chat::store;
use crate::chat::sync;
use crate::chat::{ChatDeliveryUpdate, ChatRoomSnapshotRequest};

use super::manager::RuntimeJob;
use super::SharedRuntime;

impl SharedRuntime {
    pub(super) async fn process_job(&self, job: RuntimeJob) {
        match job {
            RuntimeJob::SyncRooms { key } => {
                let _ = self.force_sync_rooms().await;
                self.queue.finish_sync(&key);
            }
            RuntimeJob::SyncRoom {
                key,
                room_id,
                before_sort_key,
                limit,
                emit_room,
            } => {
                let request = ChatRoomSnapshotRequest {
                    room_id,
                    before_sort_key,
                    limit,
                    force_refresh: Some(true),
                };
                let result = self.force_sync_room(&request).await;
                if emit_room {
                    let _ = result;
                }
                self.queue.finish_sync(&key);
            }
            RuntimeJob::SendMessage {
                room_id,
                client_message_id,
                content,
                message_type,
            }
            | RuntimeJob::RetryMessage {
                room_id,
                client_message_id,
                content,
                message_type,
            } => {
                self.process_send_message(room_id, client_message_id, content, message_type)
                    .await;
            }
            RuntimeJob::MarkRoomRead { room_id } => {
                let _ = sync::mark_room_read(&self.app, &self.session, &self.api, room_id).await;
                let _ = self.emit_rooms_snapshot();
                if self.active_room_id() == Some(room_id) {
                    let _ = self.emit_room_snapshot(room_id);
                }
            }
            RuntimeJob::WsEvent(event) => {
                self.process_ws_event(event).await;
            }
        }
    }

    pub(super) async fn process_send_message(
        &self,
        room_id: i64,
        client_message_id: String,
        content: String,
        message_type: String,
    ) {
        log::info!(
            "chat runtime: process send message room_id={} client_message_id={}",
            room_id,
            client_message_id
        );
        let pending = match store::load_retry_message(&self.app, self.session.account_id, &client_message_id) {
            Ok(Some(pending)) => pending,
            Ok(None) => {
                let err = format!("pending message {client_message_id} not found for room {room_id}");
                log::warn!("chat runtime: send message preflight failed error={}", err);
                let _ = store::update_message_delivery(
                    &self.app,
                    self.session.account_id,
                    room_id,
                    &client_message_id,
                    "failed",
                    Some(&err),
                    None,
                    None,
                );
                let _ = emit_message_delivery_updated(
                    &self.app,
                    &ChatDeliveryUpdate {
                        room_id,
                        client_message_id,
                        delivery_status: "failed".to_string(),
                        delivery_error: Some(err),
                        server_message_id: None,
                    },
                );
                return;
            }
            Err(err) => {
                log::warn!(
                    "chat runtime: send message preflight failed room_id={} client_message_id={} error={}",
                    room_id,
                    client_message_id,
                    err
                );
                let _ = store::update_message_delivery(
                    &self.app,
                    self.session.account_id,
                    room_id,
                    &client_message_id,
                    "failed",
                    Some(&err),
                    None,
                    None,
                );
                let _ = emit_message_delivery_updated(
                    &self.app,
                    &ChatDeliveryUpdate {
                        room_id,
                        client_message_id,
                        delivery_status: "failed".to_string(),
                        delivery_error: Some(err),
                        server_message_id: None,
                    },
                );
                return;
            }
        };
        let current_member_id = match self.ensure_local_room(room_id).and_then(|room| {
            sync::resolve_current_member_id_snapshot(self.participant_id(), &room.members)
                .ok_or_else(|| format!("no current member mapping for room {room_id}"))
        }) {
            Ok(current_member_id) => current_member_id,
            Err(err) => {
                log::warn!(
                    "chat runtime: send message preflight failed room_id={} client_message_id={} error={}",
                    room_id,
                    client_message_id,
                    err
                );
                let _ = store::update_message_delivery(
                    &self.app,
                    self.session.account_id,
                    room_id,
                    &client_message_id,
                    "failed",
                    Some(&err),
                    None,
                    None,
                );
                let _ = emit_message_delivery_updated(
                    &self.app,
                    &ChatDeliveryUpdate {
                        room_id,
                        client_message_id,
                        delivery_status: "failed".to_string(),
                        delivery_error: Some(err),
                        server_message_id: None,
                    },
                );
                return;
            }
        };

        match sync::send_message(
            &self.app,
            &self.session,
            &self.api,
            room_id,
            &client_message_id,
            current_member_id,
            &pending.message.created_at,
            &content,
            &message_type,
        )
        .await
        {
            Ok((server_message_id, created_at)) => {
                log::info!(
                    "chat runtime: send message succeeded room_id={} client_message_id={} server_message_id={}",
                    room_id,
                    client_message_id,
                    server_message_id
                );
                let _ = store::update_message_delivery(
                    &self.app,
                    self.session.account_id,
                    room_id,
                    &client_message_id,
                    "sent",
                    None,
                    Some(server_message_id),
                    Some(&created_at),
                );
                let _ = store::link_encrypted_message_server_id(
                    &self.app,
                    self.session.account_id,
                    room_id,
                    &client_message_id,
                    server_message_id,
                );
                let _ = emit_message_delivery_updated(
                    &self.app,
                    &ChatDeliveryUpdate {
                        room_id,
                        client_message_id,
                        delivery_status: "sent".to_string(),
                        delivery_error: None,
                        server_message_id: Some(server_message_id),
                    },
                );
                let _ = self.emit_rooms_snapshot();
                if self.active_room_id() == Some(room_id) {
                    let _ = self.emit_room_snapshot(room_id);
                }
            }
            Err(err) => {
                log::warn!(
                    "chat runtime: send message failed room_id={} client_message_id={} error={}",
                    room_id,
                    client_message_id,
                    err
                );
                let _ = store::update_message_delivery(
                    &self.app,
                    self.session.account_id,
                    room_id,
                    &client_message_id,
                    "failed",
                    Some(&err),
                    None,
                    None,
                );
                let _ = emit_message_delivery_updated(
                    &self.app,
                    &ChatDeliveryUpdate {
                        room_id,
                        client_message_id,
                        delivery_status: "failed".to_string(),
                        delivery_error: Some(err),
                        server_message_id: None,
                    },
                );
                let _ = self.emit_rooms_snapshot();
                if self.active_room_id() == Some(room_id) {
                    let _ = self.emit_room_snapshot(room_id);
                }
            }
        }
    }
}
