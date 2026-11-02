// Citrus Maxima hub bridge for Yuzu.
// 1. Publishes a status snapshot (hub contract shared by Orange, Mephisto, Sinus, Citrus) to
//    Google Drive › My Apps › hub › yuzu › status.json, and to localStorage for same-origin readers.
// 2. Reads Citrus's plan (My Apps › hub › citrus › plan.json) so Today can show when reviews are planned.
// Sign-in is Google Identity Services with the shared client ID (one Cloud project for all the apps);
// only an access token is kept, in localStorage, on this device.
import { store } from "./store";
import { DAY } from "../scheduler/fsrs";

declare global { interface Window { google?: any } }

export const HUB = {
  app: "yuzu", root: "My Apps", url: "https://yuzu-cards.github.io/Yuzu/",
  scopes: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
  drive: "https://www.googleapis.com/drive/v3", upload: "https://www.googleapis.com/upload/drive/v3",
  folder: "application/vnd.google-apps.folder",
  defaultClientId: "753489712404-ra7ahu34gjl305b4ss1765idmqg7am5s.apps.googleusercontent.com", // shared Cloud project for all the apps; Settings can override
};
const LS = "yuzu_hub";
const STATUS_KEY = "citrus.status.yuzu";
const MIN_PER_CARD = 0.2;

interface HubConf { clientId?: string; email?: string; token?: string; exp?: number; ids?: Record<string, string>; fileIds?: Record<string, string>; statusAt?: number; statusFp?: string; stateAt?: number; last?: string; err?: string; plan?: PlanBlock[]; planAt?: string; backup?: boolean }
export interface PlanBlock { date: string; start: string; end?: string; minutes: number; title: string; status?: string }

function conf(): HubConf { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch { return {}; } }
function save(p: Partial<HubConf>) { const c = { ...conf(), ...p }; try { localStorage.setItem(LS, JSON.stringify(c)); } catch { /* fine */ } emit(); return c; }
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }
export function onHubChange(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function hubState() { const c = conf(); return { clientId: c.clientId || HUB.defaultClientId, email: c.email || "", signedIn: !!(c.token && (c.exp || 0) > Date.now()), connected: !!c.email, last: c.last || "", err: c.err || "", plan: c.plan || [], planAt: c.planAt || "", backup: c.backup !== false, statusAt: c.statusAt || 0 }; }

// ---- Google sign-in ----
function gis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = () => res(); s.onerror = () => rej(new Error("Google script did not load (offline?)")); document.head.append(s); });
}
export async function connect(opts: { silent?: boolean; clientId?: string } = {}): Promise<void> {
  const c = conf();
  const clientId = (opts.clientId || c.clientId || HUB.defaultClientId || "").trim();
  if (!clientId) throw new Error("Client ID missing");
  if (opts.clientId) save({ clientId });
  await gis();
  await new Promise<void>((res, rej) => {
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: HUB.scopes, hint: c.email || undefined,
      callback: (r: any) => { if (r.error) return rej(new Error(r.error_description || r.error)); save({ token: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000, err: "" }); res(); },
      error_callback: (e: any) => rej(new Error(e?.type === "popup_closed" ? "Sign-in cancelled" : e?.type || "Sign-in failed")),
    });
    tc.requestAccessToken({ prompt: opts.silent ? "" : "consent" });
  });
  if (!conf().email) { try { const u = await gjson("https://www.googleapis.com/oauth2/v3/userinfo"); save({ email: u.email || "" }); } catch { /* fine */ } }
}
export function disconnect() { const c = conf(); if (c.token && window.google?.accounts?.oauth2) try { window.google.accounts.oauth2.revoke(c.token, () => {}); } catch { /* fine */ } save({ token: undefined, exp: 0, email: "", ids: {}, fileIds: {}, last: "" }); }
async function token(): Promise<string> {
  const c = conf();
  if (c.token && (c.exp || 0) > Date.now()) return c.token;
  if (!c.email) throw new Error("signed_out");
  await connect({ silent: true });
  return conf().token!;
}
async function gfetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const t = await token();
  const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` } });
  if (r.status === 401 && retry) { save({ token: undefined, exp: 0 }); return gfetch(url, init, false); }
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r;
}
async function gjson(url: string, init?: RequestInit) { const r = await gfetch(url, init); return r.status === 204 ? null : r.json(); }

// ---- Drive helpers (ids cached; a 404 clears the cache and retries once) ----
const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
async function list(parent: string, name?: string, folders?: boolean) {
  const parts = ["trashed = false", `'${q(parent)}' in parents`]; if (name) parts.push(`name = '${q(name)}'`); if (folders) parts.push(`mimeType = '${HUB.folder}'`);
  const j = await gjson(`${HUB.drive}/files?q=${encodeURIComponent(parts.join(" and "))}&fields=files(id,name,modifiedTime)&pageSize=50`);
  return (j?.files || []) as { id: string; name: string; modifiedTime: string }[];
}
async function folderFor(path: string[], create = true): Promise<string | null> {
  const run = async (): Promise<string | null> => {
    const ids = { ...(conf().ids || {}) }; let parent = "root", key = "";
    for (const name of path) {
      key = key ? `${key}/${name}` : name;
      let id = ids[key];
      if (!id) {
        const f = (await list(parent, name, true))[0];
        if (f) id = f.id; else if (create) id = (await gjson(`${HUB.drive}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: HUB.folder, parents: [parent] }) })).id; else return null;
        ids[key] = id; save({ ids });
      }
      parent = id;
    }
    return parent;
  };
  try { return await run(); } catch (e: any) { if (/http_404/.test(e.message)) { save({ ids: {}, fileIds: {} }); return run(); } throw e; }
}
async function readJson(path: string[], name: string): Promise<{ data: any; modifiedTime: string } | null> {
  const dir = await folderFor(path, false); if (!dir) return null;
  const f = (await list(dir, name))[0]; if (!f) return null;
  const r = await gfetch(`${HUB.drive}/files/${f.id}?alt=media`);
  return { data: await r.json(), modifiedTime: f.modifiedTime };
}
async function writeJson(path: string[], name: string, obj: unknown) {
  const dir = await folderFor(path)!; const key = `${path.join("/")}/${name}`;
  const fileIds = { ...(conf().fileIds || {}) };
  let id = fileIds[key] || (await list(dir!, name))[0]?.id || null;
  const b = "yuzu" + Date.now().toString(36);
  const meta = id ? { name } : { name, parents: [dir] };
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${b}--`;
  try {
    const j = await gjson(`${HUB.upload}/files${id ? "/" + id : ""}?uploadType=multipart&fields=id`, { method: id ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body });
    fileIds[key] = j.id; save({ fileIds });
  } catch (e: any) { if (id && /http_404/.test(e.message)) { delete fileIds[key]; save({ fileIds }); return writeJson(path, name, obj); } throw e; }
}

// ---- status.json (hub contract) ----
export function snapshot(now = Date.now()) {
  const stats = store.stats();
  const queue = store.queue("", now);
  const due = queue.filter((c) => c.state !== "new").length, fresh = queue.length - due;
  const day0 = store.dayStart(now); const today = new Date(now); const dkey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  let overdue = 0, tomorrow = 0;
  for (const c of store.cards.values()) { if (c.suspended || c.state !== "review") continue; if (c.due < day0) overdue++; else if (c.due >= day0 + DAY && c.due < day0 + 2 * DAY) tomorrow++; }
  const minutes = Math.min(90, Math.max(due ? 10 : 0, Math.round((due + fresh * 1.5) * MIN_PER_CARD)));
  const done = stats.today >= stats.goal && due === 0;
  const summary = [due ? `${due} cards due` : "all caught up", fresh ? `${fresh} new` : "", `${stats.today}/${stats.goal} reviewed today`, stats.streak ? `${stats.streak}-day streak` : ""].filter(Boolean).join(" · ");
  const asks = minutes ? [{ date: dkey, title: due ? `Yuzu: ${due} reviews` : "Yuzu: new cards", minutes, slot: "free" }] : [];
  if (tomorrow) { const d = new Date(now + DAY); asks.push({ date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, title: `Yuzu: ~${tomorrow} reviews`, minutes: Math.min(90, Math.max(10, Math.round(tomorrow * MIN_PER_CARD))), slot: "free" }); }
  return {
    app: HUB.app, title: "Yuzu", icon: "🍋", color: "#f2d34b", url: HUB.url, updatedAt: new Date(now).toISOString(),
    summary, due, estimatedMinutes: minutes, streak: stats.streak, nextDue: due ? "now" : tomorrow ? `${tomorrow} tomorrow` : "",
    today: { date: dkey, done, items: stats.today ? [{ title: "Reviews", cards: stats.today }] : [] },
    next: { title: due ? `Review ${due} cards` : fresh ? `Learn ${fresh} new cards` : "Nothing due", minutes },
    asks, pending: [due ? `${due} cards due` : "", overdue ? `${overdue} overdue` : ""].filter(Boolean),
    extra: { reviewedToday: stats.today, goal: stats.goal, newAvailable: fresh, overdue, tomorrow, totalCards: store.cards.size, streak: stats.streak, url: HUB.url },
  };
}
const fp = (st: any) => JSON.stringify({ ...st, updatedAt: 0 });

async function pushStatus(force = false) {
  const c = conf(); if (!c.email) return;
  const st = snapshot(); const f = fp(st);
  if (!force && (f === c.statusFp || Date.now() - (c.statusAt || 0) < 5 * 60000)) return;
  await writeJson([HUB.root, "hub", HUB.app], "status.json", st);
  save({ statusFp: f, statusAt: Date.now(), last: new Date().toISOString(), err: "" });
}
async function pullPlan() {
  const r = await readJson([HUB.root, "hub", "citrus"], "plan.json");
  if (!r) { save({ plan: [], planAt: "" }); return; }
  const blocks: PlanBlock[] = ((r.data?.blocks || []) as any[]).filter((b) => String(b.app || "").toLowerCase() === "yuzu").map((b) => ({ date: b.date, start: b.start, end: b.end, minutes: +b.minutes || 0, title: b.title, status: b.status })).slice(0, 10);
  save({ plan: blocks, planAt: r.data?.updatedAt || r.modifiedTime });
}
// state.json: a full backup of the collection's scheduling (cards + reviews), at most once an hour
async function pushState(force = false) {
  const c = conf(); if (!c.email || c.backup === false) return;
  if (!force && Date.now() - (c.stateAt || 0) < 60 * 60000) return;
  const snap = { app: HUB.app, v: 1, savedAt: new Date().toISOString(), cards: [...store.cards.values()], settings: store.settings };
  await writeJson([HUB.root, "hub", HUB.app], "state.json", snap);
  save({ stateAt: Date.now() });
}

let busy = false;
export async function hubSync(force = false) {
  if (busy) return; const c = conf(); if (!c.email || navigator.onLine === false) return;
  busy = true;
  try { await pushStatus(force); await pullPlan(); await pushState(force); }
  catch (e: any) { save({ err: e.message === "signed_out" ? "Sign in again" : /http_403/.test(e.message) ? "No access — add this site to the client's JavaScript origins" : e.message }); }
  finally { busy = false; emit(); }
}

// ---- wiring ----
let timer: ReturnType<typeof setTimeout> | null = null;
function publishLocal() { try { localStorage.setItem(STATUS_KEY, JSON.stringify(snapshot())); } catch { /* fine */ } }
export function publish() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; if (!store.loaded) return; publishLocal(); hubSync(false); }, 2000);
}
export function startCitrusBridge() {
  store.subscribe(publish);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") publish(); });
  window.addEventListener("online", () => publish());
  publish();
}
