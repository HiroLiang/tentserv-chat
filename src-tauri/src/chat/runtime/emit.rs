use crate::chat::events::{
    emit_room_updated, emit_rooms_updated, emit_sync_state_changed,
};
use crate::chat::{ChatRoomSnapshotRequest, ChatRoomsSnapshot, ChatSyncState};

use super::SharedRuntime;

impl SharedRuntime {
    pub(super) fn emit_rooms_snapshot(&self) -> Result<(), String> {
        let snapshot = self.local_rooms_snapshot()?;
        emit_rooms_updated(&self.app, &snapshot)
    }

    pub(super) fn emit_rooms_snapshot_best_effort(&self, reason: &str) {
        if let Err(error) = self.emit_rooms_snapshot() {
            log::warn!(
                "chat runtime: failed to emit rooms snapshot reason={} error={}",
                reason,
                error
            );
        }
    }

    pub(super) fn emit_rooms_snapshot_payload_best_effort(
        &self,
        snapshot: &ChatRoomsSnapshot,
        reason: &str,
    ) {
        if let Err(error) = emit_rooms_updated(&self.app, snapshot) {
            log::warn!(
                "chat runtime: failed to emit rooms snapshot payload reason={} error={}",
                reason,
                error
            );
        }
    }

    pub(super) fn emit_room_snapshot(&self, room_id: i64) -> Result<(), String> {
        let request = ChatRoomSnapshotRequest {
            room_id,
            before_sort_key: None,
            limit: None,
            force_refresh: None,
        };
        if let Some(snapshot) = self.local_room_snapshot(&request)? {
            emit_room_updated(&self.app, &snapshot)?;
        }
        Ok(())
    }

    pub(super) fn emit_room_snapshot_best_effort(&self, room_id: i64, reason: &str) {
        if let Err(error) = self.emit_room_snapshot(room_id) {
            log::warn!(
                "chat runtime: failed to emit room snapshot room_id={} reason={} error={}",
                room_id,
                reason,
                error
            );
        }
    }

    pub(super) fn emit_sync_state(&self) -> Result<(), String> {
        let snapshot = self.local_rooms_snapshot()?;
        emit_sync_state_changed(&self.app, &snapshot.sync_state)
    }

    pub(super) fn emit_sync_state_best_effort(&self, reason: &str) {
        if let Err(error) = self.emit_sync_state() {
            log::warn!(
                "chat runtime: failed to emit sync state reason={} error={}",
                reason,
                error
            );
        }
    }

    pub(super) fn emit_sync_state_payload_best_effort(
        &self,
        snapshot: &ChatSyncState,
        reason: &str,
    ) {
        if let Err(error) = emit_sync_state_changed(&self.app, snapshot) {
            log::warn!(
                "chat runtime: failed to emit sync state payload reason={} error={}",
                reason,
                error
            );
        }
    }
}
