use crate::commands::core::{
    get_decrypted_messages_core, get_encrypted_messages_core, store_decrypted_message_core,
    store_encrypted_message_core,
};
use crate::store::db::init_schema;
use rusqlite::Connection;
use tempfile::TempDir;

// ── Fixtures ────────────────────────────────────────────────────────

/// Input: swap for any 32-byte key to test different encryption keys.
const ZERO_KEY: [u8; 32] = [0u8; 32];

/// Input: replace with any room / sender / message ID strings.
const ROOM_A: &str = "room-abc";
const ROOM_B: &str = "room-xyz";
const SENDER: &str = "user-sender";
const USER: &str = "user-self";
const MSG_001: &str = "msg-001";

/// Input: replace with any byte content to test different payloads.
const CIPHERTEXT: &[u8] = b"encrypted_bytes";
const PLAINTEXT: &[u8] = b"hello world";

fn test_db() -> (TempDir, Connection) {
    let dir = TempDir::new().unwrap();
    let conn = Connection::open(dir.path().join("test.db")).unwrap();
    init_schema(&conn).unwrap();
    (dir, conn)
}

// ── Encrypted message scenarios ──────────────────────────────────────

#[test]
fn store_and_retrieve_encrypted_message() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When storing an encrypted message
    store_encrypted_message_core(
        &conn,
        MSG_001,
        ROOM_A,
        SENDER,
        CIPHERTEXT.to_vec(),
        "text",
        Some(1),
        Some(2),
        1_000_000,
    )
    .unwrap();

    // Then retrieving returns it
    let msgs = get_encrypted_messages_core(&conn, ROOM_A, 10, None).unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].message_id, MSG_001);
    assert_eq!(msgs[0].encrypted_content, CIPHERTEXT);
    assert_eq!(msgs[0].server_timestamp, 1_000_000);
}

#[test]
fn get_encrypted_messages_respects_limit() {
    // Given 5 messages stored
    let (_dir, conn) = test_db();
    for i in 0..5u64 {
        store_encrypted_message_core(
            &conn,
            &format!("msg-{i}"),
            ROOM_A,
            SENDER,
            CIPHERTEXT.to_vec(),
            "text",
            None,
            None,
            i as i64 * 1000,
        )
        .unwrap();
    }

    // When fetching with limit=3
    let msgs = get_encrypted_messages_core(&conn, ROOM_A, 3, None).unwrap();

    // Then only 3 are returned
    assert_eq!(msgs.len(), 3);
}

#[test]
fn duplicate_encrypted_message_is_ignored() {
    // Given a message stored once
    let (_dir, conn) = test_db();
    store_encrypted_message_core(
        &conn,
        MSG_001,
        ROOM_A,
        SENDER,
        CIPHERTEXT.to_vec(),
        "text",
        None,
        None,
        1_000,
    )
    .unwrap();

    // When the same message_id is stored again
    store_encrypted_message_core(
        &conn,
        MSG_001,
        ROOM_A,
        SENDER,
        b"other".to_vec(),
        "text",
        None,
        None,
        2_000,
    )
    .unwrap();

    // Then only the first write is kept (INSERT OR IGNORE semantics)
    let msgs = get_encrypted_messages_core(&conn, ROOM_A, 10, None).unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].encrypted_content, CIPHERTEXT);
}

// ── Decrypted message scenarios ───────────────────────────────────────

#[test]
fn store_and_retrieve_decrypted_message() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When storing a decrypted message
    store_decrypted_message_core(
        &conn,
        &ZERO_KEY,
        USER,
        MSG_001,
        ROOM_A,
        SENDER,
        PLAINTEXT.to_vec(),
        "text",
        1_000_000,
        None,
        false,
        false,
    )
    .unwrap();

    // Then retrieving decrypts and returns the original plaintext
    let msgs = get_decrypted_messages_core(&conn, &ZERO_KEY, USER, ROOM_A, 10, None).unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].message_id, MSG_001);
    assert_eq!(msgs[0].plaintext, PLAINTEXT);
    assert_eq!(msgs[0].reply_to_id, None);
    assert!(!msgs[0].is_edited);
    assert!(!msgs[0].is_deleted);
}

#[test]
fn room_isolation_for_decrypted_messages() {
    // Given messages stored in two different rooms
    let (_dir, conn) = test_db();
    store_decrypted_message_core(
        &conn,
        &ZERO_KEY,
        USER,
        "msg-a",
        ROOM_A,
        SENDER,
        PLAINTEXT.to_vec(),
        "text",
        1_000,
        None,
        false,
        false,
    )
    .unwrap();
    store_decrypted_message_core(
        &conn,
        &ZERO_KEY,
        USER,
        "msg-b",
        ROOM_B,
        SENDER,
        PLAINTEXT.to_vec(),
        "text",
        2_000,
        None,
        false,
        false,
    )
    .unwrap();

    // When fetching for room A only
    let msgs_a = get_decrypted_messages_core(&conn, &ZERO_KEY, USER, ROOM_A, 10, None).unwrap();
    let msgs_b = get_decrypted_messages_core(&conn, &ZERO_KEY, USER, ROOM_B, 10, None).unwrap();

    // Then each room returns only its own messages
    assert_eq!(msgs_a.len(), 1);
    assert_eq!(msgs_a[0].message_id, "msg-a");
    assert_eq!(msgs_b.len(), 1);
    assert_eq!(msgs_b[0].message_id, "msg-b");
}
