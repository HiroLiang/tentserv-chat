use keyring::Entry;

fn auth_entry() -> Result<Entry, String> {
    Entry::new("goat-chat", "auth_token").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_auth_token() -> Result<Option<String>, String> {
    match auth_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(_) => Ok(None), // not found is not an error
    }
}

#[tauri::command]
pub async fn save_auth_token(token: String) -> Result<(), String> {
    auth_entry()?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_auth_token() -> Result<(), String> {
    match auth_entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(_) => Ok(()), // not found is not an error
    }
}
