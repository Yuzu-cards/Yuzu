// Yuzu service worker. VERSION and PRECACHE are filled in at build time.
// App shell is precached and served cache-first so Yuzu opens offline. Updates wait until the
// user taps "Update" so a session is never interrupted. Third-party modules fetched at runtime
// (the zstd decoder) are cached on first use.
const VERSION = "1.2.0-e137bbc330";
const CACHE = `yuzu-${VERSION}`;
const RUNTIME = "yuzu-runtime";
const PRECACHE = ["./","./index.html","./manifest.webmanifest","./assets/app-4b7d198a86.js","./assets/app-bc093b19c1.css","./icons/apple-touch-icon.png","./icons/favicon-32.png","./icons/icon-192.png","./icons/icon-512.png","./icons/maskable-512.png","./fonts/yuzu-pixel.woff"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((p) => new Request(p, { cache: "reload" })))));
});
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("yuzu-") && k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        return res;
      } catch {
        if (req.mode === "navigate") return (await cache.match("./index.html")) || Response.error();
        return Response.error();
      }
    })());
  } else if (/cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.host)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
  }
});
