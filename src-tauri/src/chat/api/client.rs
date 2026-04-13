use reqwest::{header, Client};

use crate::chat::ChatRuntimeSession;

#[derive(Debug, Clone)]
pub struct ChatApiClient {
    pub(super) client: Client,
    pub(super) api_base_url: String,
}

impl ChatApiClient {
    pub fn new(session: &ChatRuntimeSession) -> Result<Self, String> {
        let mut headers = header::HeaderMap::new();
        let auth_value = header::HeaderValue::from_str(&format!("Bearer {}", session.token))
            .map_err(|err| format!("build auth header failed: {err}"))?;
        let device_value = header::HeaderValue::from_str(&session.device_id)
            .map_err(|err| format!("build device header failed: {err}"))?;
        headers.insert(header::AUTHORIZATION, auth_value);
        headers.insert("X-Device-ID", device_value);

        let client = Client::builder()
            .default_headers(headers)
            .build()
            .map_err(|err| format!("build chat api client failed: {err}"))?;

        Ok(Self {
            client,
            api_base_url: session.api_base_url.trim_end_matches('/').to_string(),
        })
    }

    pub(super) fn url(&self, path: &str) -> String {
        format!("{}{}", self.api_base_url, path)
    }
}
