//! Unit tests for `sender_key_store`.
//!
//! Validates the private/public key distinction and the removal of `room_id`
//! from the primary key.  Each test scenario follows the Given/When/Then pattern.

use super::{
    has_sender_key_inner, load_own_sender_key_inner, load_peer_sender_key_inner,
    store_own_sender_key_inner, store_peer_sender_key_inner,
};
use crate::store::db::init_schema;
use rusqlite::Connection;
use tempfile::TempDir;

const ZERO_KEY: [u8; 32] = [0u8; 32];

fn test_db() -> (TempDir, Connection) {
    let dir = TempDir::new().unwrap();
    let conn = Connection::open(dir.path().join("test.db")).unwrap();
    init_schema(&conn).unwrap();
    (dir, conn)
}

// ── Scenario 1: Own key is encrypted at rest ───────────────────────

#[test]
fn scenario_own_key_encrypted_storage() {
    // Given  alice's own sender key (member_id="m_alice", 32 bytes)
    // When   stored via store_own_sender_key_inner
    // Then   load_own_sender_key_inner returns the original bytes
    // And    the DB row has is_private=1 and a non-NULL nonce
    let (_dir, conn) = test_db();
    let private_key: [u8; 32] = [0xAAu8; 32];

    store_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_alice", &private_key).unwrap();

    let loaded = load_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_alice").unwrap();
    assert_eq!(loaded, private_key);

    // Verify DB row internals
    let (is_private, nonce): (i64, Option<Vec<u8>>) = conn
        .query_row(
            "SELECT is_private, nonce FROM sender_keys WHERE user_id='alice' AND member_id='m_alice'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(is_private, 1, "own key must have is_private=1");
    assert!(nonce.is_some(), "own key must have a non-NULL nonce");
}

// ── Scenario 2: Peer key is stored as plaintext ────────────────────

#[test]
fn scenario_peer_key_plaintext_storage() {
    // Given  alice stores bob's public sender key (member_id="m_bob")
    // When   stored via store_peer_sender_key_inner
    // Then   load_peer_sender_key_inner returns the original bytes
    // And    the DB row has is_private=0 and nonce IS NULL
    let (_dir, conn) = test_db();
    let public_key: [u8; 32] = [0xBBu8; 32];

    store_peer_sender_key_inner(&conn, "alice", "m_bob", &public_key).unwrap();

    let loaded = load_peer_sender_key_inner(&conn, "alice", "m_bob").unwrap();
    assert_eq!(loaded, public_key);

    // Verify DB row internals
    let (is_private, nonce): (i64, Option<Vec<u8>>) = conn
        .query_row(
            "SELECT is_private, nonce FROM sender_keys WHERE user_id='alice' AND member_id='m_bob'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(is_private, 0, "peer key must have is_private=0");
    assert!(nonce.is_none(), "peer key must have nonce IS NULL");
}

// ── Scenario 3: has_sender_key works for both types ────────────────

#[test]
fn scenario_has_sender_key_both_types() {
    // Given  alice has an own key (m_alice) and a peer key (m_bob)
    // Then   has_sender_key returns true for both
    // And    returns false for an unknown member
    let (_dir, conn) = test_db();

    store_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_alice", &[0x01u8; 32]).unwrap();
    store_peer_sender_key_inner(&conn, "alice", "m_bob", &[0x02u8; 32]).unwrap();

    assert!(has_sender_key_inner(&conn, "alice", "m_alice").unwrap());
    assert!(has_sender_key_inner(&conn, "alice", "m_bob").unwrap());
    assert!(!has_sender_key_inner(&conn, "alice", "m_carol").unwrap());
}

// ── Scenario 4: API guard — loading wrong type returns Err ─────────

#[test]
fn scenario_load_peer_via_own_api_returns_err() {
    // Given  alice stores bob's peer key
    // When   load_own_sender_key_inner is called for the same member_id
    // Then   it returns an error (is_private mismatch)
    let (_dir, conn) = test_db();
    store_peer_sender_key_inner(&conn, "alice", "m_bob", &[0xCCu8; 32]).unwrap();

    let result = load_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_bob");
    assert!(result.is_err(), "must not load a peer key via own-key API");
    assert!(result.unwrap_err().contains("peer key"));
}

#[test]
fn scenario_load_own_via_peer_api_returns_err() {
    // Given  alice stores her own key
    // When   load_peer_sender_key_inner is called for the same member_id
    // Then   it returns an error (is_private mismatch)
    let (_dir, conn) = test_db();
    store_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_alice", &[0xDDu8; 32]).unwrap();

    let result = load_peer_sender_key_inner(&conn, "alice", "m_alice");
    assert!(result.is_err(), "must not load an own key via peer-key API");
    assert!(result.unwrap_err().contains("own key"));
}

// ── Scenario 5: Upsert replaces the old key ────────────────────────

#[test]
fn scenario_upsert_replaces_old_key() {
    // Given  alice's own key for m_alice is [0x01;32]
    // When   we store [0x02;32] for the same (user_id, member_id)
    // Then   loading returns [0x02;32]
    let (_dir, conn) = test_db();

    store_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_alice", &[0x01u8; 32]).unwrap();
    store_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_alice", &[0x02u8; 32]).unwrap();

    assert_eq!(
        load_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_alice").unwrap(),
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

    store_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_x", &alice_key).unwrap();
    store_own_sender_key_inner(&conn, &ZERO_KEY, "bob", "m_x", &bob_key).unwrap();

    assert_eq!(
        load_own_sender_key_inner(&conn, &ZERO_KEY, "alice", "m_x").unwrap(),
        alice_key
    );
    assert_eq!(
        load_own_sender_key_inner(&conn, &ZERO_KEY, "bob", "m_x").unwrap(),
        bob_key
    );
}
