//! Unit tests for `store/db.rs` and `store/key_provider.rs`.
//!
//! All master-key tests use `LocalKeyStore::from_dir` with a `tempdir()` so
//! they are fully deterministic and pass in every environment (no OS keyring,
//! no code-signing requirements).

use crate::store::db::{decrypt_bytes, encrypt_bytes};
use crate::store::key_provider::LocalKeyStore;
use tempfile::tempdir;

// ── Master key — file-based ───────────────────────────────────────

/// First call on a fresh directory creates and returns a valid 32-byte key.
#[test]
fn first_call_creates_valid_32_byte_key() {
    let dir = tempdir().expect("tempdir must succeed");
    let store =
        LocalKeyStore::from_dir(dir.path().to_path_buf()).expect("store init must succeed");
    println!("Given: empty keys directory");

    let key = store
        .get_or_create_master_key("1")
        .expect("first-time key creation must succeed");
    println!("Output: Ok([u8;32])");
    assert_eq!(key.len(), 32, "master key must be 32 bytes");
}

/// Two different account_ids produce different keys — each generates an
/// independent random value.
#[test]
fn different_accounts_get_different_keys() {
    let dir = tempdir().expect("tempdir must succeed");
    let store =
        LocalKeyStore::from_dir(dir.path().to_path_buf()).expect("store init must succeed");
    println!("Given: two distinct accounts '1' and '2'");

    let key_a = store
        .get_or_create_master_key("1")
        .expect("account A key must succeed");
    let key_b = store
        .get_or_create_master_key("2")
        .expect("account B key must succeed");

    println!("Output: key_a != key_b = {}", key_a != key_b);
    assert_ne!(key_a, key_b, "independently generated keys must differ");
}

/// A second call returns the same key as the first (file persists).
#[test]
fn key_persists_across_calls() {
    let dir = tempdir().expect("tempdir must succeed");
    let store =
        LocalKeyStore::from_dir(dir.path().to_path_buf()).expect("store init must succeed");
    println!("Given: empty keys directory for account '1'");

    let key1 = store
        .get_or_create_master_key("1")
        .expect("first call must succeed");
    println!("Action: first call completed — key generated and written to file");

    let key2 = store
        .get_or_create_master_key("1")
        .expect("second call must succeed");
    println!("Output: key1 == key2 = {}", key1 == key2);
    assert_eq!(key1, key2, "file-based key must persist between calls");
}

// ── validate_master_key ───────────────────────────────────────────

/// `validate_master_key` returns Err when no key file exists.
#[test]
fn validate_errors_for_unknown_account() {
    let dir = tempdir().expect("tempdir must succeed");
    let store =
        LocalKeyStore::from_dir(dir.path().to_path_buf()).expect("store init must succeed");
    println!("Given: account '999' has no key file");

    let result = store.validate_master_key("999");
    println!(
        "Output: {}",
        if result.is_err() {
            "Err (expected)"
        } else {
            "Ok (unexpected)"
        }
    );
    assert!(result.is_err(), "validate must fail when no key file exists");
}

/// `validate_master_key` returns Ok after `get_or_create_master_key` writes the key.
#[test]
fn validate_ok_after_create() {
    let dir = tempdir().expect("tempdir must succeed");
    let store =
        LocalKeyStore::from_dir(dir.path().to_path_buf()).expect("store init must succeed");
    println!("Given: no key file for account '1'");

    store
        .get_or_create_master_key("1")
        .expect("key creation must succeed");
    println!("Action: key created and written to file");

    store
        .validate_master_key("1")
        .expect("validate must succeed after key is created");
    println!("Output: Ok (key file is valid)");
}

// ── AES-256-GCM helpers ───────────────────────────────────────────

/// `encrypt_bytes` + `decrypt_bytes` must round-trip any plaintext.
#[test]
fn aes_gcm_encrypt_decrypt_roundtrip() {
    let key = [0x42u8; 32];
    let plaintext = b"hello keychain test";
    println!("Given: 32-byte key, plaintext '{}'", std::str::from_utf8(plaintext).unwrap());

    let (ciphertext, nonce) = encrypt_bytes(&key, plaintext).expect("encrypt must succeed");
    let decrypted = decrypt_bytes(&key, &nonce, &ciphertext).expect("decrypt must succeed");

    println!("Output: roundtrip matches = {}", decrypted == plaintext);
    assert_eq!(decrypted, plaintext, "round-trip must restore original plaintext");
}

/// `decrypt_bytes` with the wrong key must fail — AEAD authentication rejects it.
#[test]
fn aes_gcm_wrong_key_returns_err() {
    let key_a = [0xAAu8; 32];
    let key_b = [0xBBu8; 32];
    let plaintext = b"secret data";
    println!("Given: plaintext encrypted with key_a, decrypted with key_b (wrong key)");

    let (ciphertext, nonce) = encrypt_bytes(&key_a, plaintext).expect("encrypt must succeed");
    let result = decrypt_bytes(&key_b, &nonce, &ciphertext);

    println!(
        "Output: {}",
        if result.is_err() {
            "Err (expected AEAD failure)"
        } else {
            "Ok (unexpected)"
        }
    );
    assert!(result.is_err(), "wrong key must cause AEAD authentication failure");
}

/// `decrypt_bytes` with an invalid nonce length must fail before touching AES.
#[test]
fn aes_gcm_bad_nonce_length_returns_err() {
    let key = [0x11u8; 32];
    let (ciphertext, _) = encrypt_bytes(&key, b"data").expect("encrypt must succeed");

    println!("Action: decrypt with 8-byte nonce (invalid; must be 12)");
    let result = decrypt_bytes(&key, &[0u8; 8], &ciphertext);
    assert!(result.is_err(), "invalid nonce length must return Err");
}
