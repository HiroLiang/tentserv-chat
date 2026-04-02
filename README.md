# Tentserv Chat

<p align="center">
  English | <a href="docs/i18n/zh-TW/README.md">中文</a> | <a href="docs/i18n/ja/README.md">日本語</a>
</p>

A cross-platform desktop chat application with end-to-end encryption and LLM integration.

## Stack

- **React 19** + **TypeScript** · Vite · Tailwind CSS · shadcn/ui
- **Tauri 2** (Rust backend) — device management, OS keyring, Signal Protocol X3DH
- **pnpm 10**

## Quick Start

```shell
pnpm install      # Install dependencies
pnpm tauri dev    # Start dev server (Vite on :1420 + Tauri window)
```

Copy `.env.local` to point at your local backend:

```dotenv
VITE_API_BASE_URL=http://localhost:8080
```

## Commands

```shell
pnpm dev              # Vite frontend only (no Tauri window)
pnpm build            # tsc + vite build
pnpm tauri build      # Production desktop build

# Rust layer (faster iteration without full Tauri rebuild)
cd src-tauri && cargo check   # Type-check
cd src-tauri && cargo build   # Full compile
```

Update the app icon (source image must be 1024×1024):

```shell
pnpm tauri icon --path ./public/goat-chat.png
```

## Environment

| File | Purpose |
|------|---------|
| `.env` | Production API (`https://api.hiroliang.com`) |
| `.env.local` | Local dev API (`http://localhost:8080`) |

Values are accessed via `src/config/env.ts` (`env.API_BASE_URL`, `env.IS_DEV`).
