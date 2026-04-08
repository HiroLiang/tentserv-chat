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

## Service Layer Rules

- Pages and components must call `src/services/*` when a service already owns an API domain.
- Do not import `src/api/*` directly from pages/components when a service wrapper exists.
- `userService` owns auth/register/session calls; `deviceService` owns device lifecycle calls; `e2eeService` owns key generation/upload and X3DH flows.
- Keep DTO shape changes synchronized with `src/api/types.ts`, the owning service, and backend API changes.

## Tauri/Rust Rules

- `src-tauri/src/lib.rs` owns module wiring; `main.rs` should stay minimal.
- Device commands live in `src-tauri/src/commands/device.rs`; E2EE commands live in `src-tauri/src/commands/e2ee.rs`.
- Secret key material belongs in OS keyring-backed code paths, not frontend stores or logs.
- Prefer `cargo check` for Rust-only iteration; run `pnpm build` when TypeScript or frontend service contracts changed.

## UI And Runtime Style

- Use the existing React 19, Zustand, Axios, shadcn/ui, Radix, and Tailwind patterns.
- Import through the `@/` alias for `src/` code where the project already does so.
- Keep user-facing copy product-oriented; avoid self-referential UI descriptions.
- Update the matching agent guide when frontend behavior changes a documented business flow.
