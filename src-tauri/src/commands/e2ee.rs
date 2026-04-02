use crate::crypto::x3dh::{PublicKeyBundle, InitialMessage};
use crate::crypto::x3dh::{x3dh_sender, x3dh_receiver};
use crate::crypto::x3dh::{StaticSecret, PublicKey, SigningKey};
use crate::store::resource_store::{store_private_key, load_private_key, delete_private_key, has_private_key, clear_private_keys, next_opk_ids};
use ed25519_dalek::Signer;
use serde::{Deserialize, Serialize};
use serde_with::serde_as;
use tauri_plugin_store::StoreExt;

// ── Return types ───────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct IdentityKeyBundle {
    pub identity_key_dh_pub:   [u8; 32],
    pub identity_key_sign_pub: [u8; 32],
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
pub async fn generate_identity_keys(app: tauri::AppHandle) -> Result<IdentityKeyBundle, String> {
    let dh_secret = StaticSecret::from(rand::random::<[u8; 32]>());
    let dh_public = PublicKey::from(&dh_secret);
    store_private_key(&app, "ik_dh", dh_secret.as_bytes())?;

    let sign_secret = SigningKey::from_bytes(&rand::random::<[u8; 32]>());
    let sign_public = sign_secret.verifying_key();
    store_private_key(&app, "ik_sign", sign_secret.as_bytes())?;

    Ok(IdentityKeyBundle {
        identity_key_dh_pub: dh_public.to_bytes(),
        identity_key_sign_pub: sign_public.to_bytes(),
    })
}

// #[tauri::command]
// pub async fn generate_identity_keys() -> Result<IdentityKeyBundle, String> {
//     // X25519 DH identity key
//     let dh_secret = StaticSecret::from(rand::random::<[u8; 32]>());
//     let dh_public = PublicKey::from(&dh_secret);
//     store_private_key("ik_dh", dh_secret.as_bytes())?;
//
//     // Ed25519 signing identity key
//     let sign_secret = SigningKey::from_bytes(&rand::random::<[u8; 32]>());
//     let sign_public = sign_secret.verifying_key();
//     store_private_key("ik_sign", sign_secret.as_bytes())?;
//
//     Ok(IdentityKeyBundle {
//         identity_key_dh_pub:   dh_public.to_bytes(),
//         identity_key_sign_pub: sign_public.to_bytes(),
//     })
// }

#[tauri::command]
pub async fn generate_signed_pre_key(
    app: tauri::AppHandle,
    key_id: u32,
) -> Result<SignedPreKeyBundle, String> {
    let spk_secret = StaticSecret::from(rand::random::<[u8; 32]>());
    let spk_public = PublicKey::from(&spk_secret);

    let sign_bytes = load_private_key(&app, "ik_sign")?;
    let sign_secret = SigningKey::from_bytes(&sign_bytes);
    let signature = sign_secret.sign(spk_public.as_bytes());

    store_private_key(&app, &format!("spk_{key_id}"), spk_secret.as_bytes())?;

    Ok(SignedPreKeyBundle {
        public_key: spk_public.to_bytes(),
        signature: signature.to_bytes(),
        key_id,
    })
}

#[tauri::command]
pub async fn replenish_otp_keys(
    app: tauri::AppHandle,
    count: u32,
) -> Result<Vec<OneTimePreKey>, String> {
    let ids = next_opk_ids(&app, count)?;

    let mut result = Vec::with_capacity(ids.len());

    for key_id in ids {
        let opk_secret = StaticSecret::from(rand::random::<[u8; 32]>());
        let opk_public = PublicKey::from(&opk_secret);

        store_private_key(
            &app,
            &format!("opk_{key_id}"),
            opk_secret.as_bytes(),
        )?;

        result.push(OneTimePreKey {
            key_id,
            public_key: opk_public.to_bytes(),
        });
    }

    Ok(result)
}

#[tauri::command]
pub fn clear_e2ee_keys(app: tauri::AppHandle) -> Result<(), String> {
    clear_private_keys(&app)?;

    let store = app.store("store.json").map_err(|e| e.to_string())?;
    store.clear();
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn perform_x3dh_send(
    app: tauri::AppHandle,
    bundle: PublicKeyBundle,
    plaintext: Vec<u8>,
) -> Result<InitialMessage, String> {
    let ik_dh_bytes = load_private_key(&app, "ik_dh")?;
    let ik_sign_bytes = load_private_key(&app, "ik_sign")?;

    let ik_dh = StaticSecret::from(ik_dh_bytes);
    let ik_sign = SigningKey::from_bytes(&ik_sign_bytes);

    x3dh_sender(&ik_dh, &ik_sign, &bundle, &plaintext)
}

#[tauri::command]
pub async fn perform_x3dh_receive(
    app: tauri::AppHandle,
    msg: InitialMessage,
    spk_key_id: u32,
    otpk_key_id: Option<u32>,
) -> Result<Vec<u8>, String> {
    let ik = StaticSecret::from(load_private_key(&app, "ik_dh")?);
    let spk = StaticSecret::from(
        load_private_key(&app, &format!("spk_{spk_key_id}"))?
    );

    let opk = otpk_key_id
        .map(|id| load_private_key(&app, &format!("opk_{id}")))
        .transpose()?
        .map(StaticSecret::from);

    let plaintext = x3dh_receiver(&ik, &spk, opk.as_ref(), &msg)?;

    if let Some(id) = otpk_key_id {
        let _ = delete_private_key(&app, &format!("opk_{id}"));
    }

    Ok(plaintext)
}

#[tauri::command]
pub fn has_identity_keys(app: tauri::AppHandle) -> Result<bool, String> {
    let has_dh = has_private_key(&app, "ik_dh")?;
    let has_sign = has_private_key(&app, "ik_sign")?;
    Ok(has_dh && has_sign)
}

#[derive(Serialize, Deserialize)]
pub struct SenderKeyBundle {
    pub public_key: [u8; 32],
}

#[tauri::command]
pub async fn generate_sender_key(
    app: tauri::AppHandle,
    room_id: u32,
) -> Result<SenderKeyBundle, String> {
    let sk_secret = StaticSecret::from(rand::random::<[u8; 32]>());
    let sk_public = PublicKey::from(&sk_secret);
    store_private_key(&app, &format!("sk_{room_id}"), sk_secret.as_bytes())?;
    Ok(SenderKeyBundle { public_key: sk_public.to_bytes() })
}

#[derive(Serialize)]
pub struct SenderKeyEncryptedMessage {
    pub ciphertext: Vec<u8>,
    pub nonce: [u8; 12],
}

#[tauri::command]
pub async fn encrypt_with_sender_key(
    app: tauri::AppHandle,
    room_id: u32,
    plaintext: Vec<u8>,
) -> Result<SenderKeyEncryptedMessage, String> {
    use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead};

    let sk_bytes = load_private_key(&app, &format!("sk_{room_id}"))?;
    let cipher = Aes256Gcm::new_from_slice(&sk_bytes)
        .map_err(|e| format!("Invalid sender key: {e}"))?;

    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = aes_gcm::Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| format!("Encryption failed: {e}"))?;

    Ok(SenderKeyEncryptedMessage { ciphertext, nonce: nonce_bytes })
}

