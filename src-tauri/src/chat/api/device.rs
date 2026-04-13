use serde::Deserialize;

use super::ChatApiClient;

impl ChatApiClient {
    pub async fn list_devices(&self) -> Result<ListDevicesResponse, String> {
        log::info!("chat runtime: list devices");
        self.client
            .get(self.url("/api/device"))
            .send()
            .await
            .map_err(|err| format!("request list devices failed: {err}"))?
            .error_for_status()
            .map_err(|err| format!("list devices returned error: {err}"))?
            .json::<ListDevicesResponse>()
            .await
            .map_err(|err| format!("decode list devices failed: {err}"))
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct ListDevicesResponse {
    pub success: bool,
    pub devices: Vec<DeviceListItem>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct DeviceListItem {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub created_at: String,
}
