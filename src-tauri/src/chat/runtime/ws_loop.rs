use crate::chat::store;
use crate::chat::sync;
use crate::chat::ws::WsEvent;

use super::manager::RuntimeJob;
use super::SharedRuntime;

impl SharedRuntime {
    pub(super) async fn process_ws_event(&self, event: WsEvent) {
        match event {
            WsEvent::StatusChanged { status, error } => {
                match error.as_deref() {
                    Some(error) => {
                        log::warn!("chat runtime ws status: status={} error={}", status, error)
                    }
                    None => log::info!("chat runtime ws status: status={}", status),
                }
                let _ = store::update_ws_status(
                    &self.app,
                    self.session.account_id,
                    &status,
                    error.as_deref(),
                );
                let _ = self.emit_sync_state();
            }
            WsEvent::ChatMessage(payload) => {
                log::info!(
                    "chat runtime ws event: chat.message room_id={} message_id={}",
                    payload.room_id,
                    payload.message_id
                );
                let room_id = payload.room_id;
                if let Err(error) = sync::handle_incoming_chat_message(
                    &self.app,
                    &self.session,
                    &self.api,
                    self.participant_id(),
                    self.active_room_id(),
                    payload,
                )
                .await
                {
                    log::warn!(
                        "chat runtime ws event: failed to process incoming chat message: {}",
                        error
                    );
                }
                let _ = self.emit_rooms_snapshot();
                if self.active_room_id() == Some(room_id) {
                    let _ = self.emit_room_snapshot(room_id);
                }
            }
            WsEvent::PresenceChanged(payload) => {
                log::info!(
                    "chat runtime ws event: presence.user_status_changed user_id={} status={}",
                    payload.user_id,
                    payload.status
                );
                if let Err(error) =
                    sync::handle_presence_changed(&self.app, &self.session, payload).await
                {
                    log::warn!(
                        "chat runtime ws event: failed to process presence update: {}",
                        error
                    );
                }
                let _ = self.emit_rooms_snapshot();
            }
            WsEvent::SenderKeyNeeded(payload) => {
                log::info!(
                    "chat runtime ws event: sender_key_needed room_id={} provider_member_id={} requester_member_id={} requester_device_id={:?}",
                    payload.room_id,
                    payload.provider_member_id,
                    payload.requester_member_id,
                    payload.requester_device_id
                );
                if let Err(error) = sync::handle_sender_key_needed(
                    &self.app,
                    &self.session,
                    &self.api,
                    payload,
                    self.participant_id(),
                )
                .await
                {
                    log::warn!(
                        "chat runtime ws event: failed to handle sender_key_needed: {}",
                        error
                    );
                }
                let _ = self.emit_rooms_snapshot();
                if let Some(room_id) = self.active_room_id() {
                    let _ = self.emit_room_snapshot(room_id);
                }
            }
            WsEvent::SenderKeyDistributionAvailable { room_id } => {
                log::info!(
                    "chat runtime ws event: sender_key_distribution_available room_id={room_id}"
                );
                match sync::handle_sender_key_distribution_available(
                    &self.app,
                    &self.session,
                    &self.api,
                    room_id,
                )
                .await
                {
                    Ok(_) => {}
                    Err(error) => {
                        log::warn!(
                            "chat runtime ws event: failed to resolve sender key availability: {}",
                            error
                        );
                    }
                }
                let _ = self.emit_rooms_snapshot();
                if self.active_room_id() == Some(room_id) {
                    let _ = self.emit_room_snapshot(room_id);
                }
            }
            WsEvent::SelfSenderKeySyncStateChanged(payload) => {
                log::info!(
                    "chat runtime ws event: self_sender_key_sync_state_changed status={} requester_current_device={} provider_current_device={}",
                    payload.status,
                    payload.requester_current_device,
                    payload.provider_current_device
                );
                match sync::handle_self_sender_key_sync_state_changed(
                    &self.app,
                    &self.session,
                    &self.api,
                    self.participant_id(),
                    payload,
                )
                .await
                {
                    Ok(snapshot) => {
                        if let Err(error) = self.set_self_sender_key_sync_snapshot(Some(snapshot)) {
                            log::warn!(
                                "chat runtime ws event: failed to persist self sender key sync snapshot in runtime memory: {}",
                                error
                            );
                        }
                    }
                    Err(error) => {
                        log::warn!(
                            "chat runtime ws event: failed to handle self sender key sync state change: {}",
                            error
                        );
                    }
                }
                let _ = self.emit_rooms_snapshot();
                if let Some(room_id) = self.active_room_id() {
                    let _ = self.emit_room_snapshot(room_id);
                }
            }
            WsEvent::ReplenishOtp => {
                log::info!("chat runtime ws event: replenish otp requested");
                if let Err(error) =
                    sync::replenish_otp_if_needed(&self.app, &self.session, &self.api).await
                {
                    log::warn!(
                        "chat runtime ws event: failed to replenish otp keys: {}",
                        error
                    );
                }
            }
            WsEvent::MemberJoined { room_id } => {
                log::info!("chat runtime ws event: member joined room_id={room_id}");
                let _ = self.queue.enqueue_sync(
                    format!("room:member-joined:{room_id}"),
                    RuntimeJob::SyncRoom {
                        key: format!("room:member-joined:{room_id}"),
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
