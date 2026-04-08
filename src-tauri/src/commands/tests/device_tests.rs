use crate::commands::core::get_or_create_device_core;
use crate::store::db::init_schema;
use rusqlite::Connection;
use std::time::Instant;
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
    let started = Instant::now();
    // Given an empty DB
    let (_dir, conn) = test_db();
    println!("Given: empty local SQLite device_info table");
    println!("Input: device_name={NAME_A:?}");

    // When get_or_create_device_core is called
    println!("Action: call get_or_create_device_core for first launch");
    let info = get_or_create_device_core(&conn, NAME_A).unwrap();

    // Then a DeviceInfo with the correct name and defaults is returned
    println!(
        "Output: device_id={} platform={} device_name={:?} registered={} created_at={}",
        info.device_id, info.platform, info.device_name, info.registered, info.created_at
    );
    println!("Mutation: inserted one local device row with registered=false");
    println!("Duration: {:?}", started.elapsed());
    assert_eq!(info.device_name, NAME_A);
    assert!(!info.registered);
}

#[test]
fn device_id_is_valid_uuid() {
    let started = Instant::now();
    // Given an empty DB
    let (_dir, conn) = test_db();
    println!("Given: empty local SQLite device_info table");
    println!("Input: device_name={NAME_A:?}");

    // When a device record is created
    println!("Action: create local device row");
    let info = get_or_create_device_core(&conn, NAME_A).unwrap();

    // Then the device_id is a valid UUID
    println!("Output: generated_device_id={}", info.device_id);
    println!("Mutation: inserted device row and generated UUID");
    println!("Duration: {:?}", started.elapsed());
    assert!(
        Uuid::parse_str(&info.device_id).is_ok(),
        "device_id must be a valid UUID"
    );
}

#[test]
fn platform_matches_compile_time_os() {
    let started = Instant::now();
    // Given an empty DB
    let (_dir, conn) = test_db();
    println!("Given: empty local SQLite device_info table");
    println!("Input: compile_time_os={}", std::env::consts::OS);

    // When a device record is created
    println!("Action: create local device row");
    let info = get_or_create_device_core(&conn, NAME_A).unwrap();

    // Then the platform is the current OS
    println!("Output: platform={}", info.platform);
    println!("Mutation: inserted platform from Rust std::env::consts::OS");
    println!("Duration: {:?}", started.elapsed());
    assert_eq!(info.platform, std::env::consts::OS);
}

#[test]
fn second_call_preserves_uuid() {
    let started = Instant::now();
    // Given a device already stored
    let (_dir, conn) = test_db();
    let first = get_or_create_device_core(&conn, NAME_A).unwrap();
    println!(
        "Given: existing device row device_id={} device_name={:?}",
        first.device_id, first.device_name
    );
    println!("Input: second_call_device_name={NAME_A:?}");

    // When called again with the same DB
    println!("Action: call get_or_create_device_core against existing row");
    let second = get_or_create_device_core(&conn, NAME_A).unwrap();

    // Then the UUID is identical (not regenerated)
    println!(
        "Output: first_device_id={} second_device_id={}",
        first.device_id, second.device_id
    );
    println!("Mutation: updated existing row without regenerating device_id");
    println!("Duration: {:?}", started.elapsed());
    assert_eq!(first.device_id, second.device_id);
}

#[test]
fn second_call_updates_device_name() {
    let started = Instant::now();
    // Given a device stored with NAME_A
    let (_dir, conn) = test_db();
    let first = get_or_create_device_core(&conn, NAME_A).unwrap();
    println!(
        "Given: existing device row device_id={} device_name={:?}",
        first.device_id, first.device_name
    );
    println!("Input: new_device_name={NAME_B:?}");

    // When called again with NAME_B
    println!("Action: call get_or_create_device_core with refreshed device name");
    let second = get_or_create_device_core(&conn, NAME_B).unwrap();

    // Then name is updated but UUID is unchanged
    println!(
        "Output: device_id={} device_name={:?}",
        second.device_id, second.device_name
    );
    println!("Mutation: refreshed device_name while preserving device_id");
    println!("Duration: {:?}", started.elapsed());
    assert_eq!(second.device_name, NAME_B);
    assert_eq!(first.device_id, second.device_id);
}

#[test]
fn created_at_is_positive_timestamp() {
    let started = Instant::now();
    // Given an empty DB
    let (_dir, conn) = test_db();
    println!("Given: empty local SQLite device_info table");
    println!("Input: device_name={NAME_A:?}");

    // When a device record is created
    println!("Action: create local device row");
    let info = get_or_create_device_core(&conn, NAME_A).unwrap();

    // Then created_at is a positive Unix timestamp in milliseconds
    println!("Output: created_at={}", info.created_at);
    println!("Mutation: stored first-seen timestamp in milliseconds");
    println!("Duration: {:?}", started.elapsed());
    assert!(info.created_at > 0, "created_at must be positive");
}
