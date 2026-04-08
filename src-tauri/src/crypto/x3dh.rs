use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit};
pub(crate) use ed25519_dalek::SigningKey;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use serde_with::serde_as;
use sha2::Sha256;
pub(crate) use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

// ── Types ──────────────────────────────────────────

#[serde_as]
#[derive(Serialize, Deserialize)]
pub struct PublicKeyBundle {
    pub identity_key_dh: [u8; 32],   // X25519 public key (for DH2)
    pub identity_key_sign: [u8; 32], // Ed25519 verifying key (for SPK sig verification)
    pub signed_pre_key: [u8; 32],    // X25519 public key (for DH1, DH3)
    #[serde_as(as = "serde_with::Bytes")]
    pub spk_signature: [u8; 64], // Ed25519 signature over signed_pre_key
    pub spk_key_id: u32,
    pub one_time_pre_key: Option<[u8; 32]>,
    pub otpk_key_id: Option<u32>,
}

#[serde_as]
#[derive(Debug, Serialize, Deserialize)]
pub struct InitialMessage {
    pub identity_key_dh_pub: [u8; 32],   // Alice IK (X25519)
    pub identity_key_sign_pub: [u8; 32], // Alice IK (Ed25519)
    pub ephemeral_key_pub: [u8; 32],     // EK_A pub
    pub spk_key_id: u32,
    pub otpk_key_id: Option<u32>,
    pub ciphertext: Vec<u8>, // AES-256-GCM
    pub nonce: [u8; 12],
}

// ── HKDF helper (Signal X3DH spec) ────────────────
// [EN] derive_session_key: implements Signal X3DH HKDF derivation.
//      Salt: 32-byte zero. IKM: 0xFF×32 prefix + concatenated DH outputs. Info: b"X3DH". Output: 32 bytes.
//      The 0xFF prefix and zero salt match the Signal Protocol spec to prevent cross-protocol attacks.
// [中] derive_session_key：實作 Signal X3DH HKDF 派生。
//      Salt：32 位元組零。IKM：0xFF×32 前綴 + 串接 DH 輸出。Info：b"X3DH"。輸出：32 位元組。
//      0xFF 前綴與零 salt 符合 Signal Protocol 規範，防止跨協議攻擊。
// [日] derive_session_key：Signal X3DH の HKDF 派生を実装する。
//      Salt：32 バイトのゼロ。IKM：0xFF×32 プレフィックス + DH 出力の連結。Info：b"X3DH"。出力：32 バイト。
//      0xFF プレフィックスとゼロ salt は Signal Protocol 仕様に準拠し、クロスプロトコル攻撃を防ぐ。

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
// [EN] x3dh_sender: Signal X3DH send-side.
//      1) Verifies Bob's SPK signature (prevents MITM replacement of pre-key).
//      2) Generates ephemeral key EK_A (StaticSecret — allows multiple DH calls in one session).
//      3) Computes DH1=IK_A×SPK_B, DH2=EK_A×IK_B, DH3=EK_A×SPK_B, [DH4=EK_A×OPK_B if OTPKey present].
//      4) Derives session key via HKDF and encrypts plaintext with AES-256-GCM.
// [中] x3dh_sender：Signal X3DH 傳送端。
//      1) 驗證 Bob SPK 簽名（防止中間人替換 pre-key）。
//      2) 生成臨時金鑰 EK_A（StaticSecret — 允許在同一會話中多次 DH）。
//      3) 計算 DH1=IK_A×SPK_B、DH2=EK_A×IK_B、DH3=EK_A×SPK_B、[DH4=EK_A×OPK_B（若有 OTPKey）]。
//      4) 以 HKDF 派生會話金鑰，用 AES-256-GCM 加密明文。
// [日] x3dh_sender：Signal X3DH 送信側。
//      1) Bob の SPK 署名を検証（MITM による pre-key 置換を防止）。
//      2) 一時鍵 EK_A を生成（StaticSecret — 同一セッションで複数回 DH 可能）。
//      3) DH1=IK_A×SPK_B、DH2=EK_A×IK_B、DH3=EK_A×SPK_B、[DH4=EK_A×OPK_B（OTPKey がある場合）] を計算。
//      4) HKDF でセッション鍵を派生し、AES-256-GCM で平文を暗号化する。

// ── Alice Side: Build session ──────────────────────────

pub fn x3dh_sender(
    ik_a_dh_secret: &StaticSecret, // Alice X25519 identity secret
    ik_a_sign_secret: &SigningKey, // Alice Ed25519 signing key (for identity_key_sign_pub)
    bob_bundle: &PublicKeyBundle,
    plaintext: &[u8],
) -> Result<InitialMessage, String> {
    // 1. Verify SPK signature (防中間人替換)
    let bob_ik_verify =
        VerifyingKey::from_bytes(&bob_bundle.identity_key_sign).map_err(|e| e.to_string())?;
    let spk_sig = Signature::from_bytes(&bob_bundle.spk_signature);
    bob_ik_verify
        .verify(&bob_bundle.signed_pre_key, &spk_sig)
        .map_err(|_| "SPK signature verification failed".to_string())?;

    // 2. Generate Ephemeral Key (StaticSecret so we can call DH multiple times)
    let ek_a_secret = StaticSecret::from(rand::random::<[u8; 32]>());
    let ek_a_pub = PublicKey::from(&ek_a_secret);

    let bob_ik_dh = PublicKey::from(bob_bundle.identity_key_dh);
    let bob_spk = PublicKey::from(bob_bundle.signed_pre_key);

    // 3. Four DH operations
    let ik_a_dh_pub = PublicKey::from(ik_a_dh_secret);
    let dh1 = ik_a_dh_secret.diffie_hellman(&bob_spk); // DH(IK_A, SPK_B)
    let dh2 = ek_a_secret.diffie_hellman(&bob_ik_dh); // DH(EK_A, IK_B)
    let dh3 = ek_a_secret.diffie_hellman(&bob_spk); // DH(EK_A, SPK_B)

    let sk = if let Some(otpk_bytes) = bob_bundle.one_time_pre_key {
        let bob_opk = PublicKey::from(otpk_bytes);
        let dh4 = ek_a_secret.diffie_hellman(&bob_opk); // DH(EK_A, OPK_B)
        derive_session_key(&[
            dh1.as_bytes(),
            dh2.as_bytes(),
            dh3.as_bytes(),
            dh4.as_bytes(),
        ])
    } else {
        derive_session_key(&[dh1.as_bytes(), dh2.as_bytes(), dh3.as_bytes()])
    };

    // 4. AES-256-GCM encrypt
    let cipher = Aes256Gcm::new_from_slice(&*sk).unwrap();
    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = aes_gcm::Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| e.to_string())?;

    Ok(InitialMessage {
        identity_key_dh_pub: ik_a_dh_pub.to_bytes(),
        identity_key_sign_pub: ik_a_sign_secret.verifying_key().to_bytes(),
        ephemeral_key_pub: ek_a_pub.to_bytes(),
        spk_key_id: bob_bundle.spk_key_id,
        otpk_key_id: bob_bundle.otpk_key_id,
        ciphertext,
        nonce: nonce_bytes,
    })
}

// ── Bob Side: Reproduce session, decrypt ──────────────────────
// [EN] x3dh_receiver: mirrors x3dh_sender with swapped roles.
//      Computes DH1=SPK_B×IK_A, DH2=IK_B×EK_A, DH3=SPK_B×EK_A, [DH4=OPK_B×EK_A],
//      derives the same session key via HKDF, and decrypts the ciphertext.
//      Commutativity of DH ensures Alice and Bob derive the same key.
// [中] x3dh_receiver：為 x3dh_sender 的鏡像（交換角色）。
//      計算 DH1=SPK_B×IK_A、DH2=IK_B×EK_A、DH3=SPK_B×EK_A、[DH4=OPK_B×EK_A]，
//      以 HKDF 派生相同會話金鑰並解密密文。DH 的交換律確保 Alice 與 Bob 派生出相同金鑰。
// [日] x3dh_receiver：x3dh_sender のロールを入れ替えたミラー実装。
//      DH1=SPK_B×IK_A、DH2=IK_B×EK_A、DH3=SPK_B×EK_A、[DH4=OPK_B×EK_A] を計算し、
//      HKDF で同一セッション鍵を派生して暗号文を復号する。DH の可換性により Alice と Bob は同一の鍵を導出する。

// ── Bob Side: Reproduce session, decrypt ──────────────────────

pub fn x3dh_receiver(
    ik_b_secret: &StaticSecret,
    spk_b_secret: &StaticSecret,
    opk_b_secret: Option<&StaticSecret>,
    msg: &InitialMessage,
) -> Result<Vec<u8>, String> {
    let alice_ik_dh = PublicKey::from(msg.identity_key_dh_pub);
    let alice_ek = PublicKey::from(msg.ephemeral_key_pub);

    // Mirrored four DH operations
    let dh1 = spk_b_secret.diffie_hellman(&alice_ik_dh); // DH(SPK_B, IK_A)
    let dh2 = ik_b_secret.diffie_hellman(&alice_ek); // DH(IK_B,  EK_A)
    let dh3 = spk_b_secret.diffie_hellman(&alice_ek); // DH(SPK_B, EK_A)

    let sk = if let Some(opk) = opk_b_secret {
        let dh4 = opk.diffie_hellman(&alice_ek); // DH(OPK_B, EK_A)
        derive_session_key(&[
            dh1.as_bytes(),
            dh2.as_bytes(),
            dh3.as_bytes(),
            dh4.as_bytes(),
        ])
    } else {
        derive_session_key(&[dh1.as_bytes(), dh2.as_bytes(), dh3.as_bytes()])
    };

    let cipher = Aes256Gcm::new_from_slice(&*sk).unwrap();
    let nonce = aes_gcm::Nonce::from_slice(&msg.nonce);
    cipher
        .decrypt(nonce, msg.ciphertext.as_ref())
        .map_err(|_| "Decryption failed".to_string())
}

// ── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Signer;

    // ── Fixtures ────────────────────────────────────────────────────

    /// Alice's identity keys. Swap in different random values to test isolation.
    fn sample_alice() -> (StaticSecret, SigningKey) {
        let ik_dh = StaticSecret::from(rand::random::<[u8; 32]>());
        let ik_sign = SigningKey::from_bytes(&rand::random::<[u8; 32]>());
        (ik_dh, ik_sign)
    }

    struct BobPrivKeys {
        ik_dh: StaticSecret,
        _ik_sign: SigningKey,
        spk: StaticSecret,
        opk: StaticSecret,
    }

    /// Bob's full bundle including a one-time pre-key.
    fn sample_bob_with_otpk() -> (BobPrivKeys, PublicKeyBundle) {
        let ik_dh = StaticSecret::from(rand::random::<[u8; 32]>());
        let ik_sign = SigningKey::from_bytes(&rand::random::<[u8; 32]>());
        let spk = StaticSecret::from(rand::random::<[u8; 32]>());
        let opk = StaticSecret::from(rand::random::<[u8; 32]>());

        let spk_pub = PublicKey::from(&spk);
        let sig = ik_sign.sign(spk_pub.as_bytes());

        let bundle = PublicKeyBundle {
            identity_key_dh: PublicKey::from(&ik_dh).to_bytes(),
            identity_key_sign: ik_sign.verifying_key().to_bytes(),
            signed_pre_key: spk_pub.to_bytes(),
            spk_signature: sig.to_bytes(),
            spk_key_id: 1,
            one_time_pre_key: Some(PublicKey::from(&opk).to_bytes()),
            otpk_key_id: Some(0),
        };
        (
            BobPrivKeys {
                ik_dh,
                _ik_sign: ik_sign,
                spk,
                opk,
            },
            bundle,
        )
    }

    /// Bob's bundle without a one-time pre-key (3-DH path).
    fn sample_bob_without_otpk() -> (BobPrivKeys, PublicKeyBundle) {
        let (keys, mut bundle) = sample_bob_with_otpk();
        bundle.one_time_pre_key = None;
        bundle.otpk_key_id = None;
        (keys, bundle)
    }

    const PLAINTEXT: &[u8] = b"Hello, X3DH!";

    // ── Scenarios ───────────────────────────────────────────────────

    #[test]
    fn roundtrip_with_otpk() {
        // Given valid Alice and Bob keys with OPK
        let (alice_ik_dh, alice_ik_sign) = sample_alice();
        let (bob_keys, bob_bundle) = sample_bob_with_otpk();

        // When sender encrypts
        let msg = x3dh_sender(&alice_ik_dh, &alice_ik_sign, &bob_bundle, PLAINTEXT).unwrap();

        // Then receiver decrypts and gets the same plaintext
        let decrypted =
            x3dh_receiver(&bob_keys.ik_dh, &bob_keys.spk, Some(&bob_keys.opk), &msg).unwrap();
        assert_eq!(decrypted, PLAINTEXT);
    }

    #[test]
    fn roundtrip_without_otpk() {
        // Given bundle without OPK (3-DH path)
        let (alice_ik_dh, alice_ik_sign) = sample_alice();
        let (bob_keys, bob_bundle) = sample_bob_without_otpk();

        let msg = x3dh_sender(&alice_ik_dh, &alice_ik_sign, &bob_bundle, PLAINTEXT).unwrap();
        let decrypted = x3dh_receiver(&bob_keys.ik_dh, &bob_keys.spk, None, &msg).unwrap();
        assert_eq!(decrypted, PLAINTEXT);
    }

    #[test]
    fn sender_rejects_bad_spk_signature() {
        // Given a bundle with an all-zero (invalid) SPK signature
        let (alice_ik_dh, alice_ik_sign) = sample_alice();
        let (_, mut bob_bundle) = sample_bob_with_otpk();
        bob_bundle.spk_signature = [0u8; 64];

        // Then x3dh_sender returns Err containing "signature"
        let result = x3dh_sender(&alice_ik_dh, &alice_ik_sign, &bob_bundle, PLAINTEXT);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_lowercase().contains("signature"));
    }

    #[test]
    fn receiver_rejects_tampered_ciphertext() {
        // Given a valid InitialMessage
        let (alice_ik_dh, alice_ik_sign) = sample_alice();
        let (bob_keys, bob_bundle) = sample_bob_with_otpk();
        let mut msg = x3dh_sender(&alice_ik_dh, &alice_ik_sign, &bob_bundle, PLAINTEXT).unwrap();

        // When one ciphertext byte is flipped
        msg.ciphertext[0] ^= 0xFF;

        // Then decryption fails
        let result = x3dh_receiver(&bob_keys.ik_dh, &bob_keys.spk, Some(&bob_keys.opk), &msg);
        assert!(result.is_err());
    }

    #[test]
    fn receiver_rejects_wrong_ik_secret() {
        // Given Alice sends to Bob's bundle
        let (alice_ik_dh, alice_ik_sign) = sample_alice();
        let (bob_keys, bob_bundle) = sample_bob_with_otpk();
        let msg = x3dh_sender(&alice_ik_dh, &alice_ik_sign, &bob_bundle, PLAINTEXT).unwrap();

        // When Bob uses a different identity key
        let wrong_ik = StaticSecret::from(rand::random::<[u8; 32]>());
        let result = x3dh_receiver(&wrong_ik, &bob_keys.spk, Some(&bob_keys.opk), &msg);
        assert!(result.is_err());
    }

    #[test]
    fn receiver_rejects_wrong_spk_secret() {
        // Given Alice sends to Bob's bundle
        let (alice_ik_dh, alice_ik_sign) = sample_alice();
        let (bob_keys, bob_bundle) = sample_bob_with_otpk();
        let msg = x3dh_sender(&alice_ik_dh, &alice_ik_sign, &bob_bundle, PLAINTEXT).unwrap();

        // When Bob uses a different SPK
        let wrong_spk = StaticSecret::from(rand::random::<[u8; 32]>());
        let result = x3dh_receiver(&bob_keys.ik_dh, &wrong_spk, Some(&bob_keys.opk), &msg);
        assert!(result.is_err());
    }

    #[test]
    fn empty_plaintext_roundtrip() {
        // Given empty plaintext
        let (alice_ik_dh, alice_ik_sign) = sample_alice();
        let (bob_keys, bob_bundle) = sample_bob_with_otpk();

        let msg = x3dh_sender(&alice_ik_dh, &alice_ik_sign, &bob_bundle, b"").unwrap();
        let decrypted =
            x3dh_receiver(&bob_keys.ik_dh, &bob_keys.spk, Some(&bob_keys.opk), &msg).unwrap();
        assert_eq!(decrypted, b"");
    }

    #[test]
    fn derive_session_key_is_deterministic() {
        // Given the same DH outputs
        let dh1 = [0x11u8; 32];
        let dh2 = [0x22u8; 32];
        let dh3 = [0x33u8; 32];

        // Then derive_session_key always produces the same result
        let key_a = derive_session_key(&[&dh1, &dh2, &dh3]);
        let key_b = derive_session_key(&[&dh1, &dh2, &dh3]);
        assert_eq!(*key_a, *key_b);

        // And different inputs produce different output
        let key_c = derive_session_key(&[&dh1, &dh2]);
        assert_ne!(*key_a, *key_c);
    }
}
