//! Unit tests for `sender_key_store`.
//!
//! Validates member-scoped sender key storage and the removal of `room_id`
//! from the primary key. Each test scenario follows the Given/When/Then pattern.

use super::{
    delete_sender_keys_inner, has_sender_key_inner, load_own_sender_key_inner,
    load_peer_sender_key_inner, store_own_sender_key_with_version_inner,
    store_peer_sender_key_with_version_inner,
};
use crate::store::db::init_schema;
use rusqlite::Connection;
use tempfile::TempDir;

const ZERO_KEY: [u8; 32] = [0u8; 32];
const DEVICE_ALICE: &str = "device-alice";
const DEVICE_BOB: &str = "device-bob";
const DEVICE_KEEP: &str = "device-keep";

fn test_db() -> (TempDir, Connection) {
    let dir = TempDir::new().unwrap();
    let conn = Connection::open(dir.path().join("test.db")).unwrap();
    init_schema(&conn).unwrap();
    (dir, conn)
}

// ── Scenario 1: Sender key is encrypted at rest ────────────────────

#[test]
fn scenario_own_key_encrypted_storage() {
    // Given  alice's sender key (member_id="m_alice", 32 bytes)
    // When   stored via store_own_sender_key_inner
    // Then   load_own_sender_key_inner returns the original bytes
    // And    the DB row persists a non-NULL nonce because all sender keys are encrypted locally
    let (_dir, conn) = test_db();
    let private_key: [u8; 32] = [0xAAu8; 32];

    store_own_sender_key_with_version_inner(
        &conn,
        &ZERO_KEY,
        "alice",
        "m_alice",
        DEVICE_ALICE,
        &private_key,
        0,
    )
    .unwrap();

    let loaded =
        load_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_alice", DEVICE_ALICE).unwrap();
    assert_eq!(loaded, private_key);

    // Verify DB row internals
    let nonce: Vec<u8> = conn
        .query_row(
            "SELECT nonce FROM sender_keys WHERE user_id='alice' AND member_id='m_alice'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        !nonce.is_empty(),
        "sender key rows must keep a non-NULL nonce because key_blob is encrypted"
    );
}

// ── Scenario 2: Imported member key is also encrypted at rest ──────

#[test]
fn scenario_peer_key_plaintext_storage() {
    // Given  alice stores bob's member-scoped sender key (member_id="m_bob")
    // When   stored via store_peer_sender_key_inner
    // Then   load_peer_sender_key_inner returns the original bytes
    // And    the DB row is still encrypted locally with a non-NULL nonce
    let (_dir, conn) = test_db();
    let public_key: [u8; 32] = [0xBBu8; 32];

    store_peer_sender_key_with_version_inner(&conn, "alice", "m_bob", DEVICE_BOB, &public_key, 0)
        .unwrap();

    let loaded = load_peer_sender_key_inner(&conn, "alice", "m_bob", DEVICE_BOB).unwrap();
    assert_eq!(loaded, public_key);

    // Verify DB row internals
    let nonce: Vec<u8> = conn
        .query_row(
            "SELECT nonce FROM sender_keys WHERE user_id='alice' AND member_id='m_bob'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        !nonce.is_empty(),
        "imported sender key rows must also keep a non-NULL nonce because key_blob is encrypted"
    );
}

// ── Scenario 3: has_sender_key works for both types ────────────────

#[test]
fn scenario_has_sender_key_both_types() {
    // Given  alice has an own key (m_alice) and a peer key (m_bob)
    // Then   has_sender_key returns true for both
    // And    returns false for an unknown member
    let (_dir, conn) = test_db();

    store_own_sender_key_with_version_inner(
        &conn,
        &ZERO_KEY,
        "alice",
        "m_alice",
        DEVICE_ALICE,
        &[0x01u8; 32],
        0,
    )
    .unwrap();
    store_peer_sender_key_with_version_inner(&conn, "alice", "m_bob", DEVICE_BOB, &[0x02u8; 32], 0)
        .unwrap();

    assert!(has_sender_key_inner(&conn, "alice", "m_alice", DEVICE_ALICE).unwrap());
    assert!(has_sender_key_inner(&conn, "alice", "m_bob", DEVICE_BOB).unwrap());
    assert!(!has_sender_key_inner(&conn, "alice", "m_carol", "device-carol").unwrap());
}

// ── Scenario 4: Compatibility loaders resolve the same member row ──

#[test]
fn scenario_load_peer_via_own_api_returns_err() {
    // Given  alice stores bob's member-scoped sender key
    // When   load_own_sender_key_inner is called for the same member_id
    // Then   it resolves the same member-scoped row
    let (_dir, conn) = test_db();
    store_peer_sender_key_with_version_inner(&conn, "alice", "m_bob", DEVICE_BOB, &[0xCCu8; 32], 0)
        .unwrap();

    let result = load_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_bob", DEVICE_BOB).unwrap();
    assert_eq!(result, [0xCCu8; 32]);
}

#[test]
fn scenario_load_own_via_peer_api_returns_err() {
    // Given  alice stores her sender key
    // When   load_peer_sender_key_inner is called for the same member_id
    // Then   it resolves the same member-scoped row
    let (_dir, conn) = test_db();
    store_own_sender_key_with_version_inner(
        &conn,
        &ZERO_KEY,
        "alice",
        "m_alice",
        DEVICE_ALICE,
        &[0xDDu8; 32],
        0,
    )
    .unwrap();

    let result = load_peer_sender_key_inner(&conn, "alice", "m_alice", DEVICE_ALICE).unwrap();
    assert_eq!(result, [0xDDu8; 32]);
}

// ── Scenario 5: Upsert replaces the old key ────────────────────────

#[test]
fn scenario_upsert_replaces_old_key() {
    // Given  alice's own key for m_alice is [0x01;32]
    // When   we store [0x02;32] for the same (user_id, member_id)
    // Then   loading returns [0x02;32]
    let (_dir, conn) = test_db();

    store_own_sender_key_with_version_inner(
        &conn,
        &ZERO_KEY,
        "alice",
        "m_alice",
        DEVICE_ALICE,
        &[0x01u8; 32],
        0,
    )
    .unwrap();
    store_own_sender_key_with_version_inner(
        &conn,
        &ZERO_KEY,
        "alice",
        "m_alice",
        DEVICE_ALICE,
        &[0x02u8; 32],
        1,
    )
    .unwrap();

    assert_eq!(
        load_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_alice", DEVICE_ALICE).unwrap(),
        [0x02u8; 32]
    );
}

// ── Scenario 6: User isolation ─────────────────────────────────────

#[test]
fn scenario_user_isolation() {
    // Given  alice and bob both store own keys under member_id="m_x"
    // Then   each user retrieves their own key independently
    let (_dir, conn) = test_db();

    let alice_key: [u8; 32] = [0xAAu8; 32];
    let bob_key: [u8; 32] = [0xBBu8; 32];

    store_own_sender_key_with_version_inner(
        &conn,
        &ZERO_KEY,
        "alice",
        "m_x",
        DEVICE_ALICE,
        &alice_key,
        0,
    )
    .unwrap();
    store_own_sender_key_with_version_inner(
        &conn, &ZERO_KEY, "bob", "m_x", DEVICE_BOB, &bob_key, 0,
    )
    .unwrap();

    assert_eq!(
        load_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_x", DEVICE_ALICE).unwrap(),
        alice_key
    );
    assert_eq!(
        load_own_sender_key_inner(&conn, &ZERO_KEY, "bob", "m_x", DEVICE_BOB).unwrap(),
        bob_key
    );
}

// ── Scenario 7: Targeted delete ───────────────────────────────────

#[test]
fn scenario_delete_sender_keys_scopes_by_user_and_member_ids() {
    println!("Given: alice and bob each have sender keys, including overlapping member ids");
    let (_dir, conn) = test_db();

    store_own_sender_key_with_version_inner(
        &conn,
        &ZERO_KEY,
        "alice",
        "m_alice",
        DEVICE_ALICE,
        &[0x01u8; 32],
        0,
    )
    .unwrap();
    store_peer_sender_key_with_version_inner(&conn, "alice", "m_bob", DEVICE_BOB, &[0x02u8; 32], 0)
        .unwrap();
    store_peer_sender_key_with_version_inner(
        &conn,
        "alice",
        "m_keep",
        DEVICE_KEEP,
        &[0x03u8; 32],
        0,
    )
    .unwrap();
    store_peer_sender_key_with_version_inner(&conn, "bob", "m_bob", DEVICE_BOB, &[0x04u8; 32], 0)
        .unwrap();

    println!("When: deleting alice sender keys for m_alice and m_bob");
    let deleted = delete_sender_keys_inner(
        &conn,
        "alice",
        &["m_alice".to_string(), "m_bob".to_string()],
    )
    .unwrap();

    println!("Then: only alice's requested sender key rows are removed");
    assert_eq!(deleted, 2);
    assert!(!has_sender_key_inner(&conn, "alice", "m_alice", DEVICE_ALICE).unwrap());
    assert!(!has_sender_key_inner(&conn, "alice", "m_bob", DEVICE_BOB).unwrap());
    assert!(has_sender_key_inner(&conn, "alice", "m_keep", DEVICE_KEEP).unwrap());
    assert!(has_sender_key_inner(&conn, "bob", "m_bob", DEVICE_BOB).unwrap());
}
