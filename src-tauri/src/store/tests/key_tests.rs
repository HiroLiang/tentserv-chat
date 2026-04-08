//! Unit tests for `key_store`.
//!
//! Covers identity keys, signed pre-keys, one-time pre-keys, the OPK counter,
//! and the bulk-clear operation.

use super::{
    clear_all_keys_for_user_inner, delete_otp_key_inner, has_identity_key_inner,
    load_identity_key_inner, load_otp_key_inner, load_signed_pre_key_inner, next_opk_ids_inner,
    store_identity_key_inner, store_otp_key_inner, store_signed_pre_key_inner,
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

// ── Identity keys ─────────────────────────────────────────────────

#[test]
fn scenario_identity_key_store_and_load_both_types() {
    // Given  a 32-byte DH private key (all 0x01) and a signing key (all 0x02)
    // When   both are stored under "alice" with their respective key_types
    // Then   loading "ik_dh" returns the DH bytes
    // And    loading "ik_sign" returns the signing bytes
    // And    has_identity_key returns true for both; false for unknown type
    let (_dir, conn) = test_db();

    let dh_priv = [0x01u8; 32];
    let dh_pub = [0xAAu8; 32];
    let sign_priv = [0x02u8; 32];
    let sign_pub = [0xBBu8; 32];

    store_identity_key_inner(&conn, &ZERO_KEY, "alice", "ik_dh", &dh_priv, &dh_pub).unwrap();
    store_identity_key_inner(&conn, &ZERO_KEY, "alice", "ik_sign", &sign_priv, &sign_pub).unwrap();

    assert_eq!(
        load_identity_key_inner(&conn, &ZERO_KEY, "alice", "ik_dh").unwrap(),
        dh_priv
    );
    assert_eq!(
        load_identity_key_inner(&conn, &ZERO_KEY, "alice", "ik_sign").unwrap(),
        sign_priv
    );

    assert!(has_identity_key_inner(&conn, "alice", "ik_dh").unwrap());
    assert!(has_identity_key_inner(&conn, "alice", "ik_sign").unwrap());
    assert!(
        !has_identity_key_inner(&conn, "alice", "ik_ecdh").unwrap(),
        "unknown type must not exist"
    );
}

#[test]
fn scenario_identity_key_upsert_replaces_old_value() {
    // Given  alice's ik_dh is [0x01; 32]
    // When   we store [0x02; 32] for the same (user, key_type)
    // Then   loading returns [0x02; 32]
    let (_dir, conn) = test_db();

    let pub_key = [0xFFu8; 32];
    store_identity_key_inner(&conn, &ZERO_KEY, "alice", "ik_dh", &[0x01u8; 32], &pub_key).unwrap();
    store_identity_key_inner(&conn, &ZERO_KEY, "alice", "ik_dh", &[0x02u8; 32], &pub_key).unwrap();

    assert_eq!(
        load_identity_key_inner(&conn, &ZERO_KEY, "alice", "ik_dh").unwrap(),
        [0x02u8; 32]
    );
}

// ── Signed pre-keys ───────────────────────────────────────────────

#[test]
fn scenario_signed_pre_key_store_and_load_by_key_id() {
    // Given  SPK with private=[0x03;32], public=[0x04;32], sig=[0x05;64], key_id=7
    // When   stored and loaded by (user="alice", key_id=7)
    // Then   the private bytes match
    let (_dir, conn) = test_db();

    let priv_key: [u8; 32] = [0x03u8; 32];
    let pub_key: [u8; 32] = [0x04u8; 32];
    let signature: [u8; 64] = [0x05u8; 64];

    store_signed_pre_key_inner(
        &conn, &ZERO_KEY, "alice", 7, &priv_key, &pub_key, &signature,
    )
    .unwrap();

    assert_eq!(
        load_signed_pre_key_inner(&conn, &ZERO_KEY, "alice", 7).unwrap(),
        priv_key
    );
}

// ── One-time pre-keys ─────────────────────────────────────────────

#[test]
fn scenario_otp_key_lifecycle_store_load_delete() {
    // Given  OTP key_id=42, private=[0x06;32]
    // When   loaded → returns [0x06;32]
    // When   deleted → loading returns an error
    let (_dir, conn) = test_db();

    let priv_key: [u8; 32] = [0x06u8; 32];
    let pub_key: [u8; 32] = [0x07u8; 32];

    store_otp_key_inner(&conn, &ZERO_KEY, "alice", 42, &priv_key, &pub_key).unwrap();

    assert_eq!(
        load_otp_key_inner(&conn, &ZERO_KEY, "alice", 42).unwrap(),
        priv_key
    );

    delete_otp_key_inner(&conn, "alice", 42).unwrap();

    assert!(
        load_otp_key_inner(&conn, &ZERO_KEY, "alice", 42).is_err(),
        "loading a deleted OTP key must return an error"
    );
}

// ── OPK counter ───────────────────────────────────────────────────

#[test]
fn scenario_opk_counter_sequential_non_overlapping_ids() {
    // Given  no counter exists for "alice"
    // When   request 5 IDs  → [0,1,2,3,4]
    // When   request 3 more → [5,6,7]  (continues from 5)
    // And    a second user "bob" starts from 0 independently
    let (_dir, conn) = test_db();

    let first = next_opk_ids_inner(&conn, "alice", 5).unwrap();
    let second = next_opk_ids_inner(&conn, "alice", 3).unwrap();
    let bob = next_opk_ids_inner(&conn, "bob", 2).unwrap();

    assert_eq!(first, vec![0, 1, 2, 3, 4]);
    assert_eq!(second, vec![5, 6, 7]);
    assert_eq!(bob, vec![0, 1], "bob's counter must start from 0");
}

// ── Bulk clear ────────────────────────────────────────────────────

#[test]
fn scenario_clear_all_keys_removes_target_user_leaves_others() {
    // Given  alice and bob each have identity keys, one OTP key
    // When   clear_all_keys_for_user_inner("alice") is called
    // Then   alice's keys are gone; bob's keys are intact
    let (_dir, conn) = test_db();

    let priv_key: [u8; 32] = [0x10u8; 32];
    let pub_key: [u8; 32] = [0x11u8; 32];

    for user in &["alice", "bob"] {
        store_identity_key_inner(&conn, &ZERO_KEY, user, "ik_dh", &priv_key, &pub_key).unwrap();
        store_identity_key_inner(&conn, &ZERO_KEY, user, "ik_sign", &priv_key, &pub_key).unwrap();
        store_otp_key_inner(&conn, &ZERO_KEY, user, 1, &priv_key, &pub_key).unwrap();
    }

    clear_all_keys_for_user_inner(&conn, "alice").unwrap();

    // Alice's keys are gone
    assert!(!has_identity_key_inner(&conn, "alice", "ik_dh").unwrap());
    assert!(!has_identity_key_inner(&conn, "alice", "ik_sign").unwrap());
    assert!(load_otp_key_inner(&conn, &ZERO_KEY, "alice", 1).is_err());

    // Bob's keys are intact
    assert!(has_identity_key_inner(&conn, "bob", "ik_dh").unwrap());
    assert!(has_identity_key_inner(&conn, "bob", "ik_sign").unwrap());
    assert!(load_otp_key_inner(&conn, &ZERO_KEY, "bob", 1).is_ok());
}
