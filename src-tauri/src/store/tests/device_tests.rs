//! Unit tests for `device_store`.
//!
//! Uses an in-memory-equivalent temp SQLite DB with the production schema.
//! No AppHandle, no OS keyring — pure logic tests.

use super::{
    clear_device_info_inner, load_device_info_inner, store_device_info_inner,
    test_conn_with_schema, update_device_registered_inner, DeviceInfo,
};

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
    // Given  the DB is empty (first launch)
    // When   we store a DeviceInfo
    // Then   loading it returns the same values
    let (_dir, conn) = test_conn_with_schema();

    let info = sample_device();
    store_device_info_inner(&conn, &info).unwrap();

    let loaded = load_device_info_inner(&conn)
        .unwrap()
        .expect("should have device info");
    assert_eq!(loaded.device_id, info.device_id);
    assert_eq!(loaded.platform, info.platform);
    assert_eq!(loaded.device_name, info.device_name);
    assert_eq!(loaded.registered, false);
    assert_eq!(loaded.created_at, info.created_at);
}

// ── Scenario 2: No device info yet ───────────────────────────────

#[test]
fn scenario_load_returns_none_when_absent() {
    // Given  a fresh DB with no device row
    // Then   load_device_info_inner returns None
    let (_dir, conn) = test_conn_with_schema();
    let result = load_device_info_inner(&conn).unwrap();
    assert!(
        result.is_none(),
        "expected None before any device is stored"
    );
}

// ── Scenario 3: Upsert preserves device_id across restarts ───────

#[test]
fn scenario_upsert_preserves_device_id() {
    // Given  device "uuid-abc" is already stored
    // When   we store a new DeviceInfo (same id, different name)
    // Then   the stored row is updated — device_id stays the same
    let (_dir, conn) = test_conn_with_schema();

    let original = sample_device();
    store_device_info_inner(&conn, &original).unwrap();

    let updated = DeviceInfo {
        device_name: "Renamed Mac".to_string(),
        ..original.clone()
    };
    store_device_info_inner(&conn, &updated).unwrap();

    let loaded = load_device_info_inner(&conn).unwrap().unwrap();
    assert_eq!(
        loaded.device_id, original.device_id,
        "device_id must not change"
    );
    assert_eq!(loaded.device_name, "Renamed Mac");
}

// ── Scenario 4: Mark device as registered ────────────────────────

#[test]
fn scenario_update_device_registered() {
    // Given  a device stored with registered=false
    // When   update_device_registered_inner(true) is called
    // Then   loading returns registered=true
    let (_dir, conn) = test_conn_with_schema();

    store_device_info_inner(&conn, &sample_device()).unwrap();
    update_device_registered_inner(&conn, true).unwrap();

    let loaded = load_device_info_inner(&conn).unwrap().unwrap();
    assert!(loaded.registered, "device should be marked registered");
}

#[test]
fn scenario_update_registered_errors_when_no_device() {
    // Given  an empty DB
    // When   update_device_registered_inner is called
    // Then   it returns an error (no row to update)
    let (_dir, conn) = test_conn_with_schema();
    let result = update_device_registered_inner(&conn, true);
    assert!(result.is_err(), "should error when no device row exists");
}

// ── Scenario 5: Clear device info ────────────────────────────────

#[test]
fn scenario_clear_device_info() {
    // Given  device info is stored
    // When   clear_device_info_inner is called
    // Then   loading returns None
    let (_dir, conn) = test_conn_with_schema();

    store_device_info_inner(&conn, &sample_device()).unwrap();
    clear_device_info_inner(&conn).unwrap();

    let result = load_device_info_inner(&conn).unwrap();
    assert!(result.is_none(), "device info should be cleared");
}
