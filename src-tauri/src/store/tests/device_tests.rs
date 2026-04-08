//! Unit tests for `device_store`.
//!
//! Uses an in-memory-equivalent temp SQLite DB with the production schema.
//! No AppHandle, no OS keyring — pure logic tests.

use super::{
    clear_device_info_inner, load_device_info_inner, store_device_info_inner,
    test_conn_with_schema, update_device_registered_inner, DeviceInfo,
};
use std::time::Instant;

fn sample_device() -> DeviceInfo {
    DeviceInfo {
        device_id: "test-uuid-1234".to_string(),
        platform: "macos".to_string(),
        device_name: "Test Mac".to_string(),
        registered: false,
        created_at: 1_700_000_000_000,
    }
}

// ── Scenario 1: First launch ──────────────────────────────────────

#[test]
fn scenario_store_and_load_device_info() {
    let started = Instant::now();
    // Given  the DB is empty (first launch)
    // When   we store a DeviceInfo
    // Then   loading it returns the same values
    let (_dir, conn) = test_conn_with_schema();

    let info = sample_device();
    println!("Given: empty local SQLite device_info table");
    println!("Input: device_info={info:?}");
    println!("Action: store_device_info_inner then load_device_info_inner");
    store_device_info_inner(&conn, &info).unwrap();

    let loaded = load_device_info_inner(&conn)
        .unwrap()
        .expect("should have device info");
    println!("Output: loaded_device_info={loaded:?}");
    println!("Mutation: inserted one local device row");
    println!("Duration: {:?}", started.elapsed());
    assert_eq!(loaded.device_id, info.device_id);
    assert_eq!(loaded.platform, info.platform);
    assert_eq!(loaded.device_name, info.device_name);
    assert_eq!(loaded.registered, false);
    assert_eq!(loaded.created_at, info.created_at);
}

// ── Scenario 2: No device info yet ───────────────────────────────

#[test]
fn scenario_load_returns_none_when_absent() {
    let started = Instant::now();
    // Given  a fresh DB with no device row
    // Then   load_device_info_inner returns None
    let (_dir, conn) = test_conn_with_schema();
    println!("Given: empty local SQLite device_info table");
    println!("Input: no device row");
    println!("Action: load_device_info_inner");
    let result = load_device_info_inner(&conn).unwrap();
    println!("Output: result={result:?}");
    println!("Mutation: none");
    println!("Duration: {:?}", started.elapsed());
    assert!(
        result.is_none(),
        "expected None before any device is stored"
    );
}

// ── Scenario 3: Upsert preserves device_id across restarts ───────

#[test]
fn scenario_upsert_preserves_device_id() {
    let started = Instant::now();
    // Given  device "uuid-abc" is already stored
    // When   we store a new DeviceInfo (same id, different name)
    // Then   the stored row is updated — device_id stays the same
    let (_dir, conn) = test_conn_with_schema();

    let original = sample_device();
    println!("Given: original_device_info={original:?}");
    store_device_info_inner(&conn, &original).unwrap();

    let updated = DeviceInfo {
        device_name: "Renamed Mac".to_string(),
        ..original.clone()
    };
    println!("Input: updated_device_info={updated:?}");
    println!("Action: store_device_info_inner upsert with same row id");
    store_device_info_inner(&conn, &updated).unwrap();

    let loaded = load_device_info_inner(&conn).unwrap().unwrap();
    println!("Output: loaded_device_info={loaded:?}");
    println!("Mutation: updated device_name while preserving device_id");
    println!("Duration: {:?}", started.elapsed());
    assert_eq!(
        loaded.device_id, original.device_id,
        "device_id must not change"
    );
    assert_eq!(loaded.device_name, "Renamed Mac");
}

// ── Scenario 4: Mark device as registered ────────────────────────

#[test]
fn scenario_update_device_registered() {
    let started = Instant::now();
    // Given  a device stored with registered=false
    // When   update_device_registered_inner(true) is called
    // Then   loading returns registered=true
    let (_dir, conn) = test_conn_with_schema();

    let info = sample_device();
    println!("Given: stored_device_info={info:?}");
    store_device_info_inner(&conn, &info).unwrap();
    println!("Input: registered=true");
    println!("Action: update_device_registered_inner");
    update_device_registered_inner(&conn, true).unwrap();

    let loaded = load_device_info_inner(&conn).unwrap().unwrap();
    println!("Output: loaded_device_info={loaded:?}");
    println!("Mutation: registered flag changed false -> true");
    println!("Duration: {:?}", started.elapsed());
    assert!(loaded.registered, "device should be marked registered");
}

#[test]
fn scenario_update_registered_errors_when_no_device() {
    let started = Instant::now();
    // Given  an empty DB
    // When   update_device_registered_inner is called
    // Then   it returns an error (no row to update)
    let (_dir, conn) = test_conn_with_schema();
    println!("Given: empty local SQLite device_info table");
    println!("Input: registered=true");
    println!("Action: update_device_registered_inner without existing row");
    let result = update_device_registered_inner(&conn, true);
    println!("Output: result={result:?}");
    println!("Mutation: none");
    println!("Duration: {:?}", started.elapsed());
    assert!(result.is_err(), "should error when no device row exists");
}

// ── Scenario 5: Clear device info ────────────────────────────────

#[test]
fn scenario_clear_device_info() {
    let started = Instant::now();
    // Given  device info is stored
    // When   clear_device_info_inner is called
    // Then   loading returns None
    let (_dir, conn) = test_conn_with_schema();

    let info = sample_device();
    println!("Given: stored_device_info={info:?}");
    store_device_info_inner(&conn, &info).unwrap();
    println!("Input: clear current device row");
    println!("Action: clear_device_info_inner then load_device_info_inner");
    clear_device_info_inner(&conn).unwrap();

    let result = load_device_info_inner(&conn).unwrap();
    println!("Output: result={result:?}");
    println!("Mutation: deleted local device row");
    println!("Duration: {:?}", started.elapsed());
    assert!(result.is_none(), "device info should be cleared");
}
