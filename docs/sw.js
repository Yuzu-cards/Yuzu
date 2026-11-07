// Yuzu service worker. VERSION and PRECACHE are filled in at build time.
// App shell is precached and served cache-first so Yuzu opens offline. Updates wait until the
// user taps "Update" so a session is never interrupted. Third-party modules fetched at runtime
// (the zstd decoder) are cached on first use.
const VERSION = "1.3.0-656c8d6e9d";
const CACHE = `yuzu-${VERSION}`;
const RUNTIME = "yuzu-runtime";
const PRECACHE = ["./","./index.html","./manifest.webmanifest","./assets/app-03766e0ee1.js","./assets/app-bc093b19c1.css","./icons/apple-touch-icon.png","./icons/favicon-32.png","./icons/icon-192.png","./icons/icon-512.png","./icons/maskable-512.png","./fonts/yuzu-pixel.woff"];

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

// ---- Reminders. The app leaves { on, at, due, goalMet, light, notifiedOn … } in IndexedDB (meta "nudge"); periodic background sync
// (installed Android Chrome) wakes this worker now and then, and it shows one notification a day when it's time and cards are due.
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function shouldNudge(n, now) {
  if (!n || !n.on || !(n.due > 0)) return false;
  const today = ymd(now); if (n.notifiedOn === today) return false;
  const [h, m] = String(n.at || "19:00").split(":").map(Number); if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return false;
  if (n.date === today && n.goalMet) return false; // already did today's goal
  if (n.skipLight && n.light && n.light[today]) return false; // a night shift or the day after: Yuzu stays quiet
  return true;
}
const metaDb = () => new Promise((res, rej) => { const r = indexedDB.open("yuzu"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function metaGet(key) { const db = await metaDb(); return new Promise((res) => { const q = db.transaction("meta").objectStore("meta").get(key); q.onsuccess = () => res(q.result ? q.result.value : undefined); q.onerror = () => res(undefined); }); }
async function metaPut(key, value) { const db = await metaDb(); return new Promise((res) => { const tx = db.transaction("meta", "readwrite"); tx.objectStore("meta").put({ key, value }); tx.oncomplete = () => res(); tx.onerror = () => res(); }); }
async function nudge() {
  const n = await metaGet("nudge"); const now = new Date(); if (!shouldNudge(n, now)) return;
  await self.registration.showNotification("Yuzu", { body: `${n.due.toLocaleString()} cards due${n.minutes ? ` (about ${n.minutes} min)` : ""}.`, tag: "yuzu-nudge", icon: "icons/icon-192.png", badge: "icons/favicon-32.png" });
  await metaPut("nudge", { ...n, notifiedOn: ymd(now) });
}
self.addEventListener("periodicsync", (event) => { if (event.tag === "yuzu-nudge") event.waitUntil(nudge()); });
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => { const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true }); if (all[0]) return all[0].focus(); return self.clients.openWindow("./"); })());
});
