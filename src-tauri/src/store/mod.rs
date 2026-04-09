//! # Store
//!
//! Persistence layer for Tentserv Chat.  All state that outlives a single
//! application session lives here, organised into domain modules:
//!
//! | Module             | Tables                                              |
//! |--------------------|-----------------------------------------------------|
//! | `db`               | Schema bootstrap, connection management, AES helpers|
//! | `device_store`     | `device_info` — single-row device UUID/platform     |
//! | `token_store`      | `user_tokens` — one encrypted token per user        |
//! | `key_store`        | Identity, SPK, OTP keys, OPK counter                |
//! | `sender_key_store` | `sender_keys` keyed by `(user_id, room_id, member_id)` |
//! | `message_store`    | `encrypted_messages`, `decrypted_messages`          |
//!
//! Each module exposes `pub(crate)` **inner functions** that accept a raw
//! `Connection` + AES key, used by the command core layer and unit tests.

pub mod db;
pub mod device_store;
pub mod key_provider;
pub mod key_store;
pub mod message_store;
pub mod sender_key_store;
pub mod token_store;

// ── Integration tests ────────────────────────────────────────────
//
// Loaded from a separate file so `pub(crate)` inner functions from all
// sub-modules are accessible via their module paths (e.g. `super::token_store::store_token_inner`).

#[cfg(test)]
#[path = "tests/integration.rs"]
mod integration_tests;
