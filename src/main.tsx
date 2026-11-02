import { setHiddenFields } from "./lib/render";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { store } from "./lib/store";
import * as db from "./lib/db";

import { applyTheme } from "./ui/sfx";
store.load().then(() => { applyTheme(store.settings.theme); setHiddenFields(store.settings.hiddenFields ?? []); }).catch(() => { /* shown by the recovery screen */ });
try { document.documentElement.dataset.effects = localStorage.getItem("yuzu-effects") === "off" ? "off" : "on"; } catch { /* fine */ }
store.subscribe(() => { if (store.loaded) setHiddenFields(store.settings.hiddenFields ?? []); if (store.loaded && document.documentElement.dataset.theme !== store.settings.theme) applyTheme(store.settings.theme); });
createRoot(document.getElementById("root")!).render(<App />);
(window as any).yuzu = store; (store as any)._db = db; // for debugging from the console and the tests

// Last-resort reporting: anything uncaught is remembered for Settings → Diagnostics.
const remember = (where: string, e: unknown) => {
  const message = (e as any)?.message ?? String(e);
  import("./lib/db").then((db) => db.setMeta("lastError", { at: Date.now(), where, message }).catch(() => {})).catch(() => {});
};
window.addEventListener("error", (e) => remember("error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => remember("promise", e.reason));

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      const notify = () => {
        const w = reg.waiting;
        if (!w) return;
        window.dispatchEvent(new CustomEvent("yuzu:update", { detail: () => { w.postMessage({ type: "SKIP_WAITING" }); } }));
      };
      if (reg.waiting) notify();
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw?.addEventListener("statechange", () => { if (nw.state === "installed" && navigator.serviceWorker.controller) notify(); });
      });
      // Reload only when an *update* takes over, never on the very first install (that would reload the page
      // under the user while they are importing, and lose the import).
      const hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
    } catch (e) { console.warn("sw", e); }
  });
}

// App-icon badge (Badging API, where the system supports it): how many cards are due right now.
function updateBadge() {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (!store.loaded || !nav.setAppBadge) return;
  const now = Date.now(); let n = 0; for (const c of store.cards.values()) if (!c.suspended && c.state !== "new" && c.due <= now) n++;
  (n ? nav.setAppBadge(n) : nav.clearAppBadge?.())?.catch(() => {});
}
setInterval(updateBadge, 5 * 60000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") updateBadge(); });
