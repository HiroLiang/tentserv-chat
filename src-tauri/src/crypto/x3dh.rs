use serde::{Deserialize, Serialize};
pub(crate) use x25519_dalek::{PublicKey, StaticSecret};
pub(crate) use ed25519_dalek::SigningKey;
use ed25519_dalek::{VerifyingKey, Signature, Verifier};
use hkdf::Hkdf;
use sha2::Sha256;
use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead};
use serde_with::serde_as;
use zeroize::Zeroizing;

// ── Types ──────────────────────────────────────────

#[serde_as]
#[derive(Serialize, Deserialize)]
pub struct PublicKeyBundle {
    pub identity_key_dh:   [u8; 32],  // X25519 public key (for DH2)
    pub identity_key_sign: [u8; 32],  // Ed25519 verifying key (for SPK sig verification)
    pub signed_pre_key:    [u8; 32],  // X25519 public key (for DH1, DH3)
    #[serde_as(as = "serde_with::Bytes")]
    pub spk_signature:     [u8; 64],  // Ed25519 signature over signed_pre_key
    pub spk_key_id:        u32,
    pub one_time_pre_key:  Option<[u8; 32]>,
    pub otpk_key_id:       Option<u32>,
}

#[serde_as]
#[derive(Serialize, Deserialize)]
pub struct InitialMessage {
    pub identity_key_dh_pub:   [u8; 32],  // Alice IK (X25519)
    pub identity_key_sign_pub: [u8; 32],  // Alice IK (Ed25519)
    pub ephemeral_key_pub:     [u8; 32],  // EK_A pub
    pub spk_key_id:            u32,
    pub otpk_key_id:           Option<u32>,
    pub ciphertext:            Vec<u8>,   // AES-256-GCM
    pub nonce:                 [u8; 12],
}

// ── HKDF helper (Signal X3DH spec) ────────────────

fn derive_session_key(dh_outputs: &[&[u8; 32]]) -> Zeroizing<[u8; 32]> {
    let salt = [0u8; 32];
    let mut ikm: Zeroizing<Vec<u8>> = Zeroizing::new(vec![0xFF; 32]);
    for dh in dh_outputs {
        ikm.extend_from_slice(*dh);
    }
    let hk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
    let mut sk = Zeroizing::new([0u8; 32]);
    hk.expand(b"X3DH", sk.as_mut()).unwrap();
    sk
}

// ── Alice Side: Build session ──────────────────────────

pub fn x3dh_sender(
    ik_a_dh_secret:   &StaticSecret,  // Alice X25519 identity secret
    ik_a_sign_secret: &SigningKey,    // Alice Ed25519 signing key (for identity_key_sign_pub)
    bob_bundle:       &PublicKeyBundle,
    plaintext:        &[u8],
) -> Result<InitialMessage, String> {

    // 1. Verify SPK signature (防中間人替換)
    let bob_ik_verify = VerifyingKey::from_bytes(&bob_bundle.identity_key_sign)
        .map_err(|e| e.to_string())?;
    let spk_sig = Signature::from_bytes(&bob_bundle.spk_signature);
    bob_ik_verify
        .verify(&bob_bundle.signed_pre_key, &spk_sig)
        .map_err(|_| "SPK signature verification failed".to_string())?;

    // 2. Generate Ephemeral Key (StaticSecret so we can call DH multiple times)
    let ek_a_secret = StaticSecret::from(rand::random::<[u8; 32]>());
    let ek_a_pub    = PublicKey::from(&ek_a_secret);

    let bob_ik_dh = PublicKey::from(bob_bundle.identity_key_dh);
    let bob_spk   = PublicKey::from(bob_bundle.signed_pre_key);

    // 3. Four DH operations
    let ik_a_dh_pub = PublicKey::from(ik_a_dh_secret);
    let dh1 = ik_a_dh_secret.diffie_hellman(&bob_spk);    // DH(IK_A, SPK_B)
    let dh2 = ek_a_secret.diffie_hellman(&bob_ik_dh);     // DH(EK_A, IK_B)
    let dh3 = ek_a_secret.diffie_hellman(&bob_spk);        // DH(EK_A, SPK_B)

    let sk = if let Some(otpk_bytes) = bob_bundle.one_time_pre_key {
        let bob_opk = PublicKey::from(otpk_bytes);
        let dh4 = ek_a_secret.diffie_hellman(&bob_opk);    // DH(EK_A, OPK_B)
        derive_session_key(&[dh1.as_bytes(), dh2.as_bytes(), dh3.as_bytes(), dh4.as_bytes()])
    } else {
        derive_session_key(&[dh1.as_bytes(), dh2.as_bytes(), dh3.as_bytes()])
    };

    // 4. AES-256-GCM encrypt
    let cipher = Aes256Gcm::new_from_slice(&*sk).unwrap();
    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = aes_gcm::Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, plaintext)
        .map_err(|e| e.to_string())?;

    Ok(InitialMessage {
        identity_key_dh_pub:   ik_a_dh_pub.to_bytes(),
        identity_key_sign_pub: ik_a_sign_secret.verifying_key().to_bytes(),
        ephemeral_key_pub:     ek_a_pub.to_bytes(),
        spk_key_id:            bob_bundle.spk_key_id,
        otpk_key_id:           bob_bundle.otpk_key_id,
        ciphertext,
        nonce: nonce_bytes,
    })
}

// ── Bob Side: Reproduce session, decrypt ──────────────────────

pub fn x3dh_receiver(
    ik_b_secret:  &StaticSecret,
    spk_b_secret: &StaticSecret,
    opk_b_secret: Option<&StaticSecret>,
    msg:          &InitialMessage,
) -> Result<Vec<u8>, String> {
    let alice_ik_dh = PublicKey::from(msg.identity_key_dh_pub);
    let alice_ek    = PublicKey::from(msg.ephemeral_key_pub);

    // Mirrored four DH operations
    let dh1 = spk_b_secret.diffie_hellman(&alice_ik_dh);  // DH(SPK_B, IK_A)
    let dh2 = ik_b_secret.diffie_hellman(&alice_ek);       // DH(IK_B,  EK_A)
    let dh3 = spk_b_secret.diffie_hellman(&alice_ek);      // DH(SPK_B, EK_A)

    let sk = if let Some(opk) = opk_b_secret {
        let dh4 = opk.diffie_hellman(&alice_ek);            // DH(OPK_B, EK_A)
        derive_session_key(&[dh1.as_bytes(), dh2.as_bytes(), dh3.as_bytes(), dh4.as_bytes()])
    } else {
        derive_session_key(&[dh1.as_bytes(), dh2.as_bytes(), dh3.as_bytes()])
    };

    let cipher = Aes256Gcm::new_from_slice(&*sk).unwrap();
    let nonce  = aes_gcm::Nonce::from_slice(&msg.nonce);
    cipher.decrypt(nonce, msg.ciphertext.as_ref())
        .map_err(|_| "Decryption failed".to_string())
}
