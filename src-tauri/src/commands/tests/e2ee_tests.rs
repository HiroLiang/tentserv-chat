use crate::commands::core::{
    clear_e2ee_keys_core, encrypt_with_sender_key_core, generate_identity_keys_core,
    generate_sender_key_core, generate_signed_pre_key_core, has_identity_keys_core,
    has_sender_key_core, perform_x3dh_receive_core, perform_x3dh_send_core,
    replenish_otp_keys_core, store_member_sender_key_core,
};
use crate::commands::e2ee::IdentityKeyBundle;
use crate::crypto::x3dh::{PublicKey, PublicKeyBundle, SigningKey, StaticSecret};
use crate::store::db::init_schema;
use ed25519_dalek::Verifier;
use rusqlite::Connection;
use tempfile::TempDir;

// ── Fixtures ────────────────────────────────────────────────────────

/// Input: swap for any 32-byte key to test different encryption keys.
const ZERO_KEY: [u8; 32] = [0u8; 32];

/// Input: replace with any user ID strings to test multi-user isolation.
const ALICE: &str = "alice";
const BOB: &str = "bob";

/// Input: replace with any member ID strings.
const MEMBER_ALICE: &str = "member-alice";
const MEMBER_BOB: &str = "member-bob";

/// Input: replace with any plaintext to test different message contents.
const PLAINTEXT: &[u8] = b"Hello, E2EE!";

fn test_db() -> (TempDir, Connection) {
    let dir = TempDir::new().unwrap();
    let conn = Connection::open(dir.path().join("test.db")).unwrap();
    init_schema(&conn).unwrap();
    (dir, conn)
}

/// Helper: generate Alice's identity keys in the DB and return the bundle.
fn setup_identity(conn: &Connection, user_id: &str) -> IdentityKeyBundle {
    generate_identity_keys_core(conn, &ZERO_KEY, user_id).unwrap()
}

/// Helper: build a valid Bob public key bundle using real keys (required for Ed25519 sig).
fn make_bob_bundle_with_opk() -> (
    StaticSecret,
    StaticSecret,
    StaticSecret,
    SigningKey,
    PublicKeyBundle,
) {
    use ed25519_dalek::Signer;
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
    (ik_dh, spk, opk, ik_sign, bundle)
}

// ── Identity key scenarios ───────────────────────────────────────────

#[test]
fn has_identity_keys_false_before_generate() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When checking before generating
    let result = has_identity_keys_core(&conn, ALICE).unwrap();

    // Then it is false
    assert!(!result);
}

#[test]
fn generate_identity_keys_returns_32byte_pubs() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When generating identity keys
    let bundle = generate_identity_keys_core(&conn, &ZERO_KEY, ALICE).unwrap();

    // Then both public keys are 32 bytes (they are arrays, so this is always true,
    // but we verify the bundle is populated and non-zero)
    assert_ne!(bundle.identity_key_dh_pub, [0u8; 32]);
    assert_ne!(bundle.identity_key_sign_pub, [0u8; 32]);
}

#[test]
fn has_identity_keys_true_after_generate() {
    // Given identity keys have been generated
    let (_dir, conn) = test_db();
    generate_identity_keys_core(&conn, &ZERO_KEY, ALICE).unwrap();

    // When checking
    let result = has_identity_keys_core(&conn, ALICE).unwrap();

    // Then it is true
    assert!(result);
}

#[test]
fn generate_identity_keys_idempotent() {
    // Given identity keys already exist
    let (_dir, conn) = test_db();
    generate_identity_keys_core(&conn, &ZERO_KEY, ALICE).unwrap();

    // When called again
    generate_identity_keys_core(&conn, &ZERO_KEY, ALICE).unwrap();

    // Then has_identity_keys is still true (no error, keys overwritten)
    assert!(has_identity_keys_core(&conn, ALICE).unwrap());
}

// ── Signed pre-key scenarios ─────────────────────────────────────────

#[test]
fn generate_spk_returns_valid_bundle() {
    // Given Alice's identity keys exist
    let (_dir, conn) = test_db();
    setup_identity(&conn, ALICE);

    // When generating a signed pre-key with key_id=5
    let spk = generate_signed_pre_key_core(&conn, &ZERO_KEY, ALICE, 5).unwrap();

    // Then the bundle has the correct key_id and non-zero keys/signature
    assert_eq!(spk.key_id, 5);
    assert_ne!(spk.public_key, [0u8; 32]);
    assert_ne!(spk.signature, [0u8; 64]);
}

#[test]
fn generated_spk_signature_verifiable() {
    // Given Alice's identity keys exist
    let (_dir, conn) = test_db();
    let ik_bundle = setup_identity(&conn, ALICE);

    // When generating a signed pre-key
    let spk = generate_signed_pre_key_core(&conn, &ZERO_KEY, ALICE, 1).unwrap();

    // Then the SPK signature is verifiable with the identity key
    let verifying_key =
        ed25519_dalek::VerifyingKey::from_bytes(&ik_bundle.identity_key_sign_pub).unwrap();
    let signature = ed25519_dalek::Signature::from_bytes(&spk.signature);
    assert!(verifying_key.verify(&spk.public_key, &signature).is_ok());
}

#[test]
fn generate_spk_fails_without_identity_key() {
    // Given no identity keys
    let (_dir, conn) = test_db();

    // When trying to generate a signed pre-key
    let result = generate_signed_pre_key_core(&conn, &ZERO_KEY, ALICE, 1);

    // Then it returns an error (can't sign without ik_sign)
    assert!(result.is_err());
}

// ── OTP key scenarios ────────────────────────────────────────────────

#[test]
fn replenish_otp_returns_correct_count() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When requesting 5 OTP keys
    let keys = replenish_otp_keys_core(&conn, &ZERO_KEY, ALICE, 5).unwrap();

    // Then exactly 5 keys are returned
    assert_eq!(keys.len(), 5);
}

#[test]
fn replenish_otp_ids_are_sequential_and_never_repeat() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When requesting two batches
    let first = replenish_otp_keys_core(&conn, &ZERO_KEY, ALICE, 3).unwrap();
    let second = replenish_otp_keys_core(&conn, &ZERO_KEY, ALICE, 3).unwrap();

    // Then IDs are sequential and the second batch starts where the first ended
    let first_ids: Vec<u32> = first.iter().map(|k| k.key_id).collect();
    let second_ids: Vec<u32> = second.iter().map(|k| k.key_id).collect();
    assert_eq!(first_ids, vec![0, 1, 2]);
    assert_eq!(second_ids, vec![3, 4, 5]);
}

#[test]
fn replenish_zero_count_is_ok() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When requesting 0 keys
    let keys = replenish_otp_keys_core(&conn, &ZERO_KEY, ALICE, 0).unwrap();

    // Then an empty vec is returned with no error
    assert!(keys.is_empty());
}

// ── X3DH send / receive scenarios ───────────────────────────────────

#[test]
fn x3dh_roundtrip_with_otpk() {
    // Given Alice's identity keys in DB, and Bob's full public bundle
    let (_dir, conn) = test_db();
    setup_identity(&conn, ALICE);
    let (bob_ik_dh, bob_spk, bob_opk, _, bob_bundle) = make_bob_bundle_with_opk();

    // Store Bob's SPK and OPK in his own DB so he can receive
    let (_dir2, bob_conn) = {
        let dir2 = TempDir::new().unwrap();
        let conn2 = Connection::open(dir2.path().join("bob.db")).unwrap();
        init_schema(&conn2).unwrap();
        (dir2, conn2)
    };
    // Bob generates his identity keys and stores SPK + OPK
    generate_identity_keys_core(&bob_conn, &ZERO_KEY, BOB).unwrap();
    crate::store::key_store::store_identity_key_inner(
        &bob_conn,
        &ZERO_KEY,
        BOB,
        "ik_dh",
        bob_ik_dh.as_bytes(),
        &PublicKey::from(&bob_ik_dh).to_bytes(),
    )
    .unwrap();
    crate::store::key_store::store_signed_pre_key_inner(
        &bob_conn,
        &ZERO_KEY,
        BOB,
        1,
        bob_spk.as_bytes(),
        &PublicKey::from(&bob_spk).to_bytes(),
        &bob_bundle.spk_signature,
    )
    .unwrap();
    crate::store::key_store::store_otp_key_inner(
        &bob_conn,
        &ZERO_KEY,
        BOB,
        0,
        bob_opk.as_bytes(),
        &PublicKey::from(&bob_opk).to_bytes(),
    )
    .unwrap();

    // When Alice sends
    let msg = perform_x3dh_send_core(&conn, &ZERO_KEY, ALICE, &bob_bundle, PLAINTEXT).unwrap();

    // Then Bob receives and decrypts to the same plaintext
    let decrypted = perform_x3dh_receive_core(&bob_conn, &ZERO_KEY, BOB, &msg, 1, Some(0)).unwrap();
    assert_eq!(decrypted, PLAINTEXT);
}

#[test]
fn x3dh_roundtrip_without_otpk() {
    // Given Alice's identity keys in DB, and Bob's bundle without OPK
    let (_dir, conn) = test_db();
    setup_identity(&conn, ALICE);
    let (bob_ik_dh, bob_spk, _, _, mut bob_bundle) = make_bob_bundle_with_opk();
    bob_bundle.one_time_pre_key = None;
    bob_bundle.otpk_key_id = None;

    let (_dir2, bob_conn) = {
        let dir2 = TempDir::new().unwrap();
        let conn2 = Connection::open(dir2.path().join("bob.db")).unwrap();
        init_schema(&conn2).unwrap();
        (dir2, conn2)
    };
    generate_identity_keys_core(&bob_conn, &ZERO_KEY, BOB).unwrap();
    crate::store::key_store::store_identity_key_inner(
        &bob_conn,
        &ZERO_KEY,
        BOB,
        "ik_dh",
        bob_ik_dh.as_bytes(),
        &PublicKey::from(&bob_ik_dh).to_bytes(),
    )
    .unwrap();
    crate::store::key_store::store_signed_pre_key_inner(
        &bob_conn,
        &ZERO_KEY,
        BOB,
        1,
        bob_spk.as_bytes(),
        &PublicKey::from(&bob_spk).to_bytes(),
        &bob_bundle.spk_signature,
    )
    .unwrap();

    // When Alice sends (3-DH path)
    let msg = perform_x3dh_send_core(&conn, &ZERO_KEY, ALICE, &bob_bundle, PLAINTEXT).unwrap();

    // Then Bob receives with no OPK
    let decrypted = perform_x3dh_receive_core(&bob_conn, &ZERO_KEY, BOB, &msg, 1, None).unwrap();
    assert_eq!(decrypted, PLAINTEXT);
}

#[test]
fn x3dh_receive_bad_otpk_key_id_returns_err() {
    // Given Alice's identity keys, Bob's bundle with OPK key_id=0
    let (_dir, conn) = test_db();
    setup_identity(&conn, ALICE);
    let (_, _, _, _, bob_bundle) = make_bob_bundle_with_opk();

    let (_dir2, bob_conn) = {
        let dir2 = TempDir::new().unwrap();
        let conn2 = Connection::open(dir2.path().join("bob.db")).unwrap();
        init_schema(&conn2).unwrap();
        (dir2, conn2)
    };
    generate_identity_keys_core(&bob_conn, &ZERO_KEY, BOB).unwrap();

    let msg = perform_x3dh_send_core(&conn, &ZERO_KEY, ALICE, &bob_bundle, PLAINTEXT).unwrap();

    // When receiving with a non-existent OPK key_id
    let result = perform_x3dh_receive_core(&bob_conn, &ZERO_KEY, BOB, &msg, 1, Some(999));

    // Then it returns an error
    assert!(result.is_err());
}

// ── Sender key scenarios ─────────────────────────────────────────────

#[test]
fn has_sender_key_false_before_generate() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // Then has_sender_key returns false
    assert!(!has_sender_key_core(&conn, ALICE, MEMBER_ALICE).unwrap());
}

#[test]
fn generate_sender_key_true_after() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When a sender key is generated
    generate_sender_key_core(&conn, &ZERO_KEY, ALICE, MEMBER_ALICE).unwrap();

    // Then has_sender_key returns true
    assert!(has_sender_key_core(&conn, ALICE, MEMBER_ALICE).unwrap());
}

#[test]
fn encrypt_with_sender_key_roundtrip() {
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit};

    // Given a sender key has been generated
    let (_dir, conn) = test_db();
    generate_sender_key_core(&conn, &ZERO_KEY, ALICE, MEMBER_ALICE).unwrap();

    // When encrypting
    let enc =
        encrypt_with_sender_key_core(&conn, &ZERO_KEY, ALICE, MEMBER_ALICE, PLAINTEXT).unwrap();

    // Then manually decrypting with the stored own key produces the original plaintext
    let sk_bytes = crate::store::sender_key_store::load_own_sender_key_inner(
        &conn,
        &ZERO_KEY,
        ALICE,
        MEMBER_ALICE,
    )
    .unwrap();
    let cipher = Aes256Gcm::new_from_slice(&sk_bytes).unwrap();
    let nonce = aes_gcm::Nonce::from_slice(&enc.nonce);
    let decrypted = cipher.decrypt(nonce, enc.ciphertext.as_ref()).unwrap();
    assert_eq!(decrypted, PLAINTEXT);
}

#[test]
fn store_member_sender_key_rejects_wrong_length() {
    // Given a 31-byte "key" (invalid)
    let (_dir, conn) = test_db();
    let bad_key = vec![0u8; 31];

    // Then store_member_sender_key_core returns an error
    let result = store_member_sender_key_core(&conn, ALICE, MEMBER_BOB, bad_key);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("32 bytes"));
}

#[test]
fn sender_key_member_isolation() {
    // Given Alice has own sender keys for two different member IDs
    let (_dir, conn) = test_db();
    generate_sender_key_core(&conn, &ZERO_KEY, ALICE, MEMBER_ALICE).unwrap();
    generate_sender_key_core(&conn, &ZERO_KEY, ALICE, MEMBER_BOB).unwrap();

    // Then each member's key is independently present
    assert!(has_sender_key_core(&conn, ALICE, MEMBER_ALICE).unwrap());
    assert!(has_sender_key_core(&conn, ALICE, MEMBER_BOB).unwrap());

    // And clearing all E2EE keys removes both
    clear_e2ee_keys_core(&conn, ALICE).unwrap();
    assert!(!has_sender_key_core(&conn, ALICE, MEMBER_ALICE).unwrap());
    assert!(!has_sender_key_core(&conn, ALICE, MEMBER_BOB).unwrap());
}

#[test]
fn clear_e2ee_keys_removes_all() {
    // Given identity keys + SPK + OTPs + sender key
    let (_dir, conn) = test_db();
    setup_identity(&conn, ALICE);
    generate_signed_pre_key_core(&conn, &ZERO_KEY, ALICE, 1).unwrap();
    replenish_otp_keys_core(&conn, &ZERO_KEY, ALICE, 3).unwrap();
    generate_sender_key_core(&conn, &ZERO_KEY, ALICE, MEMBER_ALICE).unwrap();

    // When clearing all E2EE keys
    clear_e2ee_keys_core(&conn, ALICE).unwrap();

    // Then all keys are gone
    assert!(!has_identity_keys_core(&conn, ALICE).unwrap());
    assert!(!has_sender_key_core(&conn, ALICE, MEMBER_ALICE).unwrap());
}

#[test]
fn multi_user_isolation() {
    // Given identity keys for both Alice and Bob
    let (_dir, conn) = test_db();
    setup_identity(&conn, ALICE);
    setup_identity(&conn, BOB);

    // When clearing Alice's keys
    clear_e2ee_keys_core(&conn, ALICE).unwrap();

    // Then Bob's keys are unaffected
    assert!(!has_identity_keys_core(&conn, ALICE).unwrap());
    assert!(has_identity_keys_core(&conn, BOB).unwrap());
}

#[test]
fn clear_e2ee_on_empty_db_is_ok() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When clearing keys that don't exist
    let result = clear_e2ee_keys_core(&conn, ALICE);

    // Then it succeeds silently
    assert!(result.is_ok());
}
