use serde::{Deserialize, Serialize};

use super::ChatApiClient;

impl ChatApiClient {
    pub async fn get_key_policy(&self) -> Result<GetKeyPolicyResponse, String> {
        self.client
            .get(self.url("/api/e2ee/key-policy"))
            .send()
            .await
            .map_err(|err| format!("request key policy failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("key policy returned error: {err}"))?
            .json::<GetKeyPolicyResponse>()
            .await
            .map_err(|err| format!("decode key policy failed: {err}"))
    }

    pub async fn count_otp_prekeys(
        &self,
        device_id: &str,
    ) -> Result<CountOTPPreKeysResponse, String> {
        self.client
            .get(self.url(&format!("/api/e2ee/otp-prekeys/count?device_id={device_id}")))
            .send()
            .await
            .map_err(|err| format!("request otp count failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("otp count returned error: {err}"))?
            .json::<CountOTPPreKeysResponse>()
            .await
            .map_err(|err| format!("decode otp count failed: {err}"))
    }

    pub async fn upload_otp_prekeys(
        &self,
        request: &UploadOTPPreKeysRequest,
    ) -> Result<UploadOTPPreKeysResponse, String> {
        self.client
            .post(self.url("/api/e2ee/otp-prekeys"))
            .json(request)
            .send()
            .await
            .map_err(|err| format!("request upload otp prekeys failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("upload otp prekeys returned error: {err}"))?
            .json::<UploadOTPPreKeysResponse>()
            .await
            .map_err(|err| format!("decode upload otp prekeys failed: {err}"))
    }

    pub async fn get_sender_key_distribution_status(
        &self,
        room_id: i64,
    ) -> Result<GetSenderKeyDistributionStatusResponse, String> {
        log::info!("chat runtime: fetch sender key distribution status room_id={room_id}");
        self.client
            .get(self.url(&format!("/api/e2ee/sender-key-distributions/{room_id}")))
            .send()
            .await
            .map_err(|err| format!("request sender key distribution status failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("sender key distribution status returned error: {err}"))?
            .json::<GetSenderKeyDistributionStatusResponse>()
            .await
            .map_err(|err| format!("decode sender key distribution status failed: {err}"))
    }

    pub async fn get_pending_sender_key_distributions(
        &self,
        room_id: i64,
    ) -> Result<GetPendingSenderKeyDistributionsResponse, String> {
        log::info!("chat runtime: fetch pending sender key distributions room_id={room_id}");
        self.client
            .get(self.url(&format!(
                "/api/e2ee/sender-key-distributions/{room_id}/pending"
            )))
            .send()
            .await
            .map_err(|err| format!("request pending sender key distributions failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("pending sender key distributions returned error: {err}"))?
            .json::<GetPendingSenderKeyDistributionsResponse>()
            .await
            .map_err(|err| format!("decode pending sender key distributions failed: {err}"))
    }

    pub async fn create_sender_key_request(
        &self,
        request: &CreateSenderKeyRequestRequest,
    ) -> Result<(), String> {
        log::info!(
            "chat runtime: create sender key request room_id={} provider_member_id={}",
            request.room_id,
            request.provider_member_id
        );
        self.client
            .post(self.url("/api/e2ee/sender-key-request"))
            .json(request)
            .send()
            .await
            .map_err(|err| format!("request create sender key request failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("create sender key request returned error: {err}"))?;
        Ok(())
    }

    pub async fn get_key_bundle(
        &self,
        user_id: i64,
        device_id: Option<&str>,
    ) -> Result<GetKeyBundleResponse, String> {
        let mut path = format!("/api/e2ee/key-bundle/{user_id}");
        if let Some(device_id) = device_id {
            path = format!("{path}?device_id={device_id}");
        }

        self.client
            .get(self.url(&path))
            .send()
            .await
            .map_err(|err| format!("request key bundle failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("key bundle returned error: {err}"))?
            .json::<GetKeyBundleResponse>()
            .await
            .map_err(|err| format!("decode key bundle failed: {err}"))
    }

    pub async fn upload_sender_key(&self, request: &UploadSenderKeyRequest) -> Result<(), String> {
        log::info!(
            "chat runtime: upload sender key room_id={} receiver_member_id={} receiver_device_id={:?}",
            request.room_id,
            request.receiver_member_id,
            request.receiver_device_id
        );
        self.client
            .post(self.url("/api/e2ee/sender-key"))
            .json(request)
            .send()
            .await
            .map_err(|err| format!("request upload sender key failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("upload sender key returned error: {err}"))?;
        Ok(())
    }

    pub async fn consume_sender_key_distribution(
        &self,
        distribution_id: i64,
        status: &str,
    ) -> Result<(), String> {
        log::info!(
            "chat runtime: consume sender key distribution distribution_id={} status={}",
            distribution_id,
            status
        );
        self.client
            .post(self.url(&format!(
                "/api/e2ee/sender-key-distributions/{distribution_id}/consume"
            )))
            .json(&ConsumeSenderKeyDistributionRequest {
                status: status.to_string(),
            })
            .send()
            .await
            .map_err(|err| format!("request consume sender key distribution failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("consume sender key distribution returned error: {err}"))?;
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetKeyPolicyResponse {
    pub otp_prekey_target_count: i32,
    pub otp_prekey_replenish_threshold: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CountOTPPreKeysResponse {
    pub count: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct UploadOTPPreKeysRequest {
    pub device_id: String,
    pub keys: Vec<OTPPreKeyItemRequest>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OTPPreKeyItemRequest {
    pub key_id: u32,
    pub public_key: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct UploadOTPPreKeysResponse {
    pub count: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetKeyBundleResponse {
    pub identity_key: String,
    pub identity_key_sign: String,
    pub signed_pre_key: String,
    pub spk_signature: String,
    pub spk_key_id: u32,
    pub otp_pre_key: Option<String>,
    pub otp_pre_key_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UploadSenderKeyRequest {
    pub room_id: i64,
    pub receiver_member_id: i64,
    pub sender_key_version: i64,
    pub distribution_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CreateSenderKeyRequestRequest {
    pub room_id: i64,
    pub provider_member_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requester_device_id: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize, Default)]
pub struct GetSenderKeyDistributionStatusResponse {
    pub own_sender_key_exists: bool,
    pub requestable_member_ids: Vec<i64>,
    pub available_from_member_ids: Vec<i64>,
    pub available_to_member_ids: Vec<i64>,
    pub pending_receivers: Vec<i64>,
    pub pending_from_members: Vec<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetPendingSenderKeyDistributionsResponse {
    pub distributions: Vec<PendingSenderKeyDistributionItemResponse>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct PendingSenderKeyDistributionItemResponse {
    pub distribution_id: i64,
    pub sender_member_id: i64,
    pub receiver_member_id: i64,
    pub sender_key_version: i64,
    pub distribution_message: String,
    pub receiver_device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConsumeSenderKeyDistributionRequest {
    pub status: String,
}
