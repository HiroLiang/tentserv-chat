use crate::crypto::x3dh::{PublicKeyBundle, InitialMessage};
use crate::crypto::x3dh::{x3dh_sender, x3dh_receiver};
use crate::crypto::x3dh::{StaticSecret, PublicKey, SigningKey};
use ed25519_dalek::Signer;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_with::serde_as;

// ── Keyring helpers ────────────────────────────────

fn store_private_key(label: &str, secret: &[u8; 32]) -> Result<(), String> {
    Entry::new("goat-chat", label)
        .map_err(|e| e.to_string())?
        .set_password(&hex::encode(secret))
        .map_err(|e| e.to_string())
}

fn load_private_key(label: &str) -> Result<[u8; 32], String> {
    let hex_str = Entry::new("goat-chat", label)
        .map_err(|e| e.to_string())?
        .get_password()
        .map_err(|e| e.to_string())?;
    let bytes = hex::decode(&hex_str).map_err(|e| e.to_string())?;
    bytes.try_into().map_err(|_| "key is not 32 bytes".into())
}

// ── Return types ───────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct IdentityKeyBundle {
    pub identity_key_dh:   [u8; 32],
    pub identity_key_sign: [u8; 32],
}

#[serde_as]
#[derive(Serialize, Deserialize)]
pub struct SignedPreKeyBundle {
    pub public_key: [u8; 32],
    #[serde_as(as = "serde_with::Bytes")]
    pub signature:  [u8; 64],
    pub key_id:     u32,
}

#[derive(Serialize, Deserialize)]
pub struct OneTimePreKey {
    pub key_id:     u32,
    pub public_key: [u8; 32],
}

// ── Commands ───────────────────────────────────────

#[tauri::command]
pub async fn generate_identity_keys() -> Result<IdentityKeyBundle, String> {
    // X25519 DH identity key
    let dh_secret = StaticSecret::from(rand::random::<[u8; 32]>());
    let dh_public = PublicKey::from(&dh_secret);
    store_private_key("ik_dh", dh_secret.as_bytes())?;

    // Ed25519 signing identity key
    let sign_secret = SigningKey::from_bytes(&rand::random::<[u8; 32]>());
    let sign_public = sign_secret.verifying_key();
    store_private_key("ik_sign", sign_secret.as_bytes())?;

    Ok(IdentityKeyBundle {
        identity_key_dh:   dh_public.to_bytes(),
        identity_key_sign: sign_public.to_bytes(),
    })
}

#[tauri::command]
pub async fn generate_signed_pre_key(key_id: u32) -> Result<SignedPreKeyBundle, String> {
    // Generate X25519 SPK
    let spk_secret = StaticSecret::from(rand::random::<[u8; 32]>());
    let spk_public = PublicKey::from(&spk_secret);

    // Load Ed25519 signing key to sign the SPK public key
    let sign_bytes = load_private_key("ik_sign")?;
    let sign_secret = SigningKey::from_bytes(&sign_bytes);
    let signature = sign_secret.sign(spk_public.as_bytes());

    // Store SPK private key
    store_private_key(&format!("spk_{key_id}"), spk_secret.as_bytes())?;

    Ok(SignedPreKeyBundle {
        public_key: spk_public.to_bytes(),
        signature:  signature.to_bytes(),
        key_id,
    })
}

#[tauri::command]
pub async fn generate_one_time_pre_keys(key_ids: Vec<u32>) -> Result<Vec<OneTimePreKey>, String> {
    let mut result = Vec::with_capacity(key_ids.len());
    for key_id in key_ids {
        let opk_secret = StaticSecret::from(rand::random::<[u8; 32]>());
        let opk_public = PublicKey::from(&opk_secret);
        store_private_key(&format!("opk_{key_id}"), opk_secret.as_bytes())?;
        result.push(OneTimePreKey {
            key_id,
            public_key: opk_public.to_bytes(),
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn perform_x3dh_send(
    bundle:    PublicKeyBundle,
    plaintext: Vec<u8>,
) -> Result<InitialMessage, String> {
    let ik_dh_bytes   = load_private_key("ik_dh")?;
    let ik_sign_bytes = load_private_key("ik_sign")?;
    let ik_dh   = StaticSecret::from(ik_dh_bytes);
    let ik_sign = SigningKey::from_bytes(&ik_sign_bytes);
    x3dh_sender(&ik_dh, &ik_sign, &bundle, &plaintext)
}

#[tauri::command]
pub async fn perform_x3dh_receive(
    msg:        InitialMessage,
    spk_key_id: u32,
    otpk_key_id: Option<u32>,
) -> Result<Vec<u8>, String> {
    let ik  = StaticSecret::from(load_private_key("ik_dh")?);
    let spk = StaticSecret::from(load_private_key(&format!("spk_{spk_key_id}"))?);
    let opk = otpk_key_id
        .map(|id| load_private_key(&format!("opk_{id}")))
        .transpose()?
        .map(StaticSecret::from);
    x3dh_receiver(&ik, &spk, opk.as_ref(), &msg)
}
