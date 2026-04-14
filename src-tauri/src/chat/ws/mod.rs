use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::{mpsc::UnboundedSender, watch};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

use crate::chat::ChatRuntimeSession;
use crate::chat::ChatSelfSenderKeySyncState;

#[derive(Debug, Clone)]
pub enum WsEvent {
    StatusChanged {
        status: String,
        error: Option<String>,
    },
    ChatMessage(IncomingChatMessagePayload),
    PresenceChanged(PresenceUserStatusChangedPayload),
    SenderKeyNeeded(SenderKeyNeededPayload),
    SenderKeyDistributionAvailable {
        room_id: i64,
    },
    SelfSenderKeySyncStateChanged(ChatSelfSenderKeySyncState),
    ReplenishOtp,
    MemberJoined {
        room_id: i64,
    },
}

#[derive(Debug, Clone, Deserialize)]
pub struct IncomingChatMessagePayload {
    pub message_id: i64,
    pub room_id: i64,
    pub sender_id: i64,
    pub sender_device_id: String,
    pub sender_key_version: i64,
    pub content: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub reply_to_id: Option<i64>,
    pub is_edited: bool,
    #[serde(default)]
    pub is_deleted: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PresenceUserStatusChangedPayload {
    pub user_id: i64,
    pub status: String,
    pub last_seen_at: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct SenderKeyNeededPayload {
    pub room_id: i64,
    pub provider_member_id: i64,
    pub provider_device_id: String,
    pub requester_member_id: i64,
    pub requester_user_id: i64,
    pub requester_device_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IncomingEnvelope {
    #[serde(rename = "type")]
    message_type: String,
    payload: Value,
    delivery_id: Option<i64>,
}

pub fn spawn_ws_loop(
    session: ChatRuntimeSession,
    event_tx: UnboundedSender<WsEvent>,
    mut stop_rx: watch::Receiver<bool>,
) {
    tauri::async_runtime::spawn(async move {
        let mut reconnect_delay = Duration::from_secs(3);

        loop {
            if *stop_rx.borrow() {
                break;
            }

            let mut url = match Url::parse(&session.ws_base_url) {
                Ok(url) => url,
                Err(err) => {
                    let error = format!("invalid websocket base url: {err}");
                    log::error!("chat runtime ws: {error}");
                    let _ = event_tx.send(WsEvent::StatusChanged {
                        status: "reconnecting".to_string(),
                        error: Some(error),
                    });
                    return;
                }
            };
            url.query_pairs_mut()
                .append_pair("token", &session.token)
                .append_pair("device_id", &session.device_id);
            let url = url.to_string();
            log::info!(
                "chat runtime ws: connect attempt url={}",
                session.ws_base_url
            );
            let _ = event_tx.send(WsEvent::StatusChanged {
                status: "connecting".to_string(),
                error: None,
            });

            match connect_async(&url).await {
                Ok((stream, _)) => {
                    log::info!("chat runtime ws: connected");
                    let _ = event_tx.send(WsEvent::StatusChanged {
                        status: "connected".to_string(),
                        error: None,
                    });
                    reconnect_delay = Duration::from_secs(3);

                    let (mut writer, mut reader) = stream.split();
                    loop {
                        tokio::select! {
                            changed = stop_rx.changed() => {
                                if changed.is_ok() && *stop_rx.borrow() {
                                    let _ = writer.close().await;
                                    return;
                                }
                            }
                            next = reader.next() => {
                                match next {
                                    Some(Ok(Message::Text(text))) => {
                                        if let Ok(envelope) = serde_json::from_str::<IncomingEnvelope>(&text) {
                                            if let Some(delivery_id) = envelope.delivery_id {
                                                let ack = json!({
                                                    "type": "system.ack",
                                                    "payload": { "delivery_id": delivery_id },
                                                    "timestamp": chrono::Utc::now().timestamp_millis(),
                                                });
                                                let _ = writer.send(Message::Text(ack.to_string())).await;
                                            }
                                            if envelope.message_type == "pong" {
                                                continue;
                                            }
                                            handle_incoming_envelope(&event_tx, envelope);
                                        }
                                    }
                                    Some(Ok(Message::Ping(payload))) => {
                                        let _ = writer.send(Message::Pong(payload)).await;
                                    }
                                    Some(Ok(Message::Close(_))) => break,
                                    Some(Err(err)) => {
                                        log::warn!("chat runtime ws: read error: {err}");
                                        let _ = event_tx.send(WsEvent::StatusChanged {
                                            status: "reconnecting".to_string(),
                                            error: Some(format!("websocket read error: {err}")),
                                        });
                                        break;
                                    }
                                    Some(_) => {}
                                    None => break,
                                }
                            }
                        }
                    }
                }
                Err(err) => {
                    log::warn!("chat runtime ws: connect failed: {err}");
                    let _ = event_tx.send(WsEvent::StatusChanged {
                        status: "reconnecting".to_string(),
                        error: Some(format!("websocket connect failed: {err}")),
                    });
                }
            }

            tokio::select! {
                changed = stop_rx.changed() => {
                    if changed.is_ok() && *stop_rx.borrow() {
                        break;
                    }
                }
                _ = tokio::time::sleep(reconnect_delay) => {}
            }
            reconnect_delay = std::cmp::min(reconnect_delay * 2, Duration::from_secs(30));
        }

        let _ = event_tx.send(WsEvent::StatusChanged {
            status: "disconnected".to_string(),
            error: None,
        });
        log::info!("chat runtime ws: disconnected");
    });
}

fn handle_incoming_envelope(event_tx: &UnboundedSender<WsEvent>, envelope: IncomingEnvelope) {
    match envelope.message_type.as_str() {
        "chat.message" => {
            if let Ok(payload) =
                serde_json::from_value::<IncomingChatMessagePayload>(envelope.payload)
            {
                let _ = event_tx.send(WsEvent::ChatMessage(payload));
            }
        }
        "presence.user_status_changed" => {
            if let Ok(payload) =
                serde_json::from_value::<PresenceUserStatusChangedPayload>(envelope.payload)
            {
                let _ = event_tx.send(WsEvent::PresenceChanged(payload));
            }
        }
        "e2ee.sender_key_needed" => {
            if let Ok(payload) = serde_json::from_value::<SenderKeyNeededPayload>(envelope.payload)
            {
                let _ = event_tx.send(WsEvent::SenderKeyNeeded(payload));
            }
        }
        "e2ee.sender_key_distribution_available" => {
            if let Some(room_id) = envelope
                .payload
                .get("room_id")
                .and_then(|value| value.as_i64())
            {
                let _ = event_tx.send(WsEvent::SenderKeyDistributionAvailable { room_id });
            }
        }
        "e2ee.self_sender_key_sync_state_changed" => {
            if let Ok(payload) =
                serde_json::from_value::<ChatSelfSenderKeySyncState>(envelope.payload)
            {
                let _ = event_tx.send(WsEvent::SelfSenderKeySyncStateChanged(payload));
            }
        }
        "e2ee.replenish_otp_keys" => {
            let _ = event_tx.send(WsEvent::ReplenishOtp);
        }
        "chat.member_joined" => {
            if let Some(room_id) = envelope
                .payload
                .get("room_id")
                .and_then(|value| value.as_i64())
            {
                let _ = event_tx.send(WsEvent::MemberJoined { room_id });
            }
        }
        _ => {}
    }
}
