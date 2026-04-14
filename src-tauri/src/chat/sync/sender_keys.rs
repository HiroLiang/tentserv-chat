use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::chat::account_keys;
use crate::chat::api::{
    BulkSelfSenderKeySyncDistributionsRequest, ChatApiClient, CreateSenderKeyRequestRequest,
    FailSelfSenderKeySyncRequest, GetPendingSenderKeyDistributionsResponse,
    GetSelfSenderKeySyncResponse, GetSenderKeyDistributionStatusResponse, OTPPreKeyItemRequest,
    RoomMemberResponse, SelfSenderKeySyncDistributionItemRequest, UploadOTPPreKeysRequest,
    UploadSenderKeyRequest,
};
use crate::chat::store;
use crate::chat::{
    ChatRoomSnapshot, ChatRuntimeSession, ChatSelfSenderKeySyncDevice, ChatSelfSenderKeySyncState,
};
use crate::commands::core::ConsumeSenderKeyDistributionResult;
use crate::commands::e2ee::SenderKeyStatePayload;
use crate::crypto::x3dh::PublicKeyBundle;

use super::messages::decrypt_messages;
use super::rooms::{
    resolve_current_member_id, resolve_current_member_id_snapshot, sync_room, sync_rooms,
};

type LocalSenderKeyStateMap = HashMap<(i64, String), SenderKeyStatePayload>;

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

    let local_room =
        store::load_room_snapshot(app, session.account_id, payload.room_id, None, None)?;
    let local_current_member_id = local_room
        .as_ref()
        .and_then(|room| resolve_current_member_id_snapshot(participant_id, &room.members));
    if let Some(current_member_id) = local_current_member_id {
        if current_member_id != payload.provider_member_id {
            return Ok(());
        }
    }

    let status = api
        .get_sender_key_distribution_status(payload.room_id)
        .await?;
    if has_available_target(
        &status,
        payload.requester_member_id,
        payload.requester_device_id.as_deref(),
    ) {
        log::info!(
            "chat runtime sync: skip sender key upload because requester already has an available distribution room_id={} provider_member_id={} requester_member_id={}",
            payload.room_id,
            payload.provider_member_id,
            payload.requester_member_id
        );
        return Ok(());
    }
    if !has_pending_receiver(
        &status,
        payload.requester_member_id,
        payload.requester_device_id.as_deref(),
    ) {
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
        .and_then(|room| {
            room.members
                .iter()
                .find(|member| member.member_id == payload.requester_member_id)
        })
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

    if !normal_sender_key_ops_allowed(app, session, api).await {
        log::info!(
            "chat runtime sync: skip normal sender key distribution consume because requester self sync is active room_id={}",
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
    participant_id: Option<i64>,
) -> Result<ChatSelfSenderKeySyncState, String> {
    let snapshot = to_chat_self_sender_key_sync_state(api.get_self_sender_key_sync().await?);
    handle_self_sender_key_sync_state_changed(app, session, api, participant_id, snapshot).await
}

pub async fn handle_self_sender_key_sync_state_changed(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    participant_id: Option<i64>,
    snapshot: ChatSelfSenderKeySyncState,
) -> Result<ChatSelfSenderKeySyncState, String> {
    let snapshot = persist_self_sender_key_sync_snapshot(app, session, &snapshot)?;
    match self_sender_key_sync_follow_up(&snapshot) {
        Some(SelfSenderKeySyncFollowUp::ProviderUpload) => {
            upload_self_sender_keys_to_requester(app, session, api, participant_id, &snapshot).await
        }
        Some(SelfSenderKeySyncFollowUp::RequesterConsume) => {
            consume_self_sender_keys_and_backfill(app, session, api, participant_id, &snapshot)
                .await
        }
        _ => Ok(snapshot),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SelfSenderKeySyncFollowUp {
    ProviderUpload,
    RequesterConsume,
}

fn self_sender_key_sync_follow_up(
    snapshot: &ChatSelfSenderKeySyncState,
) -> Option<SelfSenderKeySyncFollowUp> {
    match snapshot.status.as_str() {
        "syncing" if snapshot.provider_current_device => {
            Some(SelfSenderKeySyncFollowUp::ProviderUpload)
        }
        "uploaded" if snapshot.requester_current_device => {
            Some(SelfSenderKeySyncFollowUp::RequesterConsume)
        }
        _ => None,
    }
}

fn is_active_self_sender_key_sync_status(status: &str) -> bool {
    matches!(status, "pending_provider" | "syncing" | "uploaded")
}

fn should_block_normal_sender_key_ops(snapshot: &ChatSelfSenderKeySyncState) -> bool {
    snapshot.exists
        && snapshot.requester_current_device
        && is_active_self_sender_key_sync_status(snapshot.status.as_str())
}

pub(super) async fn normal_sender_key_ops_allowed(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
) -> bool {
    let local_status = store::load_rooms_snapshot(app, session.account_id)
        .ok()
        .map(|snapshot| snapshot.sync_state.self_sender_key_sync_status)
        .unwrap_or_else(|| "idle".to_string());

    if !is_active_self_sender_key_sync_status(local_status.as_str()) {
        return true;
    }

    match api.get_self_sender_key_sync().await {
        Ok(response) => {
            let latest = to_chat_self_sender_key_sync_state(response);
            let _ = persist_self_sender_key_sync_snapshot(app, session, &latest);
            !should_block_normal_sender_key_ops(&latest)
        }
        Err(error) => {
            log::warn!(
                "chat runtime sync: self sender key sync refresh failed while checking normal sender key gate error={}",
                error
            );
            false
        }
    }
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

    if !normal_sender_key_ops_allowed(app, session, api).await {
        log::info!(
            "chat runtime sync: skip normal sender key reconcile because requester self sync is active room_id={} current_member_id={}",
            room_id,
            current_member_id
        );
        return Ok("locked".to_string());
    }

    log::info!(
        "chat runtime sync: reconcile sender keys room_id={} current_member_id={} member_count={}",
        room_id,
        current_member_id,
        members.len()
    );

    let member_ids = members
        .iter()
        .map(|member| member.member_id)
        .collect::<Vec<_>>();
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
        requestable_peer_member_ids(&final_status),
        pending_from_member_ids(&final_status),
        available_from_member_ids(&final_status)
    );
    Ok(direct_key_status)
}

fn local_sender_key_state_map(
    app: &tauri::AppHandle,
    account_id: i64,
    member_ids: &[i64],
) -> Result<LocalSenderKeyStateMap, String> {
    let mut states = HashMap::new();
    for state in account_keys::list_sender_key_states(app, account_id, member_ids)? {
        let Ok(member_id) = state.member_id.parse::<i64>() else {
            continue;
        };
        states.insert(
            local_sender_key_state_key(member_id, &state.device_id),
            state,
        );
    }
    Ok(states)
}

async fn provide_own_sender_key_if_needed(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    room_id: i64,
    current_member_id: i64,
    members: &[RoomMemberResponse],
    local_states: &LocalSenderKeyStateMap,
    status: &GetSenderKeyDistributionStatusResponse,
) -> Result<(), String> {
    let refresh_all =
        !local_has_own_current_sender_key(local_states, current_member_id, &session.device_id)
            || !status.own_device_sender_key_exists;

    for member in members {
        if member.member_id == current_member_id {
            continue;
        }
        if let Some(user_id) = member.user_id {
            let pending_devices = status
                .pending_receivers
                .iter()
                .filter(|entry| entry.member_id == member.member_id)
                .map(|entry| entry.device_id.clone())
                .collect::<Vec<_>>();

            if pending_devices.is_empty() {
                if !refresh_all {
                    continue;
                }

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
                continue;
            }

            for device_id in pending_devices {
                log::info!(
                    "chat runtime sync: provide own sender key room_id={} current_member_id={} receiver_member_id={} receiver_device_id={}",
                    room_id,
                    current_member_id,
                    member.member_id,
                    device_id
                );
                upload_own_sender_key(
                    app,
                    session,
                    api,
                    room_id,
                    current_member_id,
                    member.member_id,
                    user_id,
                    Some(device_id.as_str()),
                )
                .await?;
            }
        }
    }
    Ok(())
}

async fn request_missing_peer_sender_keys(
    _app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    room_id: i64,
    current_member_id: i64,
    members: &[RoomMemberResponse],
    local_states: &LocalSenderKeyStateMap,
    status: &GetSenderKeyDistributionStatusResponse,
) -> Result<(), String> {
    let members_by_id = members
        .iter()
        .map(|member| (member.member_id, member))
        .collect::<HashMap<_, _>>();

    for (provider_member_id, provider_device_id) in collect_request_sources(status) {
        if provider_member_id == current_member_id {
            continue;
        }
        if !members_by_id.contains_key(&provider_member_id) {
            continue;
        }
        if local_has_sender_key(local_states, provider_member_id, &provider_device_id) {
            continue;
        }

        log::info!(
            "chat runtime sync: request missing peer sender key room_id={} current_member_id={} provider_member_id={} provider_device_id={}",
            room_id,
            current_member_id,
            provider_member_id,
            provider_device_id
        );
        api.create_sender_key_request(&CreateSenderKeyRequestRequest {
            room_id,
            provider_member_id,
            provider_device_id,
            requester_device_id: Some(session.device_id.clone()),
        })
        .await?;
    }
    Ok(())
}

fn persist_self_sender_key_sync_snapshot(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    snapshot: &ChatSelfSenderKeySyncState,
) -> Result<ChatSelfSenderKeySyncState, String> {
    store::save_sync_state(
        app,
        session.account_id,
        None,
        None,
        None,
        None,
        Some(snapshot.status.as_str()),
        snapshot.last_error.as_deref(),
        None,
    )?;
    Ok(snapshot.clone())
}

fn to_chat_self_sender_key_sync_state(
    response: GetSelfSenderKeySyncResponse,
) -> ChatSelfSenderKeySyncState {
    ChatSelfSenderKeySyncState {
        exists: response.exists,
        status: response.status,
        requester_device: response
            .requester_device
            .map(to_chat_self_sender_key_sync_device),
        provider_device: response
            .provider_device
            .map(to_chat_self_sender_key_sync_device),
        requester_current_device: response.requester_current_device,
        provider_current_device: response.provider_current_device,
        last_error: response.last_error,
        requested_at_ms: response.requested_at_ms,
        provider_claimed_at_ms: response.provider_claimed_at_ms,
        uploaded_at_ms: response.uploaded_at_ms,
        completed_at_ms: response.completed_at_ms,
        failed_at_ms: response.failed_at_ms,
    }
}

fn to_chat_self_sender_key_sync_device(
    device: crate::chat::api::SelfSenderKeySyncDeviceResponse,
) -> ChatSelfSenderKeySyncDevice {
    ChatSelfSenderKeySyncDevice {
        device_id: device.device_id,
        device_name: device.device_name,
        platform: device.platform,
        last_ip: device.last_ip,
        binding_status: device.binding_status,
    }
}

fn build_public_key_bundle(
    bundle: crate::chat::api::GetKeyBundleResponse,
) -> Result<PublicKeyBundle, String> {
    Ok(PublicKeyBundle {
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
    })
}

fn self_sender_key_sync_jobs() -> &'static Mutex<HashSet<String>> {
    static IN_FLIGHT_SELF_SENDER_KEY_SYNC_JOBS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    IN_FLIGHT_SELF_SENDER_KEY_SYNC_JOBS.get_or_init(|| Mutex::new(HashSet::new()))
}

struct SelfSenderKeySyncGuard {
    key: String,
}

impl Drop for SelfSenderKeySyncGuard {
    fn drop(&mut self) {
        if let Ok(mut jobs) = self_sender_key_sync_jobs().lock() {
            jobs.remove(&self.key);
        }
    }
}

fn try_begin_self_sender_key_sync_job(
    key: String,
) -> Result<Option<SelfSenderKeySyncGuard>, String> {
    let mut jobs = self_sender_key_sync_jobs()
        .lock()
        .map_err(|_| "lock self sender key sync jobs failed".to_string())?;
    if !jobs.insert(key.clone()) {
        return Ok(None);
    }
    Ok(Some(SelfSenderKeySyncGuard { key }))
}

async fn upload_self_sender_keys_to_requester(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    participant_id: Option<i64>,
    snapshot: &ChatSelfSenderKeySyncState,
) -> Result<ChatSelfSenderKeySyncState, String> {
    if !snapshot.exists || !snapshot.provider_current_device {
        return Ok(snapshot.clone());
    }

    let requester_device_id = snapshot
        .requester_device
        .as_ref()
        .map(|device| device.device_id.clone())
        .ok_or_else(|| "self sender key sync requester device missing".to_string())?;
    let sync_key = format!(
        "provider:{}:{}",
        requester_device_id,
        snapshot.requested_at_ms.unwrap_or_default(),
    );
    let Some(_guard) = try_begin_self_sender_key_sync_job(sync_key)? else {
        return Ok(snapshot.clone());
    };

    let result = async {
        let requester_bundle = build_public_key_bundle(
            api.get_key_bundle(session.user_id, Some(&requester_device_id))
                .await?,
        )?;
        let rooms = api.get_rooms().await?;
        let member_ids = collect_joined_room_member_ids(app, session, api, participant_id, &rooms).await?;
        let sender_key_materials = account_keys::list_sender_key_materials(app, session.account_id, &member_ids)?;
        let mut seen = HashSet::new();
        let mut items = Vec::new();

        for material in sender_key_materials {
            let Ok(sender_member_id) = material.member_id.parse::<i64>() else {
                continue;
            };
            if material.device_id == requester_device_id {
                continue;
            }
            if !seen.insert((sender_member_id, material.device_id.clone(), material.sender_key_version)) {
                continue;
            }

            let prepared = account_keys::prepare_existing_sender_key_distribution(
                app,
                session.account_id,
                sender_member_id,
                &material.device_id,
                &requester_bundle,
            )?;

            items.push(SelfSenderKeySyncDistributionItemRequest {
                sender_member_id,
                sender_device_id: material.device_id,
                sender_key_version: prepared.sender_key_version,
                distribution_message: STANDARD.encode(prepared.distribution_message),
            });
        }

        if !items.is_empty() {
            let response = api
                .bulk_self_sender_key_sync_distributions(&BulkSelfSenderKeySyncDistributionsRequest { items })
                .await?;
            log::info!(
                "chat runtime sync: uploaded self sender key sync distributions requester_device_id={} count={}",
                requester_device_id,
                response.count
            );
        }

        let uploaded = match api.mark_self_sender_key_sync_uploaded().await {
            Ok(response) => to_chat_self_sender_key_sync_state(response),
            Err(error) => {
                log::warn!(
                    "chat runtime sync: mark uploaded failed, refreshing latest self sync state error={}",
                    error
                );
                let latest = to_chat_self_sender_key_sync_state(api.get_self_sender_key_sync().await?);
                if !matches!(latest.status.as_str(), "uploaded" | "completed") {
                    return Err(error);
                }
                latest
            }
        };
        persist_self_sender_key_sync_snapshot(app, session, &uploaded)
    }
    .await;

    if let Err(error) = &result {
        return report_failed_self_sender_key_sync(app, session, api, snapshot, error.clone())
            .await;
    }

    result
}

async fn consume_self_sender_keys_and_backfill(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    participant_id: Option<i64>,
    snapshot: &ChatSelfSenderKeySyncState,
) -> Result<ChatSelfSenderKeySyncState, String> {
    if !snapshot.exists || !snapshot.requester_current_device {
        return Ok(snapshot.clone());
    }

    let requester_device_id = snapshot
        .requester_device
        .as_ref()
        .map(|device| device.device_id.clone())
        .unwrap_or_else(|| session.device_id.clone());
    let sync_key = format!(
        "requester:{}:{}",
        requester_device_id,
        snapshot
            .uploaded_at_ms
            .unwrap_or(snapshot.requested_at_ms.unwrap_or_default()),
    );
    let Some(_guard) = try_begin_self_sender_key_sync_job(sync_key)? else {
        return Ok(snapshot.clone());
    };

    let result = async {
        let pending_distributions = api.get_pending_self_sender_key_sync_distributions().await?;
        for distribution in pending_distributions.distributions {
            let bytes = STANDARD
                .decode(distribution.distribution_message.as_bytes())
                .map_err(|err| format!("decode self sender key sync distribution failed: {err}"))?;
            let status = match account_keys::consume_sender_key_distribution(
                app,
                session.account_id,
                distribution.sender_member_id,
                &distribution.sender_device_id,
                &bytes,
                distribution.sender_key_version,
            )? {
                ConsumeSenderKeyDistributionResult::Consumed
                | ConsumeSenderKeyDistributionResult::Stale => "consumed",
                ConsumeSenderKeyDistributionResult::Failed => "failed",
            };
            api.consume_self_sender_key_sync_distribution(distribution.distribution_id, status)
                .await?;
        }

        let rooms = api.get_rooms().await?;
        let mut all_rooms_unlocked = true;
        for room_id in collect_room_ids_from_sections(&rooms) {
            if should_ignore_sender_key_room(room_id) {
                continue;
            }
            backfill_room_history(app, session, api, participant_id, room_id).await?;
            let room = sync_room(app, session, api, participant_id, room_id, None, None).await?;
            if room.snapshot.direct_key_status != "unlocked" {
                all_rooms_unlocked = false;
            }
        }

        let _ = sync_rooms(app, session, api, participant_id).await?;
        if !all_rooms_unlocked {
            return persist_self_sender_key_sync_snapshot(app, session, snapshot);
        }
        let completed = match api.complete_self_sender_key_sync().await {
            Ok(response) => to_chat_self_sender_key_sync_state(response),
            Err(error) => {
                log::warn!(
                    "chat runtime sync: complete self sender key sync failed, refreshing latest self sync state error={}",
                    error
                );
                to_chat_self_sender_key_sync_state(api.get_self_sender_key_sync().await?)
            }
        };
        persist_self_sender_key_sync_snapshot(app, session, &completed)
    }
    .await;

    if let Err(error) = &result {
        return report_failed_self_sender_key_sync(app, session, api, snapshot, error.clone())
            .await;
    }

    result
}

async fn backfill_room_history(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    participant_id: Option<i64>,
    room_id: i64,
) -> Result<(), String> {
    let initial = sync_room(app, session, api, participant_id, room_id, None, None).await?;
    let mut before_id = oldest_server_message_id(&initial.snapshot);
    let mut has_more = initial.snapshot.has_more;

    while has_more {
        let Some(oldest_message_id) = before_id else {
            break;
        };

        let response = api
            .get_room_messages(room_id, Some(oldest_message_id), Some(100))
            .await?;
        if response.messages.is_empty() {
            break;
        }

        let next_oldest = response
            .messages
            .iter()
            .map(|message| message.message_id)
            .min();
        let messages = decrypt_messages(app, session, api, room_id, response.messages).await?;
        for message in messages {
            store::save_or_update_message(app, session.account_id, room_id, &message)?;
        }

        has_more = response.has_more;
        before_id = next_oldest;
    }

    Ok(())
}

fn oldest_server_message_id(snapshot: &ChatRoomSnapshot) -> Option<i64> {
    snapshot
        .messages
        .iter()
        .filter_map(|message| message.message_id)
        .min()
}

fn collect_room_ids_from_sections(rooms: &crate::chat::api::GetUserRoomsResponse) -> Vec<i64> {
    rooms
        .direct
        .iter()
        .chain(rooms.group.iter())
        .chain(rooms.channel.iter())
        .chain(rooms.bot.iter())
        .map(|room| room.room_id)
        .collect()
}

async fn collect_joined_room_member_ids(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    participant_id: Option<i64>,
    rooms: &crate::chat::api::GetUserRoomsResponse,
) -> Result<Vec<i64>, String> {
    let mut member_ids = HashSet::new();

    for room_id in collect_room_ids_from_sections(rooms) {
        if should_ignore_sender_key_room(room_id) {
            continue;
        }

        if let Some(room) = store::load_room_snapshot(app, session.account_id, room_id, None, None)?
        {
            for member in room.members {
                member_ids.insert(member.member_id);
            }
            continue;
        }

        let detail = api.get_room_detail(room_id).await?;
        let _ = resolve_current_member_id(participant_id, &detail.members);
        for member in detail.members {
            member_ids.insert(member.member_id);
        }
    }

    Ok(member_ids.into_iter().collect())
}

fn requestable_peer_member_ids(status: &GetSenderKeyDistributionStatusResponse) -> HashSet<i64> {
    status
        .requestable_sources
        .iter()
        .map(|entry| entry.member_id)
        .chain(
            status
                .pending_from_sources
                .iter()
                .map(|entry| entry.member_id),
        )
        .collect()
}

fn local_sender_key_state_key(member_id: i64, device_id: &str) -> (i64, String) {
    (member_id, device_id.to_string())
}

fn local_has_sender_key(
    local_states: &LocalSenderKeyStateMap,
    member_id: i64,
    device_id: &str,
) -> bool {
    local_states.contains_key(&local_sender_key_state_key(member_id, device_id))
}

fn local_has_own_current_sender_key(
    local_states: &LocalSenderKeyStateMap,
    current_member_id: i64,
    current_device_id: &str,
) -> bool {
    local_states
        .get(&local_sender_key_state_key(
            current_member_id,
            current_device_id,
        ))
        .map(|state| state.key_scope == "own")
        .unwrap_or(false)
}

fn collect_missing_source_refs(
    status: &GetSenderKeyDistributionStatusResponse,
) -> HashSet<(i64, String)> {
    status
        .requestable_sources
        .iter()
        .chain(status.pending_from_sources.iter())
        .chain(status.available_from_sources.iter())
        .map(|entry| (entry.member_id, entry.device_id.clone()))
        .collect()
}

fn collect_request_sources(
    status: &GetSenderKeyDistributionStatusResponse,
) -> HashSet<(i64, String)> {
    status
        .requestable_sources
        .iter()
        .chain(status.pending_from_sources.iter())
        .map(|entry| (entry.member_id, entry.device_id.clone()))
        .collect()
}

#[cfg(test)]
fn should_request_peer_sender_key(
    member_id: i64,
    has_local_peer_key: bool,
    status: &GetSenderKeyDistributionStatusResponse,
) -> bool {
    if has_local_peer_key {
        return false;
    }
    if available_from_member_ids(status).contains(&member_id) {
        return false;
    }
    requestable_peer_member_ids(status).contains(&member_id)
}

fn available_from_member_ids(status: &GetSenderKeyDistributionStatusResponse) -> HashSet<i64> {
    status
        .available_from_sources
        .iter()
        .map(|entry| entry.member_id)
        .collect()
}

fn pending_from_member_ids(status: &GetSenderKeyDistributionStatusResponse) -> HashSet<i64> {
    status
        .pending_from_sources
        .iter()
        .map(|entry| entry.member_id)
        .collect()
}

fn has_available_target(
    status: &GetSenderKeyDistributionStatusResponse,
    requester_member_id: i64,
    requester_device_id: Option<&str>,
) -> bool {
    status.available_to_targets.iter().any(|entry| {
        entry.member_id == requester_member_id
            && requester_device_id
                .map(|device_id| entry.device_id == device_id)
                .unwrap_or(true)
    })
}

fn has_pending_receiver(
    status: &GetSenderKeyDistributionStatusResponse,
    requester_member_id: i64,
    requester_device_id: Option<&str>,
) -> bool {
    status.pending_receivers.iter().any(|entry| {
        entry.member_id == requester_member_id
            && requester_device_id
                .map(|device_id| entry.device_id == device_id)
                .unwrap_or(true)
    })
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
            "chat runtime sync: consume pending sender key distribution sender_member_id={} receiver_member_id={} distribution_id={} version={}",
            distribution.sender_member_id,
            distribution.receiver_member_id,
            distribution.distribution_id,
            distribution.sender_key_version
        );
        let bytes = STANDARD
            .decode(distribution.distribution_message.as_bytes())
            .map_err(|err| format!("decode sender key distribution message failed: {err}"))?;
        let status = match account_keys::consume_sender_key_distribution_for_member(
            app,
            session.account_id,
            distribution.sender_member_id,
            &distribution.sender_device_id,
            distribution.receiver_member_id,
            &distribution.receiver_device_id,
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

async fn report_failed_self_sender_key_sync(
    app: &tauri::AppHandle,
    session: &ChatRuntimeSession,
    api: &ChatApiClient,
    snapshot: &ChatSelfSenderKeySyncState,
    error: String,
) -> Result<ChatSelfSenderKeySyncState, String> {
    match api
        .fail_self_sender_key_sync(&FailSelfSenderKeySyncRequest {
            last_error: error.clone(),
            retryable: true,
        })
        .await
    {
        Ok(response) => {
            let failed = to_chat_self_sender_key_sync_state(response);
            persist_self_sender_key_sync_snapshot(app, session, &failed)
        }
        Err(report_error) => {
            log::warn!(
                "chat runtime sync: fail self sender key sync reporting failed original_error={} report_error={}",
                error,
                report_error
            );
            if let Ok(latest) = api.get_self_sender_key_sync().await {
                let latest_snapshot = to_chat_self_sender_key_sync_state(latest);
                if latest_snapshot.exists {
                    return persist_self_sender_key_sync_snapshot(app, session, &latest_snapshot);
                }
            }

            let mut local_failed = snapshot.clone();
            local_failed.status = "failed".to_string();
            local_failed.last_error = Some(error);
            persist_self_sender_key_sync_snapshot(app, session, &local_failed)
        }
    }
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
        &members
            .iter()
            .map(|member| member.member_id)
            .collect::<Vec<_>>(),
    )?;
    if !local_has_own_current_sender_key(&local_states, current_member_id, &session.device_id) {
        return Ok(false);
    }

    for (member_id, device_id) in collect_missing_source_refs(status) {
        if member_id == current_member_id && device_id == session.device_id {
            continue;
        }
        if !local_has_sender_key(&local_states, member_id, &device_id) {
            return Ok(false);
        }
    }

    Ok(true)
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
    let bundle = api
        .get_key_bundle(target_user_id, receiver_device_id)
        .await?;
    log::info!(
        "chat runtime sync: fetched key bundle target_user_id={} receiver_member_id={} receiver_device_id={:?}",
        target_user_id,
        receiver_member_id,
        receiver_device_id
    );
    let public_key_bundle = build_public_key_bundle(bundle)?;

    let prepared = account_keys::prepare_sender_key_distribution(
        app,
        session.account_id,
        current_member_id,
        &session.device_id,
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
        is_active_self_sender_key_sync_status, requestable_peer_member_ids,
        self_sender_key_sync_follow_up, sender_key_upload_key, should_block_normal_sender_key_ops,
        should_ignore_sender_key_room, should_request_peer_sender_key, try_begin_sender_key_upload,
        SelfSenderKeySyncFollowUp,
    };
    use crate::chat::{
        api::e2ee::SenderKeyDeviceRefResponse, api::GetSenderKeyDistributionStatusResponse,
        ChatSelfSenderKeySyncState,
    };

    #[test]
    fn requestable_peer_member_ids_includes_explicit_requestable_members() {
        let status = GetSenderKeyDistributionStatusResponse {
            requestable_sources: vec![SenderKeyDeviceRefResponse {
                member_id: 41,
                device_id: "device-41".to_string(),
            }],
            pending_from_sources: vec![],
            ..Default::default()
        };

        let requestable = requestable_peer_member_ids(&status);

        assert!(requestable.contains(&41));
    }

    #[test]
    fn requestable_peer_member_ids_includes_pending_from_members() {
        let status = GetSenderKeyDistributionStatusResponse {
            requestable_sources: vec![],
            pending_from_sources: vec![SenderKeyDeviceRefResponse {
                member_id: 42,
                device_id: "device-42".to_string(),
            }],
            ..Default::default()
        };

        let requestable = requestable_peer_member_ids(&status);

        assert!(requestable.contains(&42));
    }

    #[test]
    fn should_request_peer_sender_key_skips_members_with_local_peer_key_or_available_distribution()
    {
        let status = GetSenderKeyDistributionStatusResponse {
            requestable_sources: vec![
                SenderKeyDeviceRefResponse {
                    member_id: 43,
                    device_id: "device-43".to_string(),
                },
                SenderKeyDeviceRefResponse {
                    member_id: 44,
                    device_id: "device-44".to_string(),
                },
            ],
            available_from_sources: vec![SenderKeyDeviceRefResponse {
                member_id: 44,
                device_id: "device-44".to_string(),
            }],
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

    #[test]
    fn self_sender_key_sync_follow_up_detects_provider_syncing_state() {
        let snapshot = ChatSelfSenderKeySyncState {
            exists: true,
            status: "syncing".to_string(),
            provider_current_device: true,
            ..Default::default()
        };

        assert_eq!(
            self_sender_key_sync_follow_up(&snapshot),
            Some(SelfSenderKeySyncFollowUp::ProviderUpload)
        );
    }

    #[test]
    fn self_sender_key_sync_follow_up_detects_requester_uploaded_state() {
        let snapshot = ChatSelfSenderKeySyncState {
            exists: true,
            status: "uploaded".to_string(),
            requester_current_device: true,
            ..Default::default()
        };

        assert_eq!(
            self_sender_key_sync_follow_up(&snapshot),
            Some(SelfSenderKeySyncFollowUp::RequesterConsume)
        );
    }

    #[test]
    fn self_sender_key_sync_follow_up_ignores_unrelated_states() {
        let snapshot = ChatSelfSenderKeySyncState {
            exists: true,
            status: "syncing".to_string(),
            requester_current_device: true,
            provider_current_device: false,
            ..Default::default()
        };

        assert_eq!(self_sender_key_sync_follow_up(&snapshot), None);
    }

    #[test]
    fn active_self_sender_key_sync_statuses_are_blocking() {
        assert!(is_active_self_sender_key_sync_status("pending_provider"));
        assert!(is_active_self_sender_key_sync_status("syncing"));
        assert!(is_active_self_sender_key_sync_status("uploaded"));
        assert!(!is_active_self_sender_key_sync_status("completed"));
        assert!(!is_active_self_sender_key_sync_status("failed"));
        assert!(!is_active_self_sender_key_sync_status("idle"));
    }

    #[test]
    fn requester_active_self_sync_blocks_normal_sender_key_ops() {
        let snapshot = ChatSelfSenderKeySyncState {
            exists: true,
            status: "uploaded".to_string(),
            requester_current_device: true,
            ..Default::default()
        };

        assert!(should_block_normal_sender_key_ops(&snapshot));
    }

    #[test]
    fn provider_side_self_sync_does_not_block_normal_sender_key_ops() {
        let snapshot = ChatSelfSenderKeySyncState {
            exists: true,
            status: "syncing".to_string(),
            requester_current_device: false,
            provider_current_device: true,
            ..Default::default()
        };

        assert!(!should_block_normal_sender_key_ops(&snapshot));
    }
}
