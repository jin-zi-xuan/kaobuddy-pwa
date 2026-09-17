// 构建时写入版本和完整静态资源列表；开发模式不注册此模板。
const CACHE_VERSION = "kaobuddy-5590aeb993729614";
const SHELL = ["/","/manifest.webmanifest","/icons/icon.svg","/assets/_commonjsHelpers-_d1bhYXs.js","/assets/index-ChmmZPVL.css","/assets/index-DLHh6Qqb.js","/assets/index-DVirBW6R.js","/assets/index.es-Bs-_RSrS.js","/assets/jszip.min-BSSsfq2I.js","/assets/jszip.min-Dwe8nWl1.js","/assets/pdf-CcZYcL52.js","/assets/pdf.worker-BgryrOlp.mjs","/assets/pdf.worker-rRTVGHQx.js","/assets/pdfExport-CXIZqEuT.js","/assets/purify.es-DedTAGkB.js","/index.html"];
const SHELL_URLS = new Set(SHELL);

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", (event) => {
  // 全部成功才完成安装，更新失败时仍由旧版本提供离线页面。
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // 用户可能在旧标签页继续编辑，之后还会请求旧版本的懒加载分包。
    // 有任何窗口时保守保留全部旧版本；无窗口的正常激活才回收旧缓存。
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.length === 0) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("kaobuddy-") && key !== CACHE_VERSION).map((key) => caches.delete(key)));
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api") || url.pathname === "/health") return;
  const isBuildAsset = url.pathname.startsWith("/assets/");
  if (request.mode !== "navigate" && !SHELL_URLS.has(url.pathname) && !isBuildAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // HTML 与哈希资源必须来自同一次构建，避免部署中途污染已安装的离线版本。
    const cached = await cache.match(request.mode === "navigate" ? "/" : url.pathname);
    if (cached) return cached;
    if (isBuildAsset && request.mode !== "navigate") {
      // 只允许回退到本应用的旧分包，不从其他应用缓存取响应。
      const oldKeys = (await caches.keys()).filter((key) => key.startsWith("kaobuddy-") && key !== CACHE_VERSION);
      for (const key of oldKeys) {
        const oldCache = await caches.open(key);
        const oldAsset = await oldCache.match(url.pathname);
        if (oldAsset) return oldAsset;
      }
    }
    try {
      return await fetch(request);
    } catch {
      return new Response("离线资源暂不可用，请联网后重试。", { status: 503 });
    }
  })());
});
