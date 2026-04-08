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

## Boundaries

- Do not edit `../tentserv-chat-server/` unless the selected business guide or API contract requires backend changes.
- Do not read unrelated business guides unless a real dependency is discovered.
- Follow `../docs/README.md` for UI/UX operation log routing when user-facing UI/UX behavior changes.
- Follow `../AGENTS.md` for guide update checks; keep full business-guide policy there, not in this file.
- Keep page/component API access behind the owning service in `src/services/` when one exists.
