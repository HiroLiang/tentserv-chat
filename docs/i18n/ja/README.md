# Tentserv Chat

<p align="center">
  <a href="../../../README.md">English</a> | <a href="../zh-TW/README.md">中文</a> | 日本語
</p>

エンドツーエンド暗号化と LLM 統合を備えた、クロスプラットフォーム デスクトップチャットアプリケーション。

## 技術スタック

- **React 19** + **TypeScript** · Vite · Tailwind CSS · shadcn/ui
- **Tauri 2**（Rust バックエンド）— デバイス管理、OS キーチェーン、Signal Protocol X3DH
- **pnpm 10**

## クイックスタート

```shell
pnpm install      # 依存関係をインストール
pnpm tauri dev    # 開発サーバーを起動（Vite :1420 + Tauri ウィンドウ）
```

`.env.local` をローカルバックエンドに向けて設定：

```dotenv
VITE_API_BASE_URL=http://localhost:8080
```

## コマンド

```shell
pnpm dev              # Vite フロントエンドのみ（Tauri ウィンドウなし）
pnpm build            # tsc + vite ビルド
pnpm tauri build      # 本番デスクトップビルド

# Rust レイヤー（完全な Tauri リビルドなしでの高速イテレーション）
cd src-tauri && cargo check   # 型チェック
cd src-tauri && cargo build   # フルコンパイル
```

アプリアイコンの更新（ソース画像は 1024x1024 が必要）：

```shell
pnpm tauri icon --path ./public/goat-chat.png
```

## 環境設定

| ファイル | 用途 |
|---------|------|
| `.env` | 本番 API（`https://api.hiroliang.com`） |
| `.env.local` | ローカル開発 API（`http://localhost:8080`） |

`src/config/env.ts` 経由でアクセス（`env.API_BASE_URL`、`env.IS_DEV`）。
