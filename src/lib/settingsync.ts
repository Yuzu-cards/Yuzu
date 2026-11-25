// Settings sync, field by field. Each synced setting carries its own change time in `stamps` (like Orange's valueAt), so a
// change on one device survives an unrelated change on another. Device-only settings (look, sound, this device's habits,
// where it syncs) never travel. Settings written by older Yuzu versions carry only one `updatedAt` for the whole object:
// they still merge, as if every field had changed at that time (which is what those versions meant).

import { cleanDeckOpts, cleanDeckStyles } from "./deckopts";

/** Settings that belong to this phone, tablet or computer: never sent, never taken from another device or from a backup file. */
export const DEVICE_ONLY = ["sync", "deviceName", "nightCards", "swipe", "typeAnswers", "mediaDownload", "theme", "sfx", "autoplay", "cardStyle"] as const;
const DEVICE = new Set<string>(DEVICE_ONLY);
const META = new Set(["updatedAt", "stamps"]);
/** Objects whose fields are stamped one by one (the rota read on one device, Drive-is-master toggled on another). */
const NESTED = new Set(["google", "deckOpts", "deckStyles"]);
/** The fallback stamp for fields never stamped individually (settings saved before per-field stamps). */
const BASE = "*";

export type Stamps = Record<string, number>;
type Obj = Record<string, any>;

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const maxOf = (st: Stamps | undefined) => { let m = 0; if (st) for (const v of Object.values(st)) if (typeof v === "number" && v > m) m = v; return m; };
/** A legacy write: updatedAt newer than every stamp means an older Yuzu changed something without stamping it. */
const legacy = (s: Obj) => { const u = Number(s?.updatedAt) || 0; return u > maxOf(s?.stamps) ? u : 0; };
/** When `key` last changed in these settings. */
export function stampOf(s: Obj, key: string): number { const st: Stamps | undefined = s?.stamps; return Math.max(st?.[key] ?? st?.[BASE] ?? 0, legacy(s)); }

/** The synced keys present in `s` ("google.rota" for the nested ones). */
export function syncedKeys(s: Obj): string[] {
  const out: string[] = [];
  for (const k of Object.keys(s ?? {})) {
    if (DEVICE.has(k) || META.has(k) || s[k] === undefined) continue;
    if (NESTED.has(k) && s[k] && typeof s[k] === "object" && !Array.isArray(s[k])) { for (const sub of Object.keys(s[k])) out.push(`${k}.${sub}`); }
    else out.push(k);
  }
  return out;
}
const get = (s: Obj, key: string) => { const i = key.indexOf("."); return i < 0 ? s?.[key] : s?.[key.slice(0, i)]?.[key.slice(i + 1)]; };
function put(s: Obj, key: string, v: unknown) { const i = key.indexOf("."); if (i < 0) { s[key] = v; return; } const top = key.slice(0, i); s[top] = { ...(s[top] ?? {}), [key.slice(i + 1)]: v }; }
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
/** This device's stamps, starting from the whole-object time when the settings predate per-field stamps. */
function ownStamps(s: Obj): Stamps { return s?.stamps ? { ...s.stamps } : { [BASE]: Number(s?.updatedAt) || 0 }; }

/**
 * Stamp what a save changed. Only synced fields whose value differs get the new time; `updatedAt` moves only when one did,
 * so a colour change on the tablet never makes its stale study settings look newer than the phone's.
 */
export function stampChanges<T extends Obj>(prev: T, next: T, t: number, only?: string[]): T {
  const stamps = ownStamps(prev); let changed = false; const look = only ? new Set(only) : null;
  for (const k of syncedKeys(next)) { if (look && !look.has(k.split(".")[0])) continue; if (!same(get(prev, k), get(next, k))) { stamps[k] = t; changed = true; } }
  return { ...next, stamps, updatedAt: changed ? Math.max(t, Number(prev.updatedAt) || 0) : Number(prev.updatedAt) || 0 };
}

/**
 * Merge another device's settings into this device's, field by field: the later change of each field wins, device-only
 * fields stay as they are here. Returns the merged settings and the synced keys whose value came from `remote`.
 */
export function mergeSettings<T extends Obj>(local: T, remote: Obj | null | undefined): { settings: T; changed: string[] } {
  if (!remote || typeof remote !== "object") return { settings: local, changed: [] };
  const out: Obj = { ...local }; const stamps = ownStamps(local); const changed: string[] = [];
  for (const k of syncedKeys(remote)) {
    const rs = stampOf(remote, k), ls = stampOf(local, k);
    if (rs <= ls) continue;
    const rv = get(remote, k);
    if (!same(rv, get(local, k))) { put(out, k, clone(rv)); changed.push(k); }
    stamps[k] = rs;
  }
  // An older Yuzu stamped the whole object: every unstamped field here now holds its value as of that time (taken above or newer here).
  const rl = legacy(remote); if (rl) stamps[BASE] = Math.max(stamps[BASE] ?? 0, rl);
  out.stamps = stamps; out.updatedAt = Math.max(Number(local.updatedAt) || 0, Number(remote.updatedAt) || 0, maxOf(stamps));
  return { settings: out as T, changed };
}

/** What a device sends: the synced fields and their stamps, nothing that belongs to this device. */
export function shareable<T extends Obj>(s: T): Obj { const out: Obj = {}; for (const [k, v] of Object.entries(s)) if (!DEVICE.has(k)) out[k] = v; return out; }

/** Settings from outside (a backup file, another device): drop this device's own fields. */
export function withoutDeviceFields(s: Obj): Obj { const out: Obj = {}; for (const [k, v] of Object.entries(s ?? {})) if (!DEVICE.has(k) && !META.has(k)) out[k] = v; return out; }

const num = (v: unknown, lo: number, hi: number, dflt: number, int = true) => { let n = typeof v === "number" ? v : Number(v); if (!Number.isFinite(n)) return dflt; if (int) n = Math.round(n); return Math.min(hi, Math.max(lo, n)); };
const oneOf = <T,>(v: unknown, list: readonly T[], dflt: T): T => (list.includes(v as T) ? (v as T) : dflt);
const arr = (v: unknown, dflt: any[]) => (Array.isArray(v) ? v : dflt);
const obj = (v: unknown, dflt: Obj): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : dflt);

/**
 * Keep settings inside what the app can work with, whatever wrote them (a slider, a backup file, another device, an old version):
 * no negative new-card limits, no goal of 0, no 100-year intervals from a target recall of 0.
 */
export function sanitizeSettings<T extends Obj>(s: T, d: Obj): T {
  const o: Obj = { ...s };
  o.newPerDay = num(o.newPerDay, 0, 9999, d.newPerDay);
  o.dailyGoal = num(o.dailyGoal, 1, 99999, d.dailyGoal);
  o.maxReviewsPerDay = num(o.maxReviewsPerDay, 0, 99999, d.maxReviewsPerDay);
  o.rollover = num(o.rollover, 0, 23, d.rollover);
  o.restDays = num(o.restDays, 0, 6, d.restDays);
  o.leechThreshold = num(o.leechThreshold, 2, 99, d.leechThreshold);
  o.retireAskYears = num(o.retireAskYears, 1, 100, d.retireAskYears);
  o.retireAutoYears = num(o.retireAutoYears, 0, 100, d.retireAutoYears);
  o.dueOrder = oneOf(o.dueOrder, ["due", "forgotten", "shuffle", "rescue"] as const, d.dueOrder);
  o.leechAction = oneOf(o.leechAction, ["claude", "pause", "ask"] as const, d.leechAction);
  o.theme = oneOf(o.theme, ["yuzu", "orange", "gameboy", "night"] as const, d.theme);
  o.cardStyle = oneOf(o.cardStyle, ["yuzu", "deck"] as const, d.cardStyle);
  const ed = arr(o.easyDays, d.easyDays); o.easyDays = ed.length === 7 ? ed.map((x: unknown, i: number) => num(x, 0, 1, d.easyDays[i] ?? 1, false)) : d.easyDays.slice();
  for (const k of ["pins", "smart", "deadlines", "hiddenFields", "applied"]) o[k] = arr(o[k], d[k]);
  for (const k of ["bosses", "deckMap"]) o[k] = obj(o[k], d[k]);
  o.deckOpts = cleanDeckOpts(o.deckOpts); o.deckStyles = cleanDeckStyles(o.deckStyles);
  const m = obj(o.mastery, d.mastery); o.mastery = { developing: num(m.developing, 1, 36500, d.mastery.developing, false), mastered: num(m.mastered, 1, 36500, d.mastery.mastered, false), durable: num(m.durable, 1, 36500, d.mastery.durable, false) };
  const sc = obj(o.scheduler, d.scheduler); const w = Array.isArray(sc.w) && sc.w.every((x: unknown) => typeof x === "number" && Number.isFinite(x)) ? sc.w : d.scheduler.w;
  const steps = (v: unknown, dflt: number[]) => (Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x) && x > 0) ? v : dflt);
  o.scheduler = { ...sc, w, desiredRetention: num(sc.desiredRetention, 0.7, 0.99, d.scheduler.desiredRetention, false), maximumInterval: num(sc.maximumInterval, 1, 36500, d.scheduler.maximumInterval), learningSteps: steps(sc.learningSteps, d.scheduler.learningSteps), relearningSteps: steps(sc.relearningSteps, d.scheduler.relearningSteps) };
  o.google = { ...d.google, ...obj(o.google, d.google) };
  return o as T;
}
