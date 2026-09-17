import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";
import { registerServiceWorker } from "./serviceWorker";

// Polyfill crypto.randomUUID() for older WebViews (e.g. WeChat < 8.0 on old Android).
if (!globalThis.crypto?.randomUUID) {
  const getRandomHex = (len: number) =>
    Array.from(
      (globalThis.crypto?.getRandomValues?.(new Uint8Array(len)) ?? new Uint8Array(len).map(() => Math.random() * 256)),
      (b) => (b % 16).toString(16),
    ).join("");
  (globalThis.crypto as unknown as Record<string, unknown>).randomUUID = () =>
    `${getRandomHex(4)}${getRandomHex(2)}-4${getRandomHex(3)}-${(8 + Math.random() * 4) | 0}${getRandomHex(3)}-${getRandomHex(6)}${getRandomHex(6)}`;
}

// 开发服务器不安装生产缓存；构建页面正常注册，不清空历史离线数据。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { void registerServiceWorker(); });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

