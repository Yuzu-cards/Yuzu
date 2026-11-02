// Google sign-in for the Citrus apps: one Google Cloud project (OAuth client) shared by Yuzu, Orange, Pomelo, Sinus and
// Mephisto. Google Identity Services' token client gives a short-lived access token (about an hour) straight from the
// browser — no server, no client secret. The token lives in localStorage on this device only.
//
// Scopes are asked for together on the first connect. Drive access is the full scope so a media folder you copied to
// Drive yourself (Anki's collection.media dragged in from a PC) is visible too; the project stays in "Testing" mode with
// you as its only test user, so Google never needs to verify it.

export const GOOGLE_SCOPES = {
  drive: "https://www.googleapis.com/auth/drive",
  calendar: "https://www.googleapis.com/auth/calendar.events",
  profile: "openid email",
};
const TOKEN_KEY = "yuzu-google";
export interface GoogleToken { access: string; expires: number; email?: string; scope: string }

declare global { interface Window { google?: any } }

let gisLoading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => res(); s.onerror = () => { gisLoading = null; rej(new Error("Couldn't load Google sign-in (offline, or the network blocks accounts.google.com).")); };
    document.head.appendChild(s);
  });
  return gisLoading;
}

export function savedToken(): GoogleToken | null {
  try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null"); return t && t.access ? t : null; } catch { return null; }
}
export function tokenValid(t = savedToken()): boolean { return !!t && t.expires - Date.now() > 60000; }
export function forgetToken() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* fine */ } }

/** Ask Google for a token. `silent` tries without any prompt (works while the Google session is alive). Needs a tap otherwise. */
export async function connectGoogle(clientId: string, opts: { silent?: boolean; scopes?: string[] } = {}): Promise<GoogleToken> {
  if (!clientId) throw new Error("No Google client ID yet: paste it in Settings → Google (from the shared Google Cloud project).");
  await loadGis();
  const scope = (opts.scopes ?? [GOOGLE_SCOPES.profile, GOOGLE_SCOPES.drive, GOOGLE_SCOPES.calendar]).join(" ");
  const tok = await new Promise<any>((res, rej) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope, include_granted_scopes: true,
      callback: (r: any) => (r?.access_token ? res(r) : rej(new Error(r?.error_description || r?.error || "Google sign-in was cancelled."))),
      error_callback: (e: any) => rej(new Error(e?.type === "popup_closed" ? "Sign-in window closed." : e?.message || "Google sign-in failed.")),
    });
    client.requestAccessToken({ prompt: opts.silent ? "" : "consent" });
  });
  const t: GoogleToken = { access: tok.access_token, expires: Date.now() + (Number(tok.expires_in) || 3600) * 1000, scope: tok.scope || scope };
  try { const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${t.access}` } }); if (r.ok) t.email = (await r.json()).email; } catch { /* the email is only a label */ }
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch { /* fine */ }
  return t;
}

export class GoogleError extends Error { constructor(message: string, public status = 0) { super(message); } }

/** Authenticated fetch to a Google API with plain-word errors; a 401 clears the saved token so the UI asks to reconnect. */
export async function gfetch(url: string, init: RequestInit = {}, token = savedToken()): Promise<Response> {
  if (!token) throw new GoogleError("Not connected to Google.", 401);
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try { res = await fetch(url, { ...init, headers: { ...(init.headers as any), Authorization: `Bearer ${token.access}` } }); }
    catch (e: any) { if (attempt < 2) { await new Promise((r) => setTimeout(r, 700 * 2 ** attempt)); continue; } throw new GoogleError(`No connection to Google (${e?.message ?? "offline"}).`); }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    break;
  }
  if (res.status === 401) { forgetToken(); throw new GoogleError("Google signed this device out. Tap Connect again in Settings → Google.", 401); }
  if (res.status === 403) { let m = ""; try { m = (await res.clone().json())?.error?.message ?? ""; } catch { /* no body */ } throw new GoogleError(/quota|rate/i.test(m) ? "Google is rate-limiting; it will retry later." : `Google refused (403): ${m || "the app may lack this permission — reconnect to grant it"}.`, 403); }
  if (!res.ok && res.status !== 404) { let m = ""; try { m = (await res.clone().json())?.error?.message ?? ""; } catch { /* no body */ } throw new GoogleError(`Google ${res.status}: ${m || res.statusText}`, res.status); }
  return res;
}
