// kaobuddy service worker
// Strategy: network-first for everything, cache for offline fallback
// 1782450015034 is replaced by vite at build time so every deploy busts the cache (both comment and CACHE_VERSION).
const CACHE_VERSION = "kaobuddy-1782450015034";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon.svg"];

// Listen for skip-waiting message from the page
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Immediately take control — don't wait for existing tabs to close
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

// Wipe old caches, claim all clients so the new SW controls pages instantly
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Don't intercept non-GET or API requests
  if (request.method !== "GET") return;
  if (url.pathname.startsWith("/api")) return;

  // For navigation (page loads): network-first, offline fallback to "/"
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // For static assets (JS, CSS, images, fonts): network-first, cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache successful responses
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // For document-origin requests, fall back to / (SPA)
          if (request.mode === "navigate" || request.destination === "document") {
            return caches.match("/");
          }
          return new Response("Offline", { status: 503 });
        })
      )
  );
});
