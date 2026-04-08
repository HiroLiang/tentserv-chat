// [EN] Application entry point: mounts the React root inside BrowserRouter for client-side routing.
// [中] 應用程式入口：將 React 根節點掛載於 BrowserRouter 中，啟用客戶端路由。
// [日] アプリエントリ：React ルートを BrowserRouter 内にマウントし、クライアントサイドルーティングを有効化する。
import App from "./App";
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { BrowserRouter } from 'react-router-dom'
import './index.css'

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <BrowserRouter>
            <App/>
        </BrowserRouter>
    </StrictMode>
);
