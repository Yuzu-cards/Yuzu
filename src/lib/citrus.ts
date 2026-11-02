// Citrus Maxima bridge: publish a small status snapshot so the hub app can show it and plan around it.
// Transport is localStorage on the shared amaerys.github.io origin (key `citrus.status.yuzu`);
// Citrus mirrors it to Google Drive for other devices. Nothing here needs network or sign-in.
import { store } from "./store";
import { DAY } from "../scheduler/fsrs";

const KEY = "citrus.status.yuzu";
const MIN_PER_CARD = 0.2; // ~12 s per review; Citrus uses estimatedMinutes to size the study block

export interface CitrusStatus {
  app: string; title: string; icon: string; color: string; url: string;
  summary: string; due: number; estimatedMinutes: number; streak: number; nextDue: string;
  updatedAt: string;
  details: Record<string, unknown>;
}

export function snapshot(now = Date.now()): CitrusStatus {
  const stats = store.stats();
  const queue = store.queue("", now);
  const due = queue.filter((c) => c.state !== "new").length;
  const fresh = queue.length - due;
  const day0 = store.dayStart(now);
  let overdue = 0, tomorrow = 0;
  for (const c of store.cards.values()) {
    if (c.suspended || c.state !== "review") continue;
    if (c.due < day0) overdue++;
    else if (c.due >= day0 + DAY && c.due < day0 + 2 * DAY) tomorrow++;
  }
  const left = Math.max(0, stats.goal - stats.today);
  const parts = [due ? `${due} due` : "all caught up", fresh ? `${fresh} new` : "", stats.streak ? `${stats.streak}-day streak` : ""].filter(Boolean);
  return {
    app: "yuzu", title: "Yuzu", icon: "🍋", color: "#f2d34b", url: "https://amaerys.github.io/Yuzu/",
    summary: parts.join(" · "),
    due,
    estimatedMinutes: Math.min(90, Math.max(due ? 10 : 0, Math.round((due + fresh * 1.5) * MIN_PER_CARD))),
    streak: stats.streak,
    nextDue: due ? "now" : tomorrow ? `${tomorrow} tomorrow` : "",
    updatedAt: new Date(now).toISOString(),
    details: { reviewedToday: stats.today, goal: stats.goal, goalLeft: left, newAvailable: fresh, overdue, tomorrow, totalCards: store.cards.size },
  };
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function publish() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (!store.loaded) return;
    try { localStorage.setItem(KEY, JSON.stringify(snapshot())); } catch { /* storage full or blocked: Citrus just shows the last snapshot */ }
  }, 1500);
}

/** Call once at start-up: publishes on every data change, and on each return to the app. */
export function startCitrusBridge() {
  store.subscribe(publish);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") publish(); });
  publish();
}
