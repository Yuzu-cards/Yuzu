// Google for the Citrus apps: one Google Cloud project, the same sign-in as Citrus Maxima and Orange — the Google
// Identity Services "token client". A tap opens Google's window once; afterwards a renewal (`prompt: ""`) goes through
// without any screen while you're signed in to Google in this browser. Phones only let that window open from a tap,
// so renewals happen on taps (Sync now, pull to sync, Connect), never in the background. No backend, no secret, no
// redirect URIs: the client only needs this app's origin among its authorised JavaScript origins. The one-hour token
// lives in localStorage on this device only.
//
// Drive layout — Citrus's (claude/drive-layout.md): folders are found by their citrusApp tag first (ANCHORS below), these old paths are the fallback:
//   My Apps/Rotas/                    the department's schedule files (read; Citrus Maxima/Rotas too, where Orange looks)
//   My Apps/hub/yuzu/status.json      Yuzu's "where I am" for Citrus (written)
//   My Apps/hub/citrus/plan.json      Citrus's plan: blocks per app and the shift of each day (read)
//   My Apps/Yuzu/collection/          the card collection (sync)      My Apps/Yuzu/media/   images and sounds (master copy)

export const HUB_ROOT = "My Apps";
/** The shared "Citrus apps" web client (a public id). */
export const DEFAULT_CLIENT_ID = "753489712404-ra7ahu34gjl305b4ss1765idmqg7am5s.apps.googleusercontent.com";
export const SCOPE = "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email";
const GIS = "https://accounts.google.com/gsi/client";
const TOKEN_KEY = "yuzu-google";
export interface GoogleToken { access: string; expires: number; email?: string; scope: string }

export class GoogleError extends Error { constructor(message: string, public status = 0, public auth = false, public retryable = false) { super(message); } }

// ---------------------------------------------------------------- token
export function savedToken(): GoogleToken | null { try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null"); return t && (t.access || t.email) ? t : null; } catch { return null; } }
export function tokenValid(t = savedToken(), now = Date.now()): boolean { return !!t?.access && t.expires - now > 60000; }
export function forgetToken() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* fine */ } }
function saveToken(t: GoogleToken) { try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch { /* fine */ } }
/** Keep who is signed in, drop the expired token (the Settings row then says "Reconnect"). */
export function expireToken() { const t = savedToken(); if (t) saveToken({ ...t, access: "", expires: 0 }); }

// ---------------------------------------------------------------- sign-in (GIS token client)
declare global { interface Window { google?: any } }
let gisLoading: Promise<void> | null = null;
/** Load Google's sign-in script (preloaded at start-up when signed in, so a tap can open the window straight away). */
export function loadGis(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new GoogleError("No browser."));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = GIS; s.async = true;
    s.onload = () => res(); s.onerror = () => { gisLoading = null; rej(new GoogleError("Couldn't load Google sign-in. Are you online?", 0, false, true)); };
    document.head.appendChild(s);
  });
  return gisLoading;
}
/** Whether this moment is inside a tap (only then may Google's window open on a phone). */
export const inTap = () => (typeof navigator !== "undefined" && (navigator as any).userActivation ? !!(navigator as any).userActivation.isActive : true);
/**
 * Get a token. Call from a tap. `renew`: the account already agreed, so Google answers without asking (a window flashes
 * and closes); otherwise it shows the account chooser and the consent screen.
 */
export async function signIn(clientId: string, { renew = false } = {}): Promise<GoogleToken> {
  if (!clientId) throw new GoogleError("No Google client ID (Settings → Google → advanced).");
  await loadGis();
  const prev = savedToken();
  const tok = await new Promise<any>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE, include_granted_scopes: true, ...(prev?.email ? { hint: prev.email } : {}),
      callback: (r: any) => (r?.error ? reject(new GoogleError(/interaction|login_required|consent/.test(r.error) ? "Google needs you to sign in again." : `Google sign-in: ${r.error_description || r.error}`, 401, true)) : resolve(r)),
      error_callback: (e: any) => reject(new GoogleError(e?.type === "popup_closed" ? "Sign-in window closed." : e?.type === "popup_failed_to_open" ? "The browser blocked Google's window. Tap again." : `Google sign-in: ${e?.message || e?.type || "failed"}`)),
    });
    client.requestAccessToken({ prompt: renew ? "" : "consent" });
  });
  const t: GoogleToken = { access: tok.access_token, expires: Date.now() + (Number(tok.expires_in) || 3600) * 1000, scope: tok.scope || SCOPE, email: prev?.email };
  saveToken(t); return t;
}
export function signOut() { const t = savedToken(); try { if (t?.access && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t.access, () => {}); } catch { /* fine */ } forgetToken(); }
/** The account's email, for the Settings row and the hint on the next sign-in. */
export async function whoAmI(): Promise<string> { try { const r = await gfetch("https://www.googleapis.com/oauth2/v3/userinfo"); const email = (await r.json())?.email ?? ""; const t = savedToken(); if (t && email) saveToken({ ...t, email }); return email; } catch { return savedToken()?.email ?? ""; } }

// ---------------------------------------------------------------- calls
/** Authenticated fetch with plain-word errors and retries; a 401 clears the saved token so the UI asks for a tap. */
let retryScale = 1;
/** Tests only: shrink the backoff waits (the waits themselves are what keeps a phone's sync alive on a bad connection). */
export function setRetryScale(x: number) { retryScale = x; }
export async function gfetch(url: string, init: RequestInit = {}, token = savedToken(), tries = 6): Promise<Response> {
  if (!token?.access) throw new GoogleError("Not connected to Google.", 401, true);
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new GoogleError("You're offline. Nothing is lost; Yuzu carries on when you're back online.", 0, false, true);
  let res: Response; let m = "";
  const wait = (attempt: number) => new Promise((r) => setTimeout(r, Math.min(16000, 800 * 2 ** attempt) * (0.75 + Math.random() * 0.5) * retryScale));
  for (let attempt = 0; ; attempt++) {
    // A phone's connection drops mid-request now and then (and when the app goes to the background): retry for ~25 s.
    try { res = await fetch(url, { ...init, cache: "no-store", headers: { ...(init.headers as any), Authorization: `Bearer ${token.access}` } }); }
    catch (e: any) { if (attempt < tries - 1) { await wait(attempt); continue; } throw new GoogleError(`Google couldn't be reached — the connection dropped (${e?.message ?? "offline"}). Nothing is lost; Yuzu carries on from where it stopped.`, 0, false, true); }
    m = "";
    if (res.status === 403 || res.status === 429) { try { const j = await res.clone().json(); m = j?.error?.message ?? ""; m += " " + (j?.error?.errors?.map((x: any) => x.reason).join(" ") ?? ""); } catch { /* no body */ } }
    const slowDown = res.status === 429 || (res.status === 403 && /rate ?limit|ratelimit|quota|userRateLimitExceeded|rateLimitExceeded/i.test(m));
    if ((slowDown || res.status >= 500) && attempt < 6) { await wait(attempt + 1); continue; }
    break;
  }
  if (res.ok || res.status === 404) return res;
  if (!m) { try { m = (await res.clone().json())?.error?.message ?? ""; } catch { /* no body */ } }
  if (res.status === 401 || (res.status === 403 && /insufficient|scope/i.test(m))) { expireToken(); throw new GoogleError("Google needs a tap to reconnect.", res.status, true); }
  if (res.status === 403) throw /quota|rate/i.test(m) ? new GoogleError("Google asked Yuzu to slow down; it carries on in a minute.", 403, false, true) : new GoogleError(`Google refused (403): ${m.trim() || "no permission"}.`, 403);
  if (res.status === 429 || res.status >= 500) throw new GoogleError(`Google is busy (${res.status}); Yuzu carries on in a minute.`, res.status, false, true);
  if (res.status === 412 || res.status === 409) throw new GoogleError("Drive changed while syncing.", res.status);
  throw new GoogleError(`Google ${res.status}: ${m || res.statusText}`, res.status);
}

// ---------------------------------------------------------------- Drive helpers (no app knowledge)
export const DRIVE = "https://www.googleapis.com/drive/v3", UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER = "application/vnd.google-apps.folder", GSHEET = "application/vnd.google-apps.spreadsheet";
export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export interface DriveFile { id: string; name: string; mimeType?: string; modifiedTime?: string; createdTime?: string; size?: number; md5?: string; props?: Record<string, string> }
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const q = (p: Record<string, string>) => new URLSearchParams(p).toString();
export async function gjson(url: string, init?: RequestInit) { const r = await gfetch(url, init); return r.status === 404 ? null : r.status === 204 ? null : r.json(); }

export async function listFiles(o: { parent?: string | null; name?: string | null; folders?: boolean; pageSize?: number; all?: boolean; tag?: string }): Promise<DriveFile[]> {
  const parts = ["trashed = false"]; if (o.tag) parts.push(`appProperties has { key='citrusApp' and value='${esc(o.tag)}' }`); if (o.parent) parts.push(`'${esc(o.parent)}' in parents`); if (o.name) parts.push(`name = '${esc(o.name)}'`); if (o.folders) parts.push(`mimeType = '${FOLDER}'`);
  const out: DriveFile[] = []; let page: string | undefined;
  do {
    const j = await gjson(`${DRIVE}/files?${q({ q: parts.join(" and "), fields: "nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,size,md5Checksum,appProperties)", pageSize: String(o.pageSize ?? (o.all ? 1000 : 100)), spaces: "drive", ...(page ? { pageToken: page } : {}) })}`);
    for (const f of j?.files ?? []) out.push({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, createdTime: f.createdTime, size: Number(f.size) || 0, md5: f.md5Checksum, props: f.appProperties });
    page = o.all ? j?.nextPageToken : undefined;
  } while (page);
  return out;
}
/** A server-side copy of a Drive file into another folder (no bytes travel through this device). */
export async function copyFile(id: string, parent: string, name: string, props?: Record<string, string>): Promise<string> {
  const j = await gjson(`${DRIVE}/files/${encodeURIComponent(id)}/copy?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, parents: [parent], ...(props ? { appProperties: props } : {}) }) }); return j.id;
}
/**
 * A create (POST) whose answer can be lost: Drive may have made the file although the phone never heard back, and a plain
 * retry makes a second one. So each create carries a client-made id (appProperties.yc); after a dropped connection the
 * folder is looked up for a file with that id before trying again, and the retry happens only when there is none.
 */
export const clientId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
async function createOnce(send: () => Promise<Response>, find: () => Promise<string | null>): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try { const r = await send(); const j = r.status === 404 ? null : await r.json(); if (!j?.id) throw new GoogleError("Drive did not return a file id."); return j.id; }
    catch (e) {
      if (!(e instanceof GoogleError) || !/couldn't be reached/.test(e.message) || attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, Math.min(16000, 800 * 2 ** attempt) * (0.75 + Math.random() * 0.5) * retryScale));
      const got = await find().catch(() => null); if (got) return got; // it was made after all: no second copy
    }
  }
}
const findMine = async (parent: string | null, name: string, yc: string, folders = false) => (await listFiles({ parent: parent ?? "root", name, folders })).find((f) => f.props?.yc === yc)?.id ?? null;
export async function createFolder(name: string, parent: string | null, tag?: string): Promise<string> {
  const yc = clientId(); const appProperties: Record<string, string> = tag ? { yc, citrusApp: tag } : { yc };
  return createOnce(() => gfetch(`${DRIVE}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, appProperties, ...(parent ? { parents: [parent] } : {}) }) }, savedToken(), 1), () => findMine(parent, name, yc, true));
}
/** The folder at `path` under My Drive, created where missing; ids cached by path and re-checked only when a call about them fails. */
export async function ensureFolders(path: string[], cache: Record<string, string>): Promise<string> { return (await findFolders(path, cache, true))!; }
/** The folder at `path`, or null when it isn't there (with `create`, made where missing). */
// Folder ids from the cache are checked once per app session (one request for the deepest folder of a path vouches for the
// folders above it); until then every refresh spent a request per folder per call just to confirm ids it already had.
const verified = new Set<string>();
export function forgetVerified() { verified.clear(); }
/**
 * Citrus's Drive layout (claude/drive-layout.md, 17/11/2026): every app folder carries appProperties.citrusApp = "<id>" and
 * Citrus moves it into Citrus/… once every app that reads it finds it by that tag. So the first folder of each of these old
 * paths is found by its tag (oldest if several, checked once per app session), and only when nothing carries the tag does
 * Yuzu fall back to the old path, creating it there (tagged at once) if it is missing too. A tagged folder anywhere means a
 * path is never created, which is how twins would appear after a move. Yuzu never renames or moves these folders.
 */
export const ANCHORS: { path: string[]; tag: string }[] = [
  { path: [HUB_ROOT, "Yuzu"], tag: "yuzu-data" },        // collection/, media/, backups/, collection/inbox and outbox
  { path: [HUB_ROOT, "hub", "yuzu"], tag: "yuzu" },      // status.json
  { path: [HUB_ROOT, "hub", "citrus"], tag: "citrus" },  // plan.json (read)
  { path: [HUB_ROOT, "Rotas"], tag: "rotas" },           // the rota files (read)
];
const tagLooked = new Map<string, Promise<string | null>>(); // tag → its folder id this session (null: nothing carries it)
export function forgetTags() { tagLooked.clear(); }
/** The folder Citrus tagged `tag`: the oldest when there are several; null when none is tagged (yet). Errors are thrown, never read as "none". */
export function folderByTag(tag: string): Promise<string | null> {
  let p = tagLooked.get(tag);
  if (!p) { p = listFiles({ folders: true, tag }).then((f) => (f.length ? [...f].sort(byAge)[0].id : null)); p.catch(() => tagLooked.delete(tag)); tagLooked.set(tag, p); }
  return p;
}
export async function findFolders(path: string[], cache: Record<string, string>, create = false): Promise<string | null> {
  const full = path.join("/");
  const anchor = ANCHORS.find((a) => a.path.length <= path.length && a.path.every((n, i) => path[i] === n));
  let tagged: string | null = null;
  if (anchor) {
    const key = anchor.path.join("/"); tagged = await folderByTag(anchor.tag);
    if (tagged) {
      if (cache[key] !== tagged) { for (const k of Object.keys(cache)) if (k === key || k.startsWith(key + "/") || k.startsWith("?" + key)) delete cache[k]; cache[key] = tagged; } // found somewhere else (moved, or tagged after we cached the old path)
      verified.add(tagged); delete cache["?" + key];
    }
  }
  if (cache[full] && verified.has(cache[full])) return cache[full];
  if (cache[full]) { const ok = await gjson(`${DRIVE}/files/${encodeURIComponent(cache[full])}?fields=id,trashed`).then((f: any) => f && !f.trashed, () => false); if (ok) { verified.add(cache[full]); return cache[full]; } }
  // under a tagged folder the walk starts there: the old path above it (My Apps…) may be gone after Citrus's move
  let parent: string | null = tagged; let key = tagged ? anchor!.path.join("/") : "";
  for (const name of tagged ? path.slice(anchor!.path.length) : path) {
    key = key ? `${key}/${name}` : name; let id: string | null = cache[key] ?? null;
    if (id && !verified.has(id)) { const ok = await gjson(`${DRIVE}/files/${encodeURIComponent(id)}?fields=id,trashed`).then((f: any) => f && !f.trashed, () => false); if (!ok) { id = null; delete cache[key]; } else verified.add(id); }
    if (!id) {
      const miss = cache["?" + key]; // "not there" (looked up within the day, and the changes feed showed nothing made there since)
      if (!create && miss && Date.now() - Number(miss.split("|")[0]) < MISSING_MS) return null;
      const tagNow = anchor && key === anchor.path.join("/") ? anchor.tag : undefined; // the old path's own folder is made tagged at once
      id = await lookupFolder(parent, name, create, tagNow); if (!id) { cache["?" + key] = `${Date.now()}|${parent ?? "root"}|${name}`; return null; }
      delete cache["?" + key]; cache[key] = id; verified.add(id);
    }
    parent = id;
  }
  return parent;
}
const MISSING_MS = 86400000;
/** The changes feed showed `name` appear in folder `parent`: forget any "not there" kept for it. Returns whether one was. */
export function folderAppeared(cache: Record<string, string>, parent: string | undefined, name: string | undefined): boolean {
  let hit = false; if (!name) return false;
  for (const [k, v] of Object.entries(cache)) { if (k[0] !== "?") continue; const [, p, n] = v.split("|"); if (n === name && (p === parent || p === "root")) { delete cache[k]; hit = true; } }
  return hit;
}
// One lookup-or-create per folder at a time: the sync and the refresh both make "My Apps" on a fresh Drive, and without
// this each made its own (two "My Apps" folders, the apps' files split between them).
const inFlight = new Map<string, Promise<string | null>>();
function lookupFolder(parent: string | null, name: string, create: boolean, tag?: string): Promise<string | null> {
  const k = `${parent ?? "root"}/${name}/${create ? 1 : 0}`; const cur = inFlight.get(k); if (cur) return cur;
  const p = (async () => {
    const made = inFlight.get(`${parent ?? "root"}/${name}/1`); if (!create && made) return made; // a create in progress answers a lookup too
    let found = await listFiles({ parent: parent ?? "root", name, folders: true });
    if (!found.length && create) { await createFolder(name, parent, tag); found = await listFiles({ parent: parent ?? "root", name, folders: true }); } // listed again: another device may have made one at the same moment
    if (!found.length) return null;
    return found.length > 1 ? mergeTwins(found) : found[0].id;
  })().finally(() => inFlight.delete(k));
  inFlight.set(k, p); return p;
}
const byAge = (a: DriveFile, b: DriveFile) => ((a.createdTime ?? a.modifiedTime ?? "") < (b.createdTime ?? b.modifiedTime ?? "") ? -1 : (a.createdTime ?? a.modifiedTime ?? "") > (b.createdTime ?? b.modifiedTime ?? "") ? 1 : a.id < b.id ? -1 : 1);
/** Two folders of one name side by side: the oldest is kept (every device picks the same), the others' contents move into it and the empty twin goes to the bin. */
export async function mergeTwins(found: DriveFile[]): Promise<string> {
  const [keep, ...rest] = [...found].sort(byAge);
  for (const t of rest) {
    try {
      for (const c of await listFiles({ parent: t.id, all: true })) await gjson(`${DRIVE}/files/${encodeURIComponent(c.id)}?addParents=${encodeURIComponent(keep.id)}&removeParents=${encodeURIComponent(t.id)}&fields=id`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!(await listFiles({ parent: t.id })).length) await gjson(`${DRIVE}/files/${encodeURIComponent(t.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
    } catch { /* the next lookup tries again */ }
  }
  return keep.id;
}
// Partial downloads need Google to accept the Range header from a web page. If the first ranged read dies at the network level
// while a plain read of the same file works, the Range header is what's refused: remember that (a week) and read whole files.
const RB = "yuzu_range_broken"; let rangeVerified = false;
let rangeBrokenAt = (() => { try { return Number(localStorage.getItem(RB)) || 0; } catch { return 0; } })();
export function rangeSupported(): boolean { return !(rangeBrokenAt && Date.now() - rangeBrokenAt < 7 * 86400000); }
/** Tests: forget what was learned about partial downloads. */
export function resetRange() { rangeVerified = false; rangeBrokenAt = 0; try { localStorage.removeItem(RB); } catch { /* fine */ } }
/** A file's bytes (a Google Sheet as .xlsx); `range` [start, end] (inclusive) fetches only that slice. null when it's gone. */
export async function downloadBytes(f: DriveFile | string, range?: [number, number]): Promise<Uint8Array | null> {
  const file = typeof f === "string" ? { id: f } as DriveFile : f;
  const url = file.mimeType === GSHEET ? `${DRIVE}/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(XLSX)}` : `${DRIVE}/files/${encodeURIComponent(file.id)}?alt=media`;
  const whole = async () => { const r = await gfetch(url); return r.status === 404 ? null : new Uint8Array(await r.arrayBuffer()); };
  const cut = (b: Uint8Array | null) => (b && range ? b.slice(range[0], range[1] + 1) : b);
  if (!range) return whole();
  if (!rangeSupported()) return cut(await whole());
  try {
    const r = await gfetch(url, { headers: { Range: `bytes=${range[0]}-${range[1]}` } }, savedToken(), rangeVerified ? 6 : 2); if (r.status === 404) return null;
    rangeVerified = true; const b = new Uint8Array(await r.arrayBuffer());
    return r.status === 200 && b.length > range[1] - range[0] + 1 ? b.slice(range[0], range[1] + 1) : b; // a server that ignored the Range
  } catch (e) {
    if (rangeVerified || !(e instanceof GoogleError) || !/couldn't be reached/.test(e.message)) throw e;
    const all = await whole(); // a real outage throws here and nothing is learned
    rangeBrokenAt = Date.now(); try { localStorage.setItem(RB, String(rangeBrokenAt)); } catch { /* fine */ }
    return cut(all);
  }
}
/** One metadata read (e.g. the manifest's appProperties) without downloading the file. */
export async function fileMeta(id: string, fields = "id,name,modifiedTime,trashed,appProperties"): Promise<any | null> { return gjson(`${DRIVE}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`); }
/** The Drive changes feed: everything that changed in My Drive since `token` (one request when nothing did). */
export interface DriveChange { id: string; removed: boolean; name?: string; parents?: string[]; trashed?: boolean; size?: number; modifiedTime?: string; props?: Record<string, string> }
export async function changesSince(token: string, maxPages = 50): Promise<{ changes: DriveChange[]; token: string; more: boolean }> {
  const out: DriveChange[] = []; let t = token; let next = token;
  for (let i = 0; i < maxPages && t; i++) {
    const page = await gjson(`${DRIVE}/changes?pageToken=${encodeURIComponent(t)}&fields=${encodeURIComponent("nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,size,parents,trashed,modifiedTime,appProperties))")}&pageSize=1000&spaces=drive&includeRemoved=true`);
    if (!page) throw new GoogleError("Drive's change list restarted.", 410);
    for (const c of page.changes ?? []) { const f = c.file; out.push({ id: f?.id ?? c.fileId, removed: !!c.removed, name: f?.name, parents: f?.parents, trashed: f?.trashed, size: f ? Number(f.size) || 0 : 0, modifiedTime: f?.modifiedTime, props: f?.appProperties }); }
    if (page.newStartPageToken) { next = page.newStartPageToken; t = ""; } else { t = page.nextPageToken ?? ""; next = t || next; }
  }
  return { changes: out, token: next, more: !!t };
}
export async function startToken(): Promise<string> { return (await gjson(`${DRIVE}/changes/startPageToken`))?.startPageToken ?? ""; }
/** Write bytes/text as `name` in the folder: updated in place when an id is known (or found), else created. Returns the id. */
/**
 * Write a file into a folder: updated in place when its id is known (or found by name), else created. `props` are stored
 * as the file's appProperties (Yuzu keeps a content fingerprint there). `isNew`: the caller knows the file isn't there yet,
 * so no lookup by name is spent on it. Returns the id.
 */
export async function putFile(o: { parent: string; name: string; body: BodyInit; mime?: string; id?: string | null; props?: Record<string, string>; isNew?: boolean }): Promise<string> {
  const mime = o.mime ?? "application/json"; let id = o.id ?? null;
  if (!id && !o.isNew) id = (await listFiles({ parent: o.parent, name: o.name }))[0]?.id ?? null;
  if (id && !o.props) { await gfetch(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=id`, { method: "PATCH", headers: { "Content-Type": mime }, body: o.body }); return id; }
  const boundary = "yuzu" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const yc = id ? "" : clientId();
  const meta = id ? { ...(o.props ? { appProperties: o.props } : {}) } : { name: o.name, parents: [o.parent], mimeType: mime, appProperties: { ...(o.props ?? {}), yc } };
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
  const body = new Blob([head, o.body as BlobPart, `\r\n--${boundary}--`]);
  if (!id) return createOnce(() => gfetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body }, savedToken(), 1), () => findMine(o.parent, o.name, yc));
  const j = await gjson(`${UPLOAD}/files${id ? "/" + encodeURIComponent(id) : ""}?uploadType=multipart&fields=id`, { method: id ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  if (!j?.id) throw new GoogleError("Drive did not return a file id."); return j.id;
}
export async function deleteFile(id: string) { await gfetch(`${DRIVE}/files/${encodeURIComponent(id)}`, { method: "DELETE" }); }
