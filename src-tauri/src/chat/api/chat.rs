use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use super::ChatApiClient;

impl ChatApiClient {
    pub async fn ensure_participant(&self) -> Result<ParticipantResponse, String> {
        log::info!("chat runtime: ensure participant");
        match self.get_participant().await {
            Ok(participant) => {
                log::info!(
                    "chat runtime: participant already exists id={}",
                    participant.id
                );
                Ok(participant)
            }
            Err(err) if err.contains("404") => {
                log::warn!("chat runtime: participant missing, registering a new participant");
                self.register_participant().await
            }
            Err(err) => Err(err),
        }
    }

    pub async fn get_participant(&self) -> Result<ParticipantResponse, String> {
        self.client
            .get(self.url("/api/participant/me"))
            .send()
            .await
            .map_err(|err| format!("request participant me failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("participant me returned error: {err}"))?
            .json::<ParticipantResponse>()
            .await
            .map_err(|err| format!("decode participant me failed: {err}"))
    }

    pub async fn register_participant(&self) -> Result<ParticipantResponse, String> {
        self.client
            .post(self.url("/api/participant/user"))
            .send()
            .await
            .map_err(|err| format!("request participant register failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("participant register returned error: {err}"))?
            .json::<ParticipantResponse>()
            .await
            .map_err(|err| format!("decode participant register failed: {err}"))
    }

    pub async fn get_rooms(&self) -> Result<GetUserRoomsResponse, String> {
        log::info!("chat runtime: fetch room summaries");
        self.client
            .get(self.url("/api/chat/rooms"))
            .send()
            .await
            .map_err(|err| format!("request get rooms failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("get rooms returned error: {err}"))?
            .json::<GetUserRoomsResponse>()
            .await
            .map_err(|err| format!("decode get rooms failed: {err}"))
    }

    pub async fn get_room_detail(&self, room_id: i64) -> Result<RoomDetailResponse, String> {
        log::info!("chat runtime: fetch room detail room_id={room_id}");
        self.client
            .get(self.url(&format!("/api/chat/room/{room_id}")))
            .send()
            .await
            .map_err(|err| format!("request get room detail failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("get room detail returned error: {err}"))?
            .json::<RoomDetailResponse>()
            .await
            .map_err(|err| format!("decode room detail failed: {err}"))
    }

    pub async fn get_room_messages(
        &self,
        room_id: i64,
        before_id: Option<i64>,
        limit: Option<u32>,
    ) -> Result<GetMessagesResponse, String> {
        let mut request = self
            .client
            .get(self.url(&format!("/api/chat/room/{room_id}/messages")));
        if let Some(before_id) = before_id {
            request = request.query(&[("before_id", before_id)]);
        }
        if let Some(limit) = limit {
            request = request.query(&[("limit", limit)]);
        }

        request
            .send()
            .await
            .map_err(|err| format!("request get room messages failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("get room messages returned error: {err}"))?
            .json::<GetMessagesResponse>()
            .await
            .map_err(|err| format!("decode get room messages failed: {err}"))
    }

    pub async fn get_my_room_invitation(
        &self,
        room_id: i64,
    ) -> Result<GetMyRoomInvitationResponse, String> {
        let response = self
            .client
            .get(self.url(&format!("/api/chat/room/{room_id}/my-invitation")))
            .send()
            .await
            .map_err(|err| format!("request room invitation failed: {err}"))?;

        if response.status() == StatusCode::NOT_FOUND {
            return Ok(GetMyRoomInvitationResponse {
                found: false,
                ..Default::default()
            });
        }

        response
            .error_for_status()
            .map_err(|err| format!("room invitation returned error: {err}"))?
            .json::<GetMyRoomInvitationResponse>()
            .await
            .map_err(|err| format!("decode room invitation failed: {err}"))
    }

    pub async fn send_message(
        &self,
        room_id: i64,
        request: &SendMessageRequest,
    ) -> Result<SendMessageResponse, String> {
        log::info!(
            "chat runtime: send message room_id={} type={}",
            room_id,
            request.message_type
        );
        self.client
            .post(self.url(&format!("/api/chat/room/{room_id}/messages")))
            .json(request)
            .send()
            .await
            .map_err(|err| format!("request send message failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("send message returned error: {err}"))?
            .json::<SendMessageResponse>()
            .await
            .map_err(|err| format!("decode send message failed: {err}"))
    }

    pub async fn mark_room_read(&self, room_id: i64) -> Result<UpdateMemberStatusResponse, String> {
        self.client
            .patch(self.url(&format!("/api/chat/room/{room_id}/member/status")))
            .send()
            .await
            .map_err(|err| format!("request mark room read failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("mark room read returned error: {err}"))?
            .json::<UpdateMemberStatusResponse>()
            .await
            .map_err(|err| format!("decode mark room read failed: {err}"))
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct ParticipantResponse {
    pub id: i64,
    pub user_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetUserRoomsResponse {
    pub direct: Vec<RoomSummaryResponse>,
    pub group: Vec<RoomSummaryResponse>,
    pub channel: Vec<RoomSummaryResponse>,
    pub bot: Vec<RoomSummaryResponse>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RoomSummaryResponse {
    pub room_id: i64,
    pub room_type: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub peer_user_id: Option<i64>,
    pub presence_status: Option<String>,
    pub last_seen_at: Option<String>,
    pub status: Option<String>,
    pub latest_message: Option<String>,
    pub latest_message_id: Option<i64>,
    pub latest_message_created_at: Option<String>,
    pub latest_message_sender_id: Option<i64>,
    pub latest_message_sender_device_id: Option<String>,
    pub latest_message_sender_key_version: Option<i64>,
    pub unread_count: i64,
    pub blocked_by_peer: Option<bool>,
    pub blocked_by_me: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RoomDetailResponse {
    pub room_id: i64,
    pub room_type: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar_url: Option<String>,
    pub blocked_by_peer: Option<bool>,
    pub blocked_by_me: Option<bool>,
    pub status: Option<String>,
    pub members: Vec<RoomMemberResponse>,
    pub messages: Vec<MessageResponse>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RoomMemberResponse {
    pub member_id: i64,
    pub participant_id: i64,
    pub user_id: Option<i64>,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub role: String,
    pub last_read_at: Option<String>,
    pub joined_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MessageResponse {
    pub message_id: i64,
    pub sender_id: i64,
    pub sender_device_id: String,
    pub sender_key_version: i64,
    pub content: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub reply_to_id: Option<i64>,
    pub is_edited: bool,
    pub is_deleted: Option<bool>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetMessagesResponse {
    pub messages: Vec<MessageResponse>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct GetMyRoomInvitationResponse {
    pub found: bool,
    pub invitation_id: Option<i64>,
    pub role: Option<String>,
    pub inviter_name: Option<String>,
    pub inviter_avatar: Option<String>,
    pub inviter_user_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SendMessageRequest {
    #[serde(rename = "type")]
    pub message_type: String,
    pub content: String,
    pub reply_to_id: Option<i64>,
    pub sender_key_version: i64,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct SendMessageResponse {
    pub message_id: i64,
    pub sender_id: i64,
    #[serde(rename = "type")]
    pub message_type: String,
    pub content: String,
    pub reply_to_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateMemberStatusResponse {
    pub members: Vec<MemberStatusInfoResponse>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MemberStatusInfoResponse {
    pub member_id: i64,
    pub last_read_at: Option<String>,
}
