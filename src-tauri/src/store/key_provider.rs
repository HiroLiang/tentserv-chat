//! # Key Provider
//!
//! Local file-based storage for the per-account AES-256 master key and the
//! current-account pointer.  Replaces OS keyring to ensure reliable
//! read-after-write in development and unsigned builds (macOS 15+ unsigned
//! binaries cannot reliably read keychain entries written by the same process).
//!
//! ## Storage layout
//!
//! ```text
//! {app_data_dir}/
//!   keys/
//!     mk_{account_id}    ← hex-encoded 32-byte master key; permissions 0600 on Unix
//!     current_account    ← plain UTF-8 account ID string
//! ```
//!
//! ## Future replacement
//!
//! All master-key and current-account I/O goes through [`LocalKeyStore`].
//! To swap to OS keyring or another backend, create an alternative struct with
//! the same public(crate) methods and update `store/db.rs` and
//! `commands/auth.rs` to construct it instead.

use std::fs;
use std::path::PathBuf;
use tauri::Manager;

pub(crate) struct LocalKeyStore {
    dir: PathBuf,
}

impl LocalKeyStore {
    /// Construct using the Tauri application data directory.
    /// Creates `{app_data_dir}/keys/` if it does not exist.
    pub(crate) fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("app_data_dir failed: {e}"))?
            .join("keys");
        fs::create_dir_all(&dir).map_err(|e| format!("create keys dir failed: {e}"))?;
        Ok(Self { dir })
    }

    /// Construct from an explicit directory path.
    /// Creates the directory if it does not exist.
    /// Intended for unit tests where no `AppHandle` is available.
    #[cfg(test)]
    pub(crate) fn from_dir(dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&dir).map_err(|e| format!("create keys dir failed: {e}"))?;
        Ok(Self { dir })
    }

    // ── Master key ──────────────────────────────────────────────────

    /// Read or create the 32-byte master key for `account_id`.
    ///
    /// On first call the key is generated, written to `keys/mk_{account_id}`,
    /// and returned.  On subsequent calls the persisted key is returned unchanged.
    pub(crate) fn get_or_create_master_key(&self, account_id: &str) -> Result<[u8; 32], String> {
        let path = self.master_key_path(account_id)?;
        match fs::read(&path) {
            Ok(bytes) => {
                let hex = String::from_utf8(bytes)
                    .map_err(|e| format!("master key file is not valid UTF-8: {e}"))?;
                let decoded = hex::decode(hex.trim())
                    .map_err(|e| format!("master key file is not valid hex: {e}"))?;
                decoded
                    .try_into()
                    .map_err(|_| "master key file has wrong length (expected 32 bytes)".into())
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                use rand::RngExt;
                let mut key = [0u8; 32];
                rand::rng().fill(&mut key);
                self.write_key_file(&path, hex::encode(key).as_bytes())?;
                Ok(key)
            }
            Err(e) => Err(format!(
                "master key read failed for account '{account_id}': {e}"
            )),
        }
    }

    /// Confirm the master key file for `account_id` exists and contains a
    /// valid 32-byte hex-encoded key.  Does not create a new key.
    pub(crate) fn validate_master_key(&self, account_id: &str) -> Result<(), String> {
        let path = self.master_key_path(account_id)?;
        let bytes = fs::read(&path)
            .map_err(|_| format!("master key file not found for account '{account_id}'"))?;
        let hex = String::from_utf8(bytes)
            .map_err(|e| format!("master key file is not valid UTF-8: {e}"))?;
        let decoded = hex::decode(hex.trim())
            .map_err(|e| format!("master key for '{account_id}' is not valid hex: {e}"))?;
        if decoded.len() != 32 {
            return Err(format!(
                "master key for '{account_id}' has length {}, expected 32",
                decoded.len()
            ));
        }
        Ok(())
    }

    // ── Current account pointer ─────────────────────────────────────

    /// Return the stored current account ID, or `None` if no account is active.
    pub(crate) fn get_current_account(&self) -> Result<Option<String>, String> {
        let path = self.dir.join("current_account");
        match fs::read_to_string(&path) {
            Ok(s) => {
                let trimmed = s.trim().to_string();
                if trimmed.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(trimmed))
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("current_account read failed: {e}")),
        }
    }

    /// Write `account_id` as the active current account.
    pub(crate) fn set_current_account(&self, account_id: &str) -> Result<(), String> {
        let path = self.dir.join("current_account");
        fs::write(&path, account_id.as_bytes())
            .map_err(|e| format!("current_account write failed: {e}"))
    }

    /// Remove the current-account pointer file.  No-op if the file does not exist.
    pub(crate) fn delete_current_account(&self) -> Result<(), String> {
        let path = self.dir.join("current_account");
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("delete current_account failed: {e}")),
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /// Build the file path for the master key of `account_id`.
    ///
    /// Only alphanumeric characters, underscores, and hyphens are allowed to
    /// prevent path traversal attacks.
    fn master_key_path(&self, account_id: &str) -> Result<PathBuf, String> {
        if account_id.is_empty()
            || !account_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Err(format!(
                "invalid account_id '{account_id}': must contain only alphanumeric characters, underscores, or hyphens"
            ));
        }
        Ok(self.dir.join(format!("mk_{account_id}")))
    }

    /// Write `data` to `path` and restrict permissions to owner-read/write on Unix.
    fn write_key_file(&self, path: &PathBuf, data: &[u8]) -> Result<(), String> {
        fs::write(path, data).map_err(|e| format!("key file write failed: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("set key file permissions failed: {e}"))?;
        }
        Ok(())
    }
}
