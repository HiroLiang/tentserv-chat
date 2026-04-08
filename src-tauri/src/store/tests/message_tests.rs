//! Unit tests for `message_store`.
//!
//! Covers encrypted message pagination, idempotent inserts, and
//! decrypted message re-encryption at rest.

use super::{
    get_decrypted_messages_inner, get_encrypted_messages_inner, store_decrypted_message_inner,
    store_encrypted_message_inner,
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

// ── Encrypted messages ────────────────────────────────────────────

#[test]
fn scenario_encrypted_messages_pagination_newest_first() {
    // Given  3 messages in room "r1" at timestamps 100, 200, 300
    // When   fetch with limit=2, no cursor
    // Then   get [ts=300, ts=200] (newest first)
    // When   fetch with before_timestamp=200
    // Then   get [ts=100]
    let (_dir, conn) = test_db();

    for (id, ts) in [("msg1", 100i64), ("msg2", 200), ("msg3", 300)] {
        store_encrypted_message_inner(
            &conn,
            id,
            "r1",
            "sender1",
            b"ciphertext",
            "sender_key",
            None,
            None,
            ts,
        )
        .unwrap();
    }

    let page1 = get_encrypted_messages_inner(&conn, "r1", 2, None).unwrap();
    assert_eq!(page1.len(), 2);
    assert_eq!(
        page1[0].server_timestamp, 300,
        "first result must be newest"
    );
    assert_eq!(page1[1].server_timestamp, 200);

    let page2 = get_encrypted_messages_inner(&conn, "r1", 2, Some(200)).unwrap();
    assert_eq!(page2.len(), 1);
    assert_eq!(page2[0].server_timestamp, 100);
}

#[test]
fn scenario_encrypted_message_idempotent_on_duplicate_insert() {
    // Given  message "msg1" is stored once
    // When   stored again with different content (re-pull)
    // Then   DB has exactly 1 row — INSERT OR IGNORE; original payload wins
    let (_dir, conn) = test_db();

    store_encrypted_message_inner(
        &conn,
        "msg1",
        "r1",
        "alice",
        b"first_payload",
        "sender_key",
        None,
        None,
        1000,
    )
    .unwrap();
    store_encrypted_message_inner(
        &conn,
        "msg1",
        "r1",
        "alice",
        b"second_payload",
        "sender_key",
        None,
        None,
        1000,
    )
    .unwrap();

    let rows = get_encrypted_messages_inner(&conn, "r1", 10, None).unwrap();
    assert_eq!(rows.len(), 1, "duplicate insert must be ignored");
    assert_eq!(
        rows[0].encrypted_content, b"first_payload",
        "original payload must be preserved"
    );
}

#[test]
fn scenario_encrypted_messages_room_isolation() {
    // Given  messages in rooms "r1" and "r2"
    // Then   each room query returns only its own messages
    let (_dir, conn) = test_db();

    store_encrypted_message_inner(&conn, "m1", "r1", "alice", b"r1_msg", "sk", None, None, 100)
        .unwrap();
    store_encrypted_message_inner(&conn, "m2", "r2", "bob", b"r2_msg", "sk", None, None, 200)
        .unwrap();

    let r1_msgs = get_encrypted_messages_inner(&conn, "r1", 10, None).unwrap();
    let r2_msgs = get_encrypted_messages_inner(&conn, "r2", 10, None).unwrap();

    assert_eq!(r1_msgs.len(), 1);
    assert_eq!(r2_msgs.len(), 1);
    assert_eq!(r1_msgs[0].message_id, "m1");
    assert_eq!(r2_msgs[0].message_id, "m2");
}

// ── Decrypted messages ────────────────────────────────────────────

#[test]
fn scenario_decrypted_message_encrypted_at_rest_and_readable_via_api() {
    // Given  plaintext b"Hello, world!" stored for alice in room "r1"
    // When   the raw DB column is read directly
    // Then   the raw bytes are NOT equal to the plaintext (stored encrypted)
    // When   loaded via get_decrypted_messages_inner
    // Then   the returned plaintext IS b"Hello, world!"
    let (_dir, conn) = test_db();

    let original: &[u8] = b"Hello, world!";
    store_decrypted_message_inner(
        &conn, &ZERO_KEY, "alice", "msg1", "r1", "bob", original, "text", 1000, None, false, false,
    )
    .unwrap();

    let raw: Vec<u8> = conn
        .query_row(
            "SELECT encrypted_plaintext FROM decrypted_messages \
         WHERE message_id = 'msg1' AND user_id = 'alice'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_ne!(raw, original, "plaintext must NOT be stored in the clear");

    let msgs = get_decrypted_messages_inner(&conn, &ZERO_KEY, "alice", "r1", 10, None).unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].plaintext, original);
}

#[test]
fn scenario_decrypted_messages_pagination_newest_first() {
    // Given  3 messages for alice in room "r1" at ts 10, 20, 30
    // When   fetch limit=2 no cursor → [ts=30, ts=20]
    // When   fetch before_timestamp=20 → [ts=10]
    let (_dir, conn) = test_db();

    for (id, ts) in [("m1", 10i64), ("m2", 20), ("m3", 30)] {
        store_decrypted_message_inner(
            &conn, &ZERO_KEY, "alice", id, "r1", "bob", b"hi", "text", ts, None, false, false,
        )
        .unwrap();
    }

    let page1 = get_decrypted_messages_inner(&conn, &ZERO_KEY, "alice", "r1", 2, None).unwrap();
    assert_eq!(page1.len(), 2);
    assert_eq!(page1[0].message_timestamp, 30);
    assert_eq!(page1[1].message_timestamp, 20);

    let page2 = get_decrypted_messages_inner(&conn, &ZERO_KEY, "alice", "r1", 2, Some(20)).unwrap();
    assert_eq!(page2.len(), 1);
    assert_eq!(page2[0].message_timestamp, 10);
}

#[test]
fn scenario_decrypted_messages_user_isolation() {
    // Given  alice and bob both have a message in room "r1"
    // Then   each user's query returns only their own messages
    let (_dir, conn) = test_db();

    store_decrypted_message_inner(
        &conn, &ZERO_KEY, "alice", "msg_a", "r1", "carol", b"for alice", "text", 100, None, false,
        false,
    )
    .unwrap();
    store_decrypted_message_inner(
        &conn, &ZERO_KEY, "bob", "msg_b", "r1", "carol", b"for bob", "text", 200, None, false,
        false,
    )
    .unwrap();

    let alice_msgs =
        get_decrypted_messages_inner(&conn, &ZERO_KEY, "alice", "r1", 10, None).unwrap();
    let bob_msgs = get_decrypted_messages_inner(&conn, &ZERO_KEY, "bob", "r1", 10, None).unwrap();

    assert_eq!(alice_msgs.len(), 1);
    assert_eq!(alice_msgs[0].plaintext, b"for alice");
    assert_eq!(bob_msgs.len(), 1);
    assert_eq!(bob_msgs[0].plaintext, b"for bob");
}
