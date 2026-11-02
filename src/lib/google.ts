// Google for the Citrus apps (the hub contract, 02/11/2026): one Google Cloud project, each app signs in by itself with
// the OAuth "implicit" redirect — the app sends you to Google, Google sends you straight back with a one-hour access
// token in the URL hash. No backend, no secret, nothing to install. The token lives in localStorage on this device only.
//
// A quiet renewal (prompt=none) bounces through Google without asking anything while you are still signed in there;
// otherwise the Settings row and the coach say "Google needs a tap".
//
// Drive layout (shared with Orange and Citrus Maxima):
//   My Apps/Rotas/                 the department's schedule files (read)
//   My Apps/hub/yuzu/status.json   Yuzu's "where I am" for the scheduler (written)
//   My Apps/hub/scheduler/plan.json the scheduler's answer (read)
//   My Apps/Yuzu/collection/       the card collection (sync)      My Apps/Yuzu/media/  images and sounds (master copy)

export const HUB_ROOT = "My Apps";
/** The shared web client of the "My Apps" Cloud project (a public id; the app's address must be among its redirect URIs). */
export const DEFAULT_CLIENT_ID = "753489712404-m8600u5f3osnsieeu63ci05ik70rv49p.apps.googleusercontent.com";
export const SCOPE = "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_KEY = "yuzu-google", PENDING_KEY = "yuzu-gauth";
export interface GoogleToken { access: string; expires: number; email?: string; scope: string }

export class GoogleError extends Error { constructor(message: string, public status = 0, public auth = false, public retryable = false) { super(message); } }

// ---------------------------------------------------------------- token
export function savedToken(): GoogleToken | null { try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null"); return t && t.access ? t : null; } catch { return null; } }
export function tokenValid(t = savedToken(), now = Date.now()): boolean { return !!t && t.expires - now > 60000; }
export function forgetToken() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* fine */ } }
function saveToken(t: GoogleToken) { try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch { /* fine */ } }

// ---------------------------------------------------------------- sign-in by redirect
/** The address Google sends you back to: this app's own, which must be listed on the web client in the Cloud console. */
export const redirectUri = (loc: Location = location) => `${loc.origin}${loc.pathname.replace(/index\.html$/, "")}`;
export function authUrl(clientId: string, { silent = false, hint = "", state = "" } = {}, loc: Location = location) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(loc), response_type: "token", scope: SCOPE, include_granted_scopes: "true", state });
  if (silent) q.set("prompt", "none"); if (hint) q.set("login_hint", hint);
  return `${AUTH}?${q}`;
}
/** Leave for Google (the page navigates away). `silent` renews without a screen while you're still signed in there. */
export function startConnect(clientId: string, { silent = false, hint = "" } = {}) {
  if (!clientId) throw new GoogleError("No Google client ID: paste it in Settings → Google.");
  const state = `${silent ? "s" : "i"}.${Math.random().toString(36).slice(2)}.${Date.now()}`;
  try { sessionStorage.setItem(PENDING_KEY, state); } catch { /* private mode: accepted without the nonce check */ }
  location.assign(authUrl(clientId, { silent, hint, state }));
}
/**
 * At boot: Google's answer in the URL hash, removed from the address bar. null when the app opened normally; else the
 * saved token, or { error, silent } ("login_required" after a silent try just means: ask with a tap next time).
 */
export function captureRedirect(now = Date.now()): { token?: GoogleToken; error?: string; silent: boolean } | null {
  const hash = location.hash || ""; if (!/(^|[#&])(access_token|error)=/.test(hash)) return null;
  const p = new URLSearchParams(hash.replace(/^#/, "")); let pending: string | null = null;
  try { pending = sessionStorage.getItem(PENDING_KEY); sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  try { history.replaceState(null, "", `${location.pathname}${location.search}`); } catch { /* ignore */ }
  const state = p.get("state") || ""; const silent = state.startsWith("s.");
  if (pending && state && pending !== state) return { error: "state_mismatch", silent };
  if (p.get("error")) return { error: p.get("error")!, silent };
  const t: GoogleToken = { access: p.get("access_token")!, expires: now + Number(p.get("expires_in") || 3600) * 1000, scope: p.get("scope") || SCOPE, email: savedToken()?.email };
  saveToken(t); return { token: t, silent };
}
/** The account's email, for the Settings row and the login hint. */
export async function whoAmI(): Promise<string> { try { const r = await gfetch("https://www.googleapis.com/oauth2/v3/userinfo"); const email = (await r.json())?.email ?? ""; const t = savedToken(); if (t && email) saveToken({ ...t, email }); return email; } catch { return savedToken()?.email ?? ""; } }

// ---------------------------------------------------------------- calls
/** Authenticated fetch with plain-word errors and retries; a 401 clears the saved token so the UI asks for a tap. */
export async function gfetch(url: string, init: RequestInit = {}, token = savedToken()): Promise<Response> {
  if (!token) throw new GoogleError("Not connected to Google.", 401, true);
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try { res = await fetch(url, { ...init, cache: "no-store", headers: { ...(init.headers as any), Authorization: `Bearer ${token.access}` } }); }
    catch (e: any) { if (attempt < 2) { await new Promise((r) => setTimeout(r, 700 * 2 ** attempt)); continue; } throw new GoogleError(`No connection to Google (${e?.message ?? "offline"}).`, 0, false, true); }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    break;
  }
  if (res.ok || res.status === 404) return res;
  let m = ""; try { m = (await res.clone().json())?.error?.message ?? ""; } catch { /* no body */ }
  if (res.status === 401 || (res.status === 403 && /insufficient|scope/i.test(m))) { forgetToken(); throw new GoogleError("Google signed this device out. Tap Connect in Settings → Google.", res.status, true); }
  if (res.status === 403) throw new GoogleError(/quota|rate/i.test(m) ? "Google is rate-limiting; it will retry later." : `Google refused (403): ${m || "no permission"}.`, 403);
  if (res.status === 412 || res.status === 409) throw new GoogleError("Drive changed while syncing.", res.status);
  throw new GoogleError(`Google ${res.status}: ${m || res.statusText}`, res.status);
}

// ---------------------------------------------------------------- Drive helpers (no app knowledge)
export const DRIVE = "https://www.googleapis.com/drive/v3", UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER = "application/vnd.google-apps.folder", GSHEET = "application/vnd.google-apps.spreadsheet";
export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export interface DriveFile { id: string; name: string; mimeType?: string; modifiedTime?: string; size?: number; md5?: string }
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const q = (p: Record<string, string>) => new URLSearchParams(p).toString();
export async function gjson(url: string, init?: RequestInit) { const r = await gfetch(url, init); return r.status === 404 ? null : r.status === 204 ? null : r.json(); }

export async function listFiles(o: { parent?: string | null; name?: string | null; folders?: boolean; pageSize?: number; all?: boolean }): Promise<DriveFile[]> {
  const parts = ["trashed = false"]; if (o.parent) parts.push(`'${esc(o.parent)}' in parents`); if (o.name) parts.push(`name = '${esc(o.name)}'`); if (o.folders) parts.push(`mimeType = '${FOLDER}'`);
  const out: DriveFile[] = []; let page: string | undefined;
  do {
    const j = await gjson(`${DRIVE}/files?${q({ q: parts.join(" and "), fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size,md5Checksum)", pageSize: String(o.pageSize ?? (o.all ? 1000 : 100)), spaces: "drive", ...(page ? { pageToken: page } : {}) })}`);
    for (const f of j?.files ?? []) out.push({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, size: Number(f.size) || 0, md5: f.md5Checksum });
    page = o.all ? j?.nextPageToken : undefined;
  } while (page);
  return out;
}
export async function createFolder(name: string, parent: string | null): Promise<string> {
  const j = await gjson(`${DRIVE}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }) }); return j.id;
}
/** The folder at `path` under My Drive, created where missing; ids cached by path and re-checked only when a call about them fails. */
export async function ensureFolders(path: string[], cache: Record<string, string>): Promise<string> {
  let parent: string | null = null; let key = "";
  for (const name of path) {
    key = key ? `${key}/${name}` : name; let id: string | null = cache[key] ?? null;
    if (id) { const ok = await gjson(`${DRIVE}/files/${encodeURIComponent(id)}?fields=id,trashed`).then((f: any) => f && !f.trashed, () => false); if (!ok) id = null; }
    if (!id) { const found = await listFiles({ parent: parent ?? "root", name, folders: true }); id = found[0]?.id ?? (await createFolder(name, parent)); cache[key] = id; }
    parent = id;
  }
  return parent!;
}
export async function downloadBytes(f: DriveFile | string): Promise<Uint8Array | null> {
  const file = typeof f === "string" ? { id: f } as DriveFile : f;
  const url = file.mimeType === GSHEET ? `${DRIVE}/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(XLSX)}` : `${DRIVE}/files/${encodeURIComponent(file.id)}?alt=media`;
  const r = await gfetch(url); return r.status === 404 ? null : new Uint8Array(await r.arrayBuffer());
}
/** Write bytes/text as `name` in the folder: updated in place when an id is known (or found), else created. Returns the id. */
export async function putFile(o: { parent: string; name: string; body: BodyInit; mime?: string; id?: string | null }): Promise<string> {
  const mime = o.mime ?? "application/json"; let id = o.id ?? null;
  if (!id) id = (await listFiles({ parent: o.parent, name: o.name }))[0]?.id ?? null;
  if (id) { await gfetch(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=id`, { method: "PATCH", headers: { "Content-Type": mime }, body: o.body }); return id; }
  const boundary = "yuzu" + Date.now().toString(36);
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: o.name, parents: [o.parent], mimeType: mime })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
  const body = new Blob([head, o.body as BlobPart, `\r\n--${boundary}--`]);
  const j = await gjson(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  if (!j?.id) throw new GoogleError("Drive did not return a file id."); return j.id;
}
export async function deleteFile(id: string) { await gfetch(`${DRIVE}/files/${encodeURIComponent(id)}`, { method: "DELETE" }); }
export const folderLink = (id: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
