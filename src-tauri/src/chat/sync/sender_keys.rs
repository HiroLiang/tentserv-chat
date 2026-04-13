use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::chat::account_keys;
use crate::chat::api::{
    ChatApiClient, CreateSenderKeyRequestRequest, GetPendingSenderKeyDistributionsResponse,
    GetSenderKeyDistributionStatusResponse, OTPPreKeyItemRequest, RoomMemberResponse,
    UploadOTPPreKeysRequest, UploadSenderKeyRequest,
};
use crate::chat::store;
use crate::chat::{ChatRoomSnapshot, ChatRuntimeSession};
use crate::commands::e2ee::SenderKeyStatePayload;
use crate::commands::core::ConsumeSenderKeyDistributionResult;
use crate::crypto::x3dh::PublicKeyBundle;

use super::rooms::{resolve_current_member_id, resolve_current_member_id_snapshot};

struct SenderKeyUploadGuard {
    key: String,
}

impl Drop for SenderKeyUploadGuard {
    fn drop(&mut self) {
        if let Ok(mut uploads) = sender_key_uploads().lock() {
            uploads.remove(&self.key);
        }
    }
}

pub async fn handle_sender_key_needed(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    payload: crate::chat::ws::SenderKeyNeededPayload,
    participant_id: Option<i64>,
) -> Result<(), String> {
    if should_ignore_sender_key_room(payload.room_id) {
        log::warn!(
            "chat runtime sync: ignore sender_key_needed for invalid room_id={} provider_member_id={} requester_member_id={}",
            payload.room_id,
            payload.provider_member_id,
            payload.requester_member_id
        );
        return Ok(());
    }

    let local_room = store::load_room_snapshot(app, session.account_id, payload.room_id, None, None)?;
    let local_current_member_id = local_room
        .as_ref()
        .and_then(|room| resolve_current_member_id_snapshot(participant_id, &room.members));
    if let Some(current_member_id) = local_current_member_id {
        if current_member_id != payload.provider_member_id {
            return Ok(());
        }
    }

    let status = api.get_sender_key_distribution_status(payload.room_id).await?;
    if status.available_to_member_ids.contains(&payload.requester_member_id) {
        log::info!(
            "chat runtime sync: skip sender key upload because requester already has an available distribution room_id={} provider_member_id={} requester_member_id={}",
            payload.room_id,
            payload.provider_member_id,
            payload.requester_member_id
        );
        return Ok(());
    }
    if !status.pending_receivers.contains(&payload.requester_member_id) {
        log::info!(
            "chat runtime sync: skip sender key upload because requester is no longer pending room_id={} provider_member_id={} requester_member_id={}",
            payload.room_id,
            payload.provider_member_id,
            payload.requester_member_id
        );
        return Ok(());
    }

    let upload_key = sender_key_upload_key(
        payload.room_id,
        payload.provider_member_id,
        payload.requester_member_id,
        payload.requester_device_id.as_deref(),
    );
    let Some(_guard) = try_begin_sender_key_upload(upload_key)? else {
        log::info!(
            "chat runtime sync: skip duplicate in-flight sender key upload room_id={} provider_member_id={} requester_member_id={} requester_device_id={:?}",
            payload.room_id,
            payload.provider_member_id,
            payload.requester_member_id,
            payload.requester_device_id
        );
        return Ok(());
    };

    let target_member = match local_room
        .as_ref()
        .and_then(|room| room.members.iter().find(|member| member.member_id == payload.requester_member_id))
        .cloned()
    {
        Some(member) => member,
        None => {
            let detail = api.get_room_detail(payload.room_id).await?;
            let current_member_id = resolve_current_member_id(participant_id, &detail.members);
            if let Some(current_member_id) = current_member_id {
                if current_member_id != payload.provider_member_id {
                    return Ok(());
                }
            }
            let Some(member) = detail
                .members
                .into_iter()
                .find(|member| member.member_id == payload.requester_member_id)
            else {
                return Ok(());
            };
            crate::chat::ChatMemberSnapshot {
                member_id: member.member_id,
                participant_id: member.participant_id,
                user_id: member.user_id,
                display_name: member.display_name,
                avatar_url: member.avatar_url,
                role: member.role,
                last_read_at: member.last_read_at,
                joined_at: member.joined_at,
            }
        }
    };

    if let Some(target_user_id) = target_member.user_id {
        upload_own_sender_key(
            app,
            session,
            api,
            payload.room_id,
            payload.provider_member_id,
            target_member.member_id,
            target_user_id,
            payload.requester_device_id.as_deref(),
        )
        .await?;
    }

    Ok(())
}

pub async fn handle_sender_key_distribution_available(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    room_id: i64,
) -> Result<String, String> {
    if should_ignore_sender_key_room(room_id) {
        log::warn!(
            "chat runtime sync: ignore sender_key_distribution_available for invalid room_id={}",
            room_id
        );
        return Ok("locked".to_string());
    }

    resolve_member_sender_keys(app, session, api, room_id).await?;
    let status = api.get_sender_key_distribution_status(room_id).await?;
    let room = store::load_room_snapshot(app, session.account_id, room_id, None, None)?
        .ok_or_else(|| format!("room {room_id} not found after sender key available"))?;
    let participant_id = store::load_rooms_snapshot(app, session.account_id)?.participant_id;
    let current_member_id = resolve_current_member_id_snapshot(participant_id, &room.members)
        .ok_or_else(|| format!("current member mapping missing for room {room_id}"))?;
    let ready = is_direct_room_ready(
        app,
        session,
        current_member_id,
        &room.members_to_api_members(),
        &status,
    )?;
    let direct_key_status = if ready { "unlocked" } else { "locked" }.to_string();
    store::update_direct_key_status(app, session.account_id, room_id, &direct_key_status)?;
    Ok(direct_key_status)
}

pub async fn replenish_otp_if_needed(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
) -> Result<(), String> {
    let policy = api.get_key_policy().await?;
    let count = api.count_otp_prekeys(&session.device_id).await?.count;
    if count >= policy.otp_prekey_replenish_threshold {
        return Ok(());
    }

    let delta = (policy.otp_prekey_target_count - count).max(0) as u32;
    if delta == 0 {
        return Ok(());
    }

    let generated = account_keys::replenish_otp_keys(app, session.account_id, delta)?;
    let request = UploadOTPPreKeysRequest {
        device_id: session.device_id.clone(),
        keys: generated
            .into_iter()
            .map(|item| OTPPreKeyItemRequest {
                key_id: item.key_id,
                public_key: STANDARD.encode(item.public_key),
            })
            .collect(),
    };
    api.upload_otp_prekeys(&request).await?;
    Ok(())
}

pub async fn refresh_self_sender_key_sync_state(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
) -> Result<(String, Option<String>), String> {
    let devices = api.list_devices().await?;
    let has_other_devices = devices
        .devices
        .iter()
        .any(|device| device.device_id != session.device_id);

    if has_other_devices {
        log::warn!(
            "chat runtime sync: self sender-key sync pending because other devices are present for account_id={}",
            session.account_id
        );
        store::save_sync_state(
            app,
            session.account_id,
            None,
            None,
            None,
            None,
            Some("pending"),
            Some("Device-scoped self sender-key sync requires backend Phase 2 support."),
            None,
        )?;
        return Ok((
            "pending".to_string(),
            Some("Device-scoped self sender-key sync requires backend Phase 2 support.".to_string()),
        ));
    }

    log::info!(
        "chat runtime sync: self sender-key sync idle for account_id={}",
        session.account_id
    );
    store::save_sync_state(
        app,
        session.account_id,
        None,
        None,
        None,
        None,
        Some("idle"),
        None,
        None,
    )?;
    Ok(("idle".to_string(), None))
}

pub(super) async fn reconcile_room_sender_keys(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    room_id: i64,
    members: &[RoomMemberResponse],
    current_member_id: Option<i64>,
) -> Result<String, String> {
    let Some(current_member_id) = current_member_id else {
        return Ok("locked".to_string());
    };

    log::info!(
        "chat runtime sync: reconcile sender keys room_id={} current_member_id={} member_count={}",
        room_id,
        current_member_id,
        members.len()
    );

    let member_ids = members.iter().map(|member| member.member_id).collect::<Vec<_>>();
    let local_states_before = local_sender_key_state_map(app, session.account_id, &member_ids)?;
    let initial_status = api.get_sender_key_distribution_status(room_id).await?;
    provide_own_sender_key_if_needed(
        app,
        session,
        api,
        room_id,
        current_member_id,
        members,
        &local_states_before,
        &initial_status,
    )
    .await?;

    resolve_member_sender_keys(app, session, api, room_id).await?;

    let status = api.get_sender_key_distribution_status(room_id).await?;
    let local_states = local_sender_key_state_map(app, session.account_id, &member_ids)?;
    request_missing_peer_sender_keys(
        app,
        session,
        api,
        room_id,
        current_member_id,
        members,
        &local_states,
        &status,
    )
    .await?;

    let final_status = api
        .get_sender_key_distribution_status(room_id)
        .await
        .unwrap_or(status);
    let ready = is_direct_room_ready(app, session, current_member_id, members, &final_status)?;
    let direct_key_status = if ready { "unlocked" } else { "locked" }.to_string();
    log::info!(
        "chat runtime sync: reconciled sender keys room_id={} status={} requestable_members={:?} pending_from_members={:?} available_from_members={:?}",
        room_id,
        direct_key_status,
        final_status.requestable_member_ids,
        final_status.pending_from_members,
        final_status.available_from_member_ids
    );
    Ok(direct_key_status)
}

fn local_sender_key_state_map(
    app: &tauri::AppHandle,
    account_id: i64,
    member_ids: &[i64],
) -> Result<HashMap<i64, SenderKeyStatePayload>, String> {
    account_keys::get_sender_key_states(app, account_id, member_ids)
}

async fn provide_own_sender_key_if_needed(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    room_id: i64,
    current_member_id: i64,
    members: &[RoomMemberResponse],
    local_states: &HashMap<i64, SenderKeyStatePayload>,
    status: &GetSenderKeyDistributionStatusResponse,
) -> Result<(), String> {
    let refresh_all = !local_states
        .get(&current_member_id)
        .map(|state| state.is_own_key)
        .unwrap_or(false)
        || !status.own_sender_key_exists;

    for member in members {
        if member.member_id == current_member_id {
            continue;
        }
        let should_upload = refresh_all || status.pending_receivers.contains(&member.member_id);
        if !should_upload {
            continue;
        }

        if let Some(user_id) = member.user_id {
            log::info!(
                "chat runtime sync: provide own sender key room_id={} current_member_id={} receiver_member_id={}",
                room_id,
                current_member_id,
                member.member_id
            );
            upload_own_sender_key(
                app,
                session,
                api,
                room_id,
                current_member_id,
                member.member_id,
                user_id,
                None,
            )
            .await?;
        }
    }
    Ok(())
}

async fn request_missing_peer_sender_keys(
    _app: &tauri::AppHandle,
    _session: &ChatRuntimeSession,
    api: &ChatApiClient,
    room_id: i64,
    current_member_id: i64,
    members: &[RoomMemberResponse],
    local_states: &HashMap<i64, SenderKeyStatePayload>,
    status: &GetSenderKeyDistributionStatusResponse,
) -> Result<(), String> {
    for member in members {
        if member.member_id == current_member_id {
            continue;
        }
        let has_local_peer_key = local_states
            .get(&member.member_id)
            .map(|state| !state.is_own_key)
            .unwrap_or(false);
        if !should_request_peer_sender_key(member.member_id, has_local_peer_key, status) {
            continue;
        }

        log::info!(
            "chat runtime sync: request missing peer sender key room_id={} current_member_id={} provider_member_id={}",
            room_id,
            current_member_id,
            member.member_id
        );
        api.create_sender_key_request(&CreateSenderKeyRequestRequest {
            room_id,
            provider_member_id: member.member_id,
            requester_device_id: None,
        })
        .await?;
    }
    Ok(())
}

fn requestable_peer_member_ids(
    status: &GetSenderKeyDistributionStatusResponse,
) -> HashSet<i64> {
    status
        .requestable_member_ids
        .iter()
        .copied()
        .chain(status.pending_from_members.iter().copied())
        .collect()
}

fn should_request_peer_sender_key(
    member_id: i64,
    has_local_peer_key: bool,
    status: &GetSenderKeyDistributionStatusResponse,
) -> bool {
    if has_local_peer_key {
        return false;
    }
    if status.available_from_member_ids.contains(&member_id) {
        return false;
    }
    requestable_peer_member_ids(status).contains(&member_id)
}

fn sender_key_uploads() -> &'static Mutex<HashSet<String>> {
    static IN_FLIGHT_SENDER_KEY_UPLOADS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    IN_FLIGHT_SENDER_KEY_UPLOADS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn sender_key_upload_key(
    room_id: i64,
    provider_member_id: i64,
    requester_member_id: i64,
    requester_device_id: Option<&str>,
) -> String {
    format!(
        "{room_id}:{provider_member_id}:{requester_member_id}:{}",
        requester_device_id.unwrap_or("*"),
    )
}

fn try_begin_sender_key_upload(key: String) -> Result<Option<SenderKeyUploadGuard>, String> {
    let mut uploads = sender_key_uploads()
        .lock()
        .map_err(|_| "lock sender key uploads failed".to_string())?;
    if !uploads.insert(key.clone()) {
        return Ok(None);
    }
    Ok(Some(SenderKeyUploadGuard { key }))
}

fn should_ignore_sender_key_room(room_id: i64) -> bool {
    room_id <= 0
}

async fn resolve_member_sender_keys(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    room_id: i64,
) -> Result<(), String> {
    if should_ignore_sender_key_room(room_id) {
        log::warn!(
            "chat runtime sync: skip pending sender key resolution for invalid room_id={}",
            room_id
        );
        return Ok(());
    }

    let pending = api.get_pending_sender_key_distributions(room_id).await?;
    log::info!(
        "chat runtime sync: resolve pending sender keys room_id={} pending_count={}",
        room_id,
        pending.distributions.len()
    );
    consume_pending_sender_key_distributions(app, session, api, pending).await
}

async fn consume_pending_sender_key_distributions(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    pending: GetPendingSenderKeyDistributionsResponse,
) -> Result<(), String> {
    if pending.distributions.is_empty() {
        return Ok(());
    }

    for distribution in pending.distributions {
        log::info!(
            "chat runtime sync: consume pending sender key distribution sender_member_id={} distribution_id={} version={}",
            distribution.sender_member_id,
            distribution.distribution_id,
            distribution.sender_key_version
        );
        let bytes = STANDARD
            .decode(distribution.distribution_message.as_bytes())
            .map_err(|err| format!("decode sender key distribution message failed: {err}"))?;
        let status = match account_keys::consume_sender_key_distribution(
            app,
            session.account_id,
            distribution.sender_member_id,
            &bytes,
            distribution.sender_key_version,
        )? {
            ConsumeSenderKeyDistributionResult::Consumed
            | ConsumeSenderKeyDistributionResult::Stale => "consumed",
            ConsumeSenderKeyDistributionResult::Failed => "failed",
        };
        api.consume_sender_key_distribution(distribution.distribution_id, status)
            .await?;
    }
    Ok(())
}

fn is_direct_room_ready(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    current_member_id: i64,
    members: &[RoomMemberResponse],
    status: &GetSenderKeyDistributionStatusResponse,
) -> Result<bool, String> {
    let local_states = local_sender_key_state_map(
        app,
        session.account_id,
        &members.iter().map(|member| member.member_id).collect::<Vec<_>>(),
    )?;
    let own_exists = local_states
        .get(&current_member_id)
        .map(|state| state.is_own_key)
        .unwrap_or(false);
    if !own_exists {
        return Ok(false);
    }

    let peer_members = members
        .iter()
        .filter(|member| member.member_id != current_member_id)
        .collect::<Vec<_>>();
    if !peer_members.is_empty() {
        return Ok(peer_members.iter().all(|member| {
            local_states
                .get(&member.member_id)
                .map(|state| !state.is_own_key)
                .unwrap_or(false)
        }));
    }

    Ok(status.pending_from_members.is_empty() && status.available_from_member_ids.is_empty())
}

async fn upload_own_sender_key(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    room_id: i64,
    current_member_id: i64,
    receiver_member_id: i64,
    target_user_id: i64,
    receiver_device_id: Option<&str>,
) -> Result<(), String> {
    let bundle = api.get_key_bundle(target_user_id, receiver_device_id).await?;
    log::info!(
        "chat runtime sync: fetched key bundle target_user_id={} receiver_member_id={} receiver_device_id={:?}",
        target_user_id,
        receiver_member_id,
        receiver_device_id
    );
    let public_key_bundle = PublicKeyBundle {
        identity_key_dh: STANDARD
            .decode(bundle.identity_key.as_bytes())
            .map_err(|err| format!("decode identity key failed: {err}"))?
            .try_into()
            .map_err(|_| "identity key must be 32 bytes".to_string())?,
        identity_key_sign: STANDARD
            .decode(bundle.identity_key_sign.as_bytes())
            .map_err(|err| format!("decode identity sign key failed: {err}"))?
            .try_into()
            .map_err(|_| "identity sign key must be 32 bytes".to_string())?,
        signed_pre_key: STANDARD
            .decode(bundle.signed_pre_key.as_bytes())
            .map_err(|err| format!("decode signed pre-key failed: {err}"))?
            .try_into()
            .map_err(|_| "signed pre-key must be 32 bytes".to_string())?,
        spk_signature: STANDARD
            .decode(bundle.spk_signature.as_bytes())
            .map_err(|err| format!("decode spk signature failed: {err}"))?
            .try_into()
            .map_err(|_| "spk signature must be 64 bytes".to_string())?,
        spk_key_id: bundle.spk_key_id,
        one_time_pre_key: match bundle.otp_pre_key {
            Some(otp_pre_key) => Some(
                STANDARD
                    .decode(otp_pre_key.as_bytes())
                    .map_err(|err| format!("decode otp pre-key failed: {err}"))?
                    .try_into()
                    .map_err(|_| "otp pre-key must be 32 bytes".to_string())?,
            ),
            None => None,
        },
        otpk_key_id: bundle.otp_pre_key_id,
    };

    let prepared = account_keys::prepare_sender_key_distribution(
        app,
        session.account_id,
        current_member_id,
        &public_key_bundle,
    )?;

    api.upload_sender_key(&UploadSenderKeyRequest {
        room_id,
        receiver_member_id,
        sender_key_version: prepared.sender_key_version,
        distribution_message: STANDARD.encode(prepared.distribution_message),
        receiver_device_id: receiver_device_id.map(ToOwned::to_owned),
    })
    .await?;

    log::info!(
        "chat runtime sync: uploaded sender key room_id={} current_member_id={} receiver_member_id={} version={}",
        room_id,
        current_member_id,
        receiver_member_id,
        prepared.sender_key_version
    );

    Ok(())
}

trait SnapshotMembersExt {
    fn members_to_api_members(&self) -> Vec<RoomMemberResponse>;
}

impl SnapshotMembersExt for ChatRoomSnapshot {
    fn members_to_api_members(&self) -> Vec<RoomMemberResponse> {
        self.members
            .iter()
            .map(|member| RoomMemberResponse {
                member_id: member.member_id,
                participant_id: member.participant_id,
                user_id: member.user_id,
                display_name: member.display_name.clone(),
                avatar_url: member.avatar_url.clone(),
                role: member.role.clone(),
                last_read_at: member.last_read_at.clone(),
                joined_at: member.joined_at.clone(),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        requestable_peer_member_ids, sender_key_upload_key, should_ignore_sender_key_room,
        should_request_peer_sender_key, try_begin_sender_key_upload,
    };
    use crate::chat::api::GetSenderKeyDistributionStatusResponse;

    #[test]
    fn requestable_peer_member_ids_includes_explicit_requestable_members() {
        let status = GetSenderKeyDistributionStatusResponse {
            requestable_member_ids: vec![41],
            pending_from_members: vec![],
            ..Default::default()
        };

        let requestable = requestable_peer_member_ids(&status);

        assert!(requestable.contains(&41));
    }

    #[test]
    fn requestable_peer_member_ids_includes_pending_from_members() {
        let status = GetSenderKeyDistributionStatusResponse {
            requestable_member_ids: vec![],
            pending_from_members: vec![42],
            ..Default::default()
        };

        let requestable = requestable_peer_member_ids(&status);

        assert!(requestable.contains(&42));
    }

    #[test]
    fn should_request_peer_sender_key_skips_members_with_local_peer_key_or_available_distribution() {
        let status = GetSenderKeyDistributionStatusResponse {
            requestable_member_ids: vec![43, 44],
            available_from_member_ids: vec![44],
            ..Default::default()
        };

        assert!(!should_request_peer_sender_key(43, true, &status));
        assert!(!should_request_peer_sender_key(44, false, &status));
        assert!(should_request_peer_sender_key(43, false, &status));
    }

    #[test]
    fn sender_key_upload_guard_deduplicates_same_request_target() {
        let key = sender_key_upload_key(9, 101, 202, Some("device-a"));
        let first = try_begin_sender_key_upload(key.clone()).expect("first attempt should lock");
        let second = try_begin_sender_key_upload(key).expect("second attempt should check");

        assert!(first.is_some());
        assert!(second.is_none());
    }

    #[test]
    fn invalid_sender_key_room_ids_are_ignored() {
        assert!(should_ignore_sender_key_room(0));
        assert!(should_ignore_sender_key_room(-1));
        assert!(!should_ignore_sender_key_room(1));
    }
}
