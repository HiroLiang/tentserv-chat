//! Integration tests — cross-domain scenarios that span multiple store modules.
//!
//! These tests simulate realistic app flows without using `AppHandle` or
//! the OS keyring; all crypto uses `ZERO_KEY = [0u8; 32]`.
//!
//! Accessed via `store/mod.rs`:
//!   `#[cfg(test)] #[path = "tests/integration.rs"] mod integration_tests;`

use crate::store::db::init_schema;
use crate::store::device_store::{
    load_device_info_inner, store_device_info_inner, update_device_registered_inner, DeviceInfo,
};
use crate::store::key_store::{
    clear_all_keys_for_user_inner, delete_otp_key_inner, has_identity_key_inner,
    load_otp_key_inner, next_opk_ids_inner, store_identity_key_inner, store_otp_key_inner,
};
use crate::store::sender_key_store::{
    has_sender_key_inner, load_own_sender_key_inner, load_peer_sender_key_inner,
    store_own_sender_key_with_version_inner, store_peer_sender_key_with_version_inner,
};
use crate::store::token_store::{delete_token_inner, load_token_inner, store_token_inner};
use rusqlite::Connection;
use std::time::Instant;
use tempfile::TempDir;

const ZERO_KEY: [u8; 32] = [0u8; 32];

/// Open a fresh temp SQLite DB with the full production schema.
fn test_db() -> (TempDir, Connection) {
    let dir = TempDir::new().unwrap();
    let conn = Connection::open(dir.path().join("test.db")).unwrap();
    init_schema(&conn).unwrap();
    (dir, conn)
}

// ── Scenario 1: App startup — device is created and persists ──────

#[test]
fn scenario_1_device_startup_and_persistence() {
    let started = Instant::now();
    // Given  the DB is empty (first launch)
    // When   a DeviceInfo is created and stored (simulating initializeDevice)
    // Then   loading returns the same UUID device_id
    // When   a new connection is opened to the same DB file (simulating restart)
    // Then   the same device_id is returned — UUID was not regenerated
    // When   registration is marked true
    // Then   registered=true on reload
    let (dir, conn1) = test_db();
    println!("Given: empty local SQLite database for app startup simulation");

    // First launch: create and store device
    let info = DeviceInfo {
        device_id: "uuid-stable-across-restarts".to_string(),
        platform: "macos".to_string(),
        device_name: "My Mac".to_string(),
        registered: false,
        created_at: 1_700_000_000_000,
    };
    println!("Input: first_launch_device_info={info:?}");
    println!("Action: store device info on first launch");
    store_device_info_inner(&conn1, &info).unwrap();

    // Simulate restart: open a second connection to the same DB file
    println!("Action: reopen the same SQLite DB file to simulate app restart");
    let conn2 = Connection::open(dir.path().join("test.db")).unwrap();
    init_schema(&conn2).unwrap();

    let loaded = load_device_info_inner(&conn2)
        .unwrap()
        .expect("device must persist across connections");
    println!("Output: loaded_after_restart={loaded:?}");
    assert_eq!(
        loaded.device_id, "uuid-stable-across-restarts",
        "device_id must not regenerate"
    );
    assert!(!loaded.registered);

    // Mark registered via conn2
    println!("Input: registered=true");
    println!("Action: update device registration flag after backend success");
    update_device_registered_inner(&conn2, true).unwrap();

    let after_reg = load_device_info_inner(&conn2).unwrap().unwrap();
    println!("Output: loaded_after_registration={after_reg:?}");
    println!(
        "Mutation: device row persisted across restart and registered flag changed false -> true"
    );
    println!("Duration: {:?}", started.elapsed());
    assert!(after_reg.registered, "registered must be true after update");
}

// ── Scenario 2: Login — token persists and is user-scoped ─────────

#[test]
fn scenario_2_login_token_persistence_and_isolation() {
    // Given  user "alice" logs in with "tok_alice"
    // Then   load_token_inner("alice") returns "tok_alice"
    // When   app is "restarted" (new Connection, same DB file)
    // Then   alice's token still returns "tok_alice" (session persists)
    // When   a second user "bob" logs in with "tok_bob"
    // Then   alice and bob tokens are both accessible independently
    let (dir, conn1) = test_db();

    store_token_inner(&conn1, &ZERO_KEY, "alice", "tok_alice").unwrap();

    // Simulate restart
    let conn2 = Connection::open(dir.path().join("test.db")).unwrap();
    init_schema(&conn2).unwrap();

    assert_eq!(
        load_token_inner(&conn2, &ZERO_KEY, "alice").unwrap(),
        Some("tok_alice".to_string()),
        "token must persist across connections"
    );

    store_token_inner(&conn2, &ZERO_KEY, "bob", "tok_bob").unwrap();

    assert_eq!(
        load_token_inner(&conn2, &ZERO_KEY, "alice").unwrap(),
        Some("tok_alice".to_string())
    );
    assert_eq!(
        load_token_inner(&conn2, &ZERO_KEY, "bob").unwrap(),
        Some("tok_bob".to_string())
    );
}

// ── Scenario 3: E2EE key lifecycle per user ───────────────────────

#[test]
fn scenario_3_e2ee_key_lifecycle() {
    // Given  alice generates identity keys (ik_dh, ik_sign)
    // Then   has_identity_key_inner returns true for both
    // When   5 OTP keys are generated via next_opk_ids_inner + store_otp_key_inner
    // Then   IDs are [0,1,2,3,4] and all keys are loadable
    // When   OTP key 2 is deleted (simulating X3DH consumption)
    // Then   load_otp_key_inner for key 2 returns error; others remain
    let (_dir, conn) = test_db();

    let priv_key: [u8; 32] = [0x01u8; 32];
    let pub_key: [u8; 32] = [0x02u8; 32];

    // Generate identity keys
    store_identity_key_inner(&conn, &ZERO_KEY, "alice", "ik_dh", &priv_key, &pub_key).unwrap();
    store_identity_key_inner(&conn, &ZERO_KEY, "alice", "ik_sign", &priv_key, &pub_key).unwrap();

    assert!(has_identity_key_inner(&conn, "alice", "ik_dh").unwrap());
    assert!(has_identity_key_inner(&conn, "alice", "ik_sign").unwrap());

    // Generate 5 OTP keys
    let ids = next_opk_ids_inner(&conn, "alice", 5).unwrap();
    assert_eq!(ids, vec![0, 1, 2, 3, 4]);

    let opk_priv: [u8; 32] = [0xABu8; 32];
    let opk_pub: [u8; 32] = [0xCDu8; 32];
    for id in &ids {
        store_otp_key_inner(&conn, &ZERO_KEY, "alice", *id, &opk_priv, &opk_pub).unwrap();
    }

    // All 5 keys are loadable
    for id in &ids {
        assert!(load_otp_key_inner(&conn, &ZERO_KEY, "alice", *id).is_ok());
    }

    // X3DH consumes key 2 — delete it
    delete_otp_key_inner(&conn, "alice", 2).unwrap();

    assert!(
        load_otp_key_inner(&conn, &ZERO_KEY, "alice", 2).is_err(),
        "consumed OTP key 2 must be gone"
    );
    // Remaining keys still present
    for id in [0u32, 1, 3, 4] {
        assert!(load_otp_key_inner(&conn, &ZERO_KEY, "alice", id).is_ok());
    }
}

// ── Scenario 4: Own and peer sender keys coexist under one user ────

#[test]
fn scenario_4_sender_keys_own_and_peer_coexist() {
    // Given  alice stores her own sender key (member_id="m_alice")
    // And    alice stores bob's peer sender key (member_id="m_bob")
    // Then   has_sender_key returns true for both
    // And    load_own returns alice's key
    // And    load_peer returns bob's key
    // And    has_sender_key returns false for an unknown member
    let (_dir, conn) = test_db();

    let alice_key: [u8; 32] = [0x01u8; 32];
    let bob_key: [u8; 32] = [0x02u8; 32];

    store_own_sender_key_with_version_inner(&conn, &ZERO_KEY, "alice", "m_alice", &alice_key, 0)
        .unwrap();
    store_peer_sender_key_with_version_inner(&conn, "alice", "m_bob", &bob_key, 0).unwrap();

    assert!(has_sender_key_inner(&conn, "alice", "m_alice").unwrap());
    assert!(has_sender_key_inner(&conn, "alice", "m_bob").unwrap());
    assert!(!has_sender_key_inner(&conn, "alice", "m_carol").unwrap());

    assert_eq!(
        load_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_alice").unwrap(),
        alice_key
    );
    assert_eq!(
        load_peer_sender_key_inner(&conn, "alice", "m_bob").unwrap(),
        bob_key
    );
}

// ── Scenario 5: Multi-user session isolation ──────────────────────

#[test]
fn scenario_5_multi_user_e2ee_clear_does_not_affect_tokens() {
    // Given  alice and bob are both logged in with tokens and E2EE keys
    // When   clear_all_keys_for_user_inner("alice") is called
    // Then   alice's identity keys are gone
    // And    alice's token persists (E2EE clear does NOT remove auth tokens)
    // And    bob's keys and token are completely unaffected
    let (_dir, conn) = test_db();

    let priv_key: [u8; 32] = [0xFFu8; 32];
    let pub_key: [u8; 32] = [0xEEu8; 32];

    // Set up alice
    store_token_inner(&conn, &ZERO_KEY, "alice", "alice_jwt").unwrap();
    store_identity_key_inner(&conn, &ZERO_KEY, "alice", "ik_dh", &priv_key, &pub_key).unwrap();
    store_identity_key_inner(&conn, &ZERO_KEY, "alice", "ik_sign", &priv_key, &pub_key).unwrap();

    // Set up bob
    store_token_inner(&conn, &ZERO_KEY, "bob", "bob_jwt").unwrap();
    store_identity_key_inner(&conn, &ZERO_KEY, "bob", "ik_dh", &priv_key, &pub_key).unwrap();
    store_identity_key_inner(&conn, &ZERO_KEY, "bob", "ik_sign", &priv_key, &pub_key).unwrap();

    // Clear alice's E2EE keys only
    clear_all_keys_for_user_inner(&conn, "alice").unwrap();

    // Alice's E2EE keys are gone
    assert!(!has_identity_key_inner(&conn, "alice", "ik_dh").unwrap());
    assert!(!has_identity_key_inner(&conn, "alice", "ik_sign").unwrap());

    // Alice's token is still present (E2EE clear ≠ logout)
    assert_eq!(
        load_token_inner(&conn, &ZERO_KEY, "alice").unwrap(),
        Some("alice_jwt".to_string()),
        "alice's token must survive E2EE key clear"
    );

    // Bob is completely unaffected
    assert!(has_identity_key_inner(&conn, "bob", "ik_dh").unwrap());
    assert!(has_identity_key_inner(&conn, "bob", "ik_sign").unwrap());
    assert_eq!(
        load_token_inner(&conn, &ZERO_KEY, "bob").unwrap(),
        Some("bob_jwt".to_string())
    );

    // Clean up alice's token (logout)
    delete_token_inner(&conn, "alice").unwrap();
    assert_eq!(load_token_inner(&conn, &ZERO_KEY, "alice").unwrap(), None);
}
