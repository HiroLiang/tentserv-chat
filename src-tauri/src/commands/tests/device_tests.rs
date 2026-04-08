use crate::commands::core::get_or_create_device_core;
use crate::store::db::init_schema;
use rusqlite::Connection;
use tempfile::TempDir;
use uuid::Uuid;

// ── Fixtures ────────────────────────────────────────────────────────

/// Input: replace with any hostname string to test different device names.
const NAME_A: &str = "MacBook Pro";
const NAME_B: &str = "Test Machine";

fn test_db() -> (TempDir, Connection) {
    let dir = TempDir::new().unwrap();
    let conn = Connection::open(dir.path().join("test.db")).unwrap();
    init_schema(&conn).unwrap();
    (dir, conn)
}

// ── Scenarios ───────────────────────────────────────────────────────

#[test]
fn first_launch_creates_device() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When get_or_create_device_core is called
    let info = get_or_create_device_core(&conn, NAME_A).unwrap();

    // Then a DeviceInfo with the correct name and defaults is returned
    assert_eq!(info.device_name, NAME_A);
    assert!(!info.registered);
}

#[test]
fn device_id_is_valid_uuid() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When a device record is created
    let info = get_or_create_device_core(&conn, NAME_A).unwrap();

    // Then the device_id is a valid UUID
    assert!(
        Uuid::parse_str(&info.device_id).is_ok(),
        "device_id must be a valid UUID"
    );
}

#[test]
fn platform_matches_compile_time_os() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When a device record is created
    let info = get_or_create_device_core(&conn, NAME_A).unwrap();

    // Then the platform is the current OS
    assert_eq!(info.platform, std::env::consts::OS);
}

#[test]
fn second_call_preserves_uuid() {
    // Given a device already stored
    let (_dir, conn) = test_db();
    let first = get_or_create_device_core(&conn, NAME_A).unwrap();

    // When called again with the same DB
    let second = get_or_create_device_core(&conn, NAME_A).unwrap();

    // Then the UUID is identical (not regenerated)
    assert_eq!(first.device_id, second.device_id);
}

#[test]
fn second_call_updates_device_name() {
    // Given a device stored with NAME_A
    let (_dir, conn) = test_db();
    let first = get_or_create_device_core(&conn, NAME_A).unwrap();

    // When called again with NAME_B
    let second = get_or_create_device_core(&conn, NAME_B).unwrap();

    // Then name is updated but UUID is unchanged
    assert_eq!(second.device_name, NAME_B);
    assert_eq!(first.device_id, second.device_id);
}

#[test]
fn created_at_is_positive_timestamp() {
    // Given an empty DB
    let (_dir, conn) = test_db();

    // When a device record is created
    let info = get_or_create_device_core(&conn, NAME_A).unwrap();

    // Then created_at is a positive Unix timestamp in milliseconds
    assert!(info.created_at > 0, "created_at must be positive");
}
