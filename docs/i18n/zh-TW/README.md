# Tentserv Chat

<p align="center">
  <a href="../../../README.md">English</a> | 中文 | <a href="../ja/README.md">日本語</a>
</p>

跨平台桌面聊天應用程式，支援端對端加密與 LLM 整合。

## 技術堆疊

- **React 19** + **TypeScript** · Vite · Tailwind CSS · shadcn/ui
- **Tauri 2**（Rust 後端）— 裝置管理、OS 金鑰鏈、Signal Protocol X3DH
- **pnpm 10**

## 快速開始

```shell
pnpm install      # 安裝依賴
pnpm tauri dev    # 啟動開發伺服器（Vite :1420 + Tauri 視窗）
```

將 `.env.local` 設定指向本地後端：

```dotenv
VITE_API_BASE_URL=http://localhost:8080
```

## 指令

```shell
pnpm dev              # 僅啟動 Vite 前端（無 Tauri 視窗）
pnpm build            # tsc + vite 建置
pnpm tauri build      # 正式版桌面建置

# Rust 層（不需完整 Tauri 重建的快速迭代）
cd src-tauri && cargo check   # 類型檢查
cd src-tauri && cargo build   # 完整編譯
```

更新應用程式圖示（來源圖片須為 1024x1024）：

```shell
pnpm tauri icon --path ./public/goat-chat.png
```

## 環境設定

| 檔案 | 用途 |
|------|------|
| `.env` | 正式環境 API（`https://api.hiroliang.com`） |
| `.env.local` | 本地開發 API（`http://localhost:8080`） |

透過 `src/config/env.ts` 存取（`env.API_BASE_URL`、`env.IS_DEV`）。
