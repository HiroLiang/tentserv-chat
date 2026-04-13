use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::chat::account_keys;
use crate::chat::api::{
    ChatApiClient, CreateSenderKeyRequestRequest, MessageResponse, SendMessageRequest,
};
use crate::chat::store::{self, EncryptedChatMessageRecord};
use crate::chat::ws::IncomingChatMessagePayload;
use crate::chat::{ChatMessageSnapshot, ChatRuntimeSession};

use super::rooms::resolve_current_member_id_snapshot;

pub const WAITING_FOR_SENDER_KEY_SENTINEL: &str = "__E2EE_WAITING_KEY__";

struct OutgoingMessageContent {
    encoded_content: String,
    cache_bytes: Vec<u8>,
}

pub async fn send_message(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    room_id: i64,
    client_message_id: &str,
    current_member_id: i64,
    created_at: &str,
    content: &str,
    message_type: &str,
) -> Result<(i64, String), String> {
    let content = if message_type == "text" {
        encrypt_message_content(app, session, current_member_id, content)?
    } else {
        OutgoingMessageContent {
            encoded_content: content.to_string(),
            cache_bytes: content.as_bytes().to_vec(),
        }
    };

    store::save_encrypted_message(
        app,
        &EncryptedChatMessageRecord {
            account_id: session.account_id,
            room_id,
            client_message_id: client_message_id.to_string(),
            server_message_id: None,
            sender_id: current_member_id,
            encrypted_content: content.cache_bytes.clone(),
            message_type: message_type.to_string(),
            created_at: created_at.to_string(),
        },
    )?;

    let response = api
        .send_message(
            room_id,
            &SendMessageRequest {
                message_type: message_type.to_string(),
                content: content.encoded_content,
                reply_to_id: None,
            },
        )
        .await?;

    Ok((response.message_id, response.created_at))
}

pub async fn mark_room_read(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    room_id: i64,
) -> Result<(), String> {
    let response = api.mark_room_read(room_id).await?;
    store::update_room_unread(app, session.account_id, room_id, 0)?;
    let members = response
        .members
        .into_iter()
        .map(|member| crate::chat::ChatMemberSnapshot {
            member_id: member.member_id,
            last_read_at: member.last_read_at,
            ..Default::default()
        })
        .collect::<Vec<_>>();
    store::update_room_member_reads(app, session.account_id, room_id, &members)?;
    Ok(())
}

pub async fn handle_incoming_chat_message(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    participant_id: Option<i64>,
    active_room_id: Option<i64>,
    payload: IncomingChatMessagePayload,
) -> Result<ChatMessageSnapshot, String> {
    let encrypted_bytes = payload.content.as_bytes().to_vec();
    let client_message_id = format!("server:{}", payload.message_id);
    store::save_encrypted_message(
        app,
        &EncryptedChatMessageRecord {
            account_id: session.account_id,
            room_id: payload.room_id,
            client_message_id: client_message_id.clone(),
            server_message_id: Some(payload.message_id),
            sender_id: payload.sender_id,
            encrypted_content: encrypted_bytes,
            message_type: payload.message_type.clone(),
            created_at: payload.created_at.clone(),
        },
    )?;

    let content = decrypt_message_content(
        app,
        session,
        api,
        payload.room_id,
        payload.sender_id,
        &payload.content,
    )
    .await?;

    let message = ChatMessageSnapshot {
        client_message_id,
        message_id: Some(payload.message_id),
        sender_id: payload.sender_id,
        r#type: payload.message_type,
        content,
        reply_to_id: payload.reply_to_id,
        is_edited: payload.is_edited,
        is_deleted: payload.is_deleted,
        created_at: payload.created_at.clone(),
        sort_key: store::sort_key_from_created_at(&payload.created_at),
        delivery_status: "sent".to_string(),
        delivery_error: None,
        is_local_echo: false,
    };
    store::save_or_update_message(app, session.account_id, payload.room_id, &message)?;

    let current_member_id = store::load_room_snapshot(app, session.account_id, payload.room_id, None, None)?
        .and_then(|room| resolve_current_member_id_snapshot(participant_id, &room.members));
    if should_increment_unread(current_member_id, active_room_id, payload.room_id, payload.sender_id) {
        let snapshot = store::load_rooms_snapshot(app, session.account_id)?;
        let unread_count = snapshot
            .rooms
            .direct
            .iter()
            .chain(snapshot.rooms.group.iter())
            .chain(snapshot.rooms.channel.iter())
            .chain(snapshot.rooms.bot.iter())
            .find(|room| room.room_id == payload.room_id)
            .map(|room| room.unread_count + 1)
            .unwrap_or(1);
        store::update_room_unread(app, session.account_id, payload.room_id, unread_count)?;
    }

    Ok(message)
}

pub(super) async fn decrypt_messages(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    room_id: i64,
    messages: Vec<MessageResponse>,
) -> Result<Vec<ChatMessageSnapshot>, String> {
    let mut out = Vec::with_capacity(messages.len());
    for message in messages {
        let client_message_id = format!("server:{}", message.message_id);
        store::save_encrypted_message(
            app,
            &EncryptedChatMessageRecord {
                account_id: session.account_id,
                room_id,
                client_message_id: client_message_id.clone(),
                server_message_id: Some(message.message_id),
                sender_id: message.sender_id,
                encrypted_content: message.content.as_bytes().to_vec(),
                message_type: message.message_type.clone(),
                created_at: message.created_at.clone(),
            },
        )?;
        let content = decrypt_message_content(app, session, api, room_id, message.sender_id, &message.content)
            .await
            .unwrap_or_else(|_| message.content.clone());
        out.push(ChatMessageSnapshot {
            client_message_id,
            message_id: Some(message.message_id),
            sender_id: message.sender_id,
            r#type: message.message_type,
            content,
            reply_to_id: message.reply_to_id,
            is_edited: message.is_edited,
            is_deleted: message.is_deleted.unwrap_or(false),
            created_at: message.created_at.clone(),
            sort_key: store::sort_key_from_created_at(&message.created_at),
            delivery_status: "sent".to_string(),
            delivery_error: None,
            is_local_echo: false,
        });
    }
    Ok(out)
}

pub async fn decrypt_message_content(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    room_id: i64,
    sender_member_id: i64,
    content: &str,
) -> Result<String, String> {
    if !content.starts_with("e2ee:v1:") {
        return Ok(content.to_string());
    }

    let combined = STANDARD
        .decode(content.trim_start_matches("e2ee:v1:").as_bytes())
        .map_err(|err| format!("decode encrypted chat message failed: {err}"))?;
    if combined.len() < 12 {
        return Err("encrypted chat message is too short".to_string());
    }

    match account_keys::decrypt_message(
        app,
        session.account_id,
        sender_member_id,
        &combined[12..],
        &combined[..12],
    )? {
        crate::commands::core::SenderKeyDecryptResult::Ok { plaintext } => String::from_utf8(plaintext)
            .map_err(|err| format!("decode decrypted chat message utf8 failed: {err}")),
        crate::commands::core::SenderKeyDecryptResult::MissingKey
        | crate::commands::core::SenderKeyDecryptResult::StaleKey => {
            log::warn!(
                "chat runtime sync: sender key missing or stale room_id={} sender_member_id={}, creating request",
                room_id,
                sender_member_id
            );
            let _ = api
                .create_sender_key_request(&CreateSenderKeyRequestRequest {
                    room_id,
                    provider_member_id: sender_member_id,
                    requester_device_id: None,
                })
                .await;
            Ok(WAITING_FOR_SENDER_KEY_SENTINEL.to_string())
        }
    }
}

fn encrypt_message_content(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    current_member_id: i64,
    plaintext: &str,
) -> Result<OutgoingMessageContent, String> {
    let encrypted = account_keys::encrypt_message(
        app,
        session.account_id,
        current_member_id,
        plaintext.as_bytes(),
    )?;

    let mut combined = encrypted.nonce.to_vec();
    combined.extend_from_slice(&encrypted.ciphertext);
    let encoded_content = format!("e2ee:v1:{}", STANDARD.encode(&combined));
    Ok(OutgoingMessageContent {
        cache_bytes: encoded_content.as_bytes().to_vec(),
        encoded_content,
    })
}

fn should_increment_unread(
    current_member_id: Option<i64>,
    active_room_id: Option<i64>,
    room_id: i64,
    sender_member_id: i64,
) -> bool {
    if active_room_id == Some(room_id) {
        return false;
    }
    current_member_id != Some(sender_member_id)
}

#[cfg(test)]
mod tests {
    use super::should_increment_unread;

    #[test]
    fn unread_only_increments_for_background_peer_messages() {
        assert!(!should_increment_unread(Some(6), None, 3, 6));
        assert!(!should_increment_unread(Some(5), Some(3), 3, 6));
        assert!(should_increment_unread(Some(5), None, 3, 6));
    }
}
