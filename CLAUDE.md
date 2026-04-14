# CLAUDE.md

Frontend/Tauri execution and style guide for `tentserv-chat/`. Business scope comes from the outer `../AGENTS.md`, the matching `../docs/agent-guides/*/SKILL.md`, and this repo's `AGENTS.md`.

## Commands

Run from `tentserv-chat/`:

```bash
pnpm install
pnpm dev
pnpm build
pnpm tauri dev
pnpm tauri build
```

Rust-only checks:

```bash
cd src-tauri && cargo check
cd src-tauri && cargo build
```

No JavaScript test framework is currently configured. Use `pnpm build` for frontend TypeScript/Vite verification unless a task explicitly adds a test stack.

## Log-First Debugging

- `webview` auth/session logs map to `../docs/agent-guides/login-session/SKILL.md`.
- `webview` bootstrap logs around `/api/e2ee/key-policy`, `/api/e2ee/key-status/*`, or `/api/e2ee/otp-prekeys` map to `../docs/agent-guides/e2ee-key-bootstrap/SKILL.md`.
- `webview` self-sync or sender-key distribution logs map to `../docs/agent-guides/e2ee-sender-key/SKILL.md`.
- `goat_chat_lib::chat::runtime::*` and chat WS logs map to `../docs/agent-guides/chat-runtime-sync/SKILL.md`.
- Prefer the smallest matching guide set. A normal startup trace usually hands off in this order: login/session -> key bootstrap -> self-sync/sender-key -> runtime sync.

## Service Layer Rules

- Pages and components must call `src/services/*` when a service already owns an API domain.
- Do not import `src/api/*` directly from pages/components when a service wrapper exists.
- `userService` owns auth/register/session calls; `deviceService` owns device lifecycle calls; `e2eeService` owns key generation/upload and X3DH flows.
- Keep DTO shape changes synchronized with `src/api/types.ts`, the owning service, and backend API changes.
- Do not log raw `key-status` public key fields from frontend/webview HTTP responses. Keep E2EE bootstrap logs redaction-safe by emitting booleans, fingerprints, key ids, and counts only.

## Tauri/Rust Rules

- `src-tauri/src/lib.rs` owns module wiring; `main.rs` should stay minimal.
- Device commands live in `src-tauri/src/commands/device.rs`; E2EE commands live in `src-tauri/src/commands/e2ee.rs`.
- Secret key material belongs in OS keyring-backed code paths, not frontend stores or logs.
- Prefer `cargo check` for Rust-only iteration; run `pnpm build` when TypeScript or frontend service contracts changed.
- If the suspicious lines are in Rust runtime or `goat_chat_lib` logs, favor `cd src-tauri && cargo test chat -- --nocapture --test-threads=1`; use `cargo test e2ee -- --nocapture --test-threads=1` when the logs center on key bootstrap or sender-key helpers.

## UI And Runtime Style

- Use the existing React 19, Zustand, Axios, shadcn/ui, Radix, and Tailwind patterns.
- Import through the `@/` alias for `src/` code where the project already does so.
- Keep user-facing copy product-oriented; avoid self-referential UI descriptions.
- Update the matching agent guide when frontend behavior changes a documented business flow.
