# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # Install dependencies
pnpm tauri dev        # Run full dev server (Vite frontend + Tauri/Rust backend)
pnpm dev              # Run Vite frontend only
pnpm build            # tsc + vite build
pnpm tauri build      # Production desktop build

# Rust only (faster iteration on backend changes)
cd src-tauri && cargo check   # type-check without full link
cd src-tauri && cargo build   # full Rust compile
pnpm tauri icon --path ./public/goat-chat.png  # Update app icon
```

No test framework is configured in this project.

## Architecture

**Tentserv Chat** is a cross-platform desktop chat app built with React 19 + Tauri (Rust backend). The frontend runs on
Vite at port 1420 during development.

### Startup Flow

`App.tsx` wraps everything in `AppInitializer`, which runs on mount:

1. `networkService.initialize()` — starts health polling and browser event listeners
2. `deviceService.initializeDevice()` — calls Tauri `get_or_create_device_info`, registers with backend, updates
   `deviceStore`; blocks app with error overlay + retry if registration fails
3. `userService.tryRestoreSession()` — restores token from OS keyring, calls `/api/user/me` to populate user state
4. Login/navigation: dev mode auto-logs in with a hardcoded test user; prod redirects unauthenticated users to `/`
5. `chatService.initialize()` — ensures participant record exists on backend
6. `wsService.connect()` — only if user is logged in AND network is healthy
7. `e2eeService.ensureInitialized(deviceId)` — generates identity keys if absent, uploads public keys, replenishes
   OTP pre-keys to a threshold of 20

### State Management

Five Zustand stores in `src/stores/`:

- `userStore` — current user session (token, login state) and cached users
- `deviceStore` — device ID and registration state
- `networkStore` — network health status (`'offline' | 'connecting' | 'healthy' | 'unhealthy' | 'unreachable'`)
- `chatStore` — chat rooms and messages
- `e2eeStore` — E2EE key status (uploaded, OTP pre-key count)

### Service Layer (`src/services/`)

Singletons called during startup or on demand:

- `deviceService` — registers device via Tauri command or falls back to browser UUID; syncs with backend
- `networkService` — polls `/health` every 30s and listens to browser online/offline events
- `userService` — login, logout, register, fetchCurrentUser, uploadAvatar
- `wsService` — WebSocket singleton with exponential backoff reconnect (3s→30s), heartbeat ping every 20s, message queue
  for offline sends; requires user logged in + network healthy before connecting
- `chatService` — thin wrapper over `wsService` for `chat_message` and `typing` events; also ensures participant record exists
- `e2eeService` — key generation via Tauri, public key upload, X3DH send/receive, OTP key replenishment
- `chatRoomService` — chat room CRUD via REST API
- `chatParticipantService` — participant lifecycle via REST API
- `src/services/llm/` — LLM integration: `factory.ts` creates adapters, `adapter.ts` implements `ClaudeAdapter` (
  Anthropic SDK) and `OpenAIAdapter`; message format normalized via `LLMAdapter` interface

**Service Layer Rule:** Pages and components must not import from `src/api/` directly when a
service in `src/services/` already covers that API domain. Always call the service. Direct
`src/api/` imports are only acceptable when no service wrapper exists yet for that domain
(e.g., `friendApi` — no `friendService` exists).

### HTTP Client (`src/api/`)

- `src/api/http.ts` — Axios instance; request interceptor attaches Bearer token from `userStore`; response interceptor
  refreshes token on new token in response headers
- `src/api/index.ts` — barrel re-export of `authApi`, `deviceApi`, `healthApi`, `participantApi`, `userApi`
- `src/api/types.ts` — all request/response DTOs for the HTTP layer

### Routing (`src/routes/`)

- `/` → `HomePage`
- `/login`, `/register` — public
- `/chat`, `/profile`, `/settings`, `/friends` — behind `ProtectedRoute` (redirects to `/login` if unauthenticated)
- `/console` — behind `AdminRoute` (calls `/api/user/me` fresh to verify role server-side; denies → `/`, not `/login`);
  `AdminPage` is `React.lazy` so its bundle chunk is never fetched for unauthorized users

### Tauri Backend (`src-tauri/`)

Module structure: `lib.rs` owns `mod commands` and `mod crypto`; `main.rs` only calls `goat_chat_lib::run()`.

**`src-tauri/src/commands/device.rs`** — device lifecycle:

- `get_or_create_device_info` — reads or generates UUID via `tauri-plugin-store` (`store.json`)
- `update_device_registration`, `clear_device_id`

**`src-tauri/src/commands/e2ee.rs`** — E2EE key management (all secrets stored in OS keyring under service name
`"goat-chat"`):

- `generate_identity_keys` → X25519 (`ik_dh`) + Ed25519 (`ik_sign`) keypair
- `generate_signed_pre_key(key_id)` → X25519 SPK signed by `ik_sign`, stored as `spk_{key_id}`
- `generate_one_time_pre_keys(key_ids)` → batch X25519 OPKs stored as `opk_{key_id}`
- `perform_x3dh_send` / `perform_x3dh_receive` — load keys from keyring, run X3DH protocol

**`src-tauri/src/crypto/x3dh.rs`** — Signal X3DH implementation:

- `PublicKeyBundle` has two separate identity key fields: `identity_key_dh` (X25519) and `identity_key_sign` (Ed25519) —
  they are incompatible curve representations and must not be conflated
- Ephemeral key uses `StaticSecret` (not `EphemeralSecret`) to allow multiple DH calls in a single session
- HKDF uses 32-byte zero salt and 0xFF-prefixed IKM per Signal spec; info string is `b"X3DH"`
- Sender computes DH1–DH4 (`IK_A×SPK_B`, `EK_A×IK_B`, `EK_A×SPK_B`, optionally `EK_A×OPK_B`); receiver mirrors with
  swapped roles

### Settings Architecture

`SettingsPage` uses a data-driven sidebar pattern: add an entry to `SETTINGS_GROUPS` in `SettingsPage.tsx` with an
optional `condition` function to control visibility. Each section is a separate component under
`src/components/settings/sections/`.

### UI

shadcn/ui (new-york style, zinc base) with Radix UI + Tailwind CSS. Components in `src/components/ui/`. Import alias
`@/` → `src/`.

### Environment

| File         | Purpose                                      |
|--------------|----------------------------------------------|
| `.env`       | Production API (`https://api.hiroliang.com`) |
| `.env.local` | Local dev API (`http://localhost:8080`)      |

Typed access via `src/config/env.ts` using `env.API_BASE_URL` and `env.IS_DEV`.

### Logger (`src/utils/logger.ts`)

Dual-mode: uses `tauri-plugin-log` in Tauri, falls back to console in browser. `trace`/`debug` levels are dev-only.
