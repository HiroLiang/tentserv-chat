# AGENTS.md

Frontend/Tauri repo scope handoff for `tentserv-chat/`.

## Scope

This repo owns the React 19 desktop frontend, TypeScript services/stores/pages, Tauri bridge code, and Rust `src-tauri` commands, crypto, local device store, and keyring integrations.

## Read Order

1. Read `../AGENTS.md` for workspace-wide business routing.
2. Read `../docs/README.md` only when routing docs work or UI/UX operation records.
3. Read only the relevant `../docs/agent-guides/*/SKILL.md` for the business flow.
4. Read this file to confirm the work belongs in the frontend/Tauri repo.
5. Read `CLAUDE.md` for frontend, Tauri, Rust, and UI execution rules.

## Log Routing

- `webview` + `/api/device/register` or `deviceService` logs: `../docs/agent-guides/device-lifecycle/SKILL.md`
- `webview` + `/api/auth/login`, `/api/auth/profile`, `Token refreshed`, or verification dialog logs: `../docs/agent-guides/login-session/SKILL.md`
- `webview` + `/api/e2ee/key-policy`, `/api/e2ee/key-status/*`, `/api/e2ee/otp-prekeys`, or `E2EE local bootstrap complete`: `../docs/agent-guides/e2ee-key-bootstrap/SKILL.md`
- `webview` + `/api/e2ee/self-sender-key-sync*`, `/api/e2ee/sender-key-distributions*`, or sync dialog logs: `../docs/agent-guides/e2ee-sender-key/SKILL.md`
- `goat_chat_lib::chat::runtime::*`, `chat runtime ws`, `sync room`, `sync rooms`, `fetch room summaries`, or `set active room`: `../docs/agent-guides/chat-runtime-sync/SKILL.md`
- For mixed startup logs, read only until ownership hands off instead of loading every guide. Typical order is `login-session -> e2ee-key-bootstrap -> e2ee-sender-key -> chat-runtime-sync`.

## Boundaries

- Do not edit `../tentserv-chat-server/` unless the selected business guide or API contract requires backend changes.
- Do not read unrelated business guides unless a real dependency is discovered.
- Follow `../docs/README.md` for UI/UX operation log routing when user-facing UI/UX behavior changes.
- Follow `../AGENTS.md` for guide update checks; keep full business-guide policy there, not in this file.
- Keep page/component API access behind the owning service in `src/services/` when one exists.
