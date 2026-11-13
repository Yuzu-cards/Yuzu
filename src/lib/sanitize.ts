// Values that come from outside (card packs, curation files, backups, other devices) are checked here before they
// reach the collection: one number where text belongs ("tags": [2026], "extra": 5) used to crash Yuzu at every launch.
import type { Card, Note } from "./model";

/** Text, whatever came in: a string stays, null/undefined become "", numbers and booleans become their text, anything else "". */
export function str(x: unknown): string {
  if (typeof x === "string") return x;
  if (x == null) return "";
  if (typeof x === "number" || typeof x === "boolean" || typeof x === "bigint") return String(x);
  return "";
}
/** Tags: an array keeps its non-empty strings (numbers become text); one string is one tag (not split into letters). */
export function strTags(t: unknown): string[] {
  const one = (x: unknown) => (typeof x === "string" ? x.trim() : typeof x === "number" && Number.isFinite(x) ? String(x) : "");
  if (Array.isArray(t)) return t.map(one).filter(Boolean);
  const s = one(t); return s ? [s] : [];
}
/** A deck path: parts split on "::", trimmed (stray colons too), empty parts dropped, each part at most 80 characters. */
export function normCategory(x: unknown, fallback = ""): string {
  const parts = str(x).split("::").map((p) => p.replace(/^[\s:]+|[\s:]+$/g, "").slice(0, 80).trim()).filter(Boolean);
  return parts.length ? parts.join("::") : fallback;
}
/** A list of ids (strings only). */
export function strList(x: unknown): string[] { return Array.isArray(x) ? x.filter((v): v is string => typeof v === "string" && !!v) : []; }

/** A stored note made safe to render: every field and tag text. `changed` says whether anything had to be fixed. */
export function cleanNote(n: Note): { note: Note; changed: boolean } {
  const fieldsOk = Array.isArray(n.fields) && n.fields.every((f) => typeof f === "string");
  const tagsOk = Array.isArray(n.tags) && n.tags.every((t) => typeof t === "string" && t.trim() === t && !!t);
  const idsOk = typeof n.ntid === "string";
  if (fieldsOk && tagsOk && idsOk) return { note: n, changed: false };
  return { note: { ...n, ntid: str(n.ntid), fields: Array.isArray(n.fields) ? n.fields.map(str) : [str(n.fields)], tags: strTags(n.tags) }, changed: true };
}
/** A stored card's deck path made text (the Library tree and filters call string methods on it). */
export function cleanCardSource(c: Card): Card { return typeof c.source === "string" ? c : { ...c, source: normCategory(c.source, "Medicine::Inbox") }; }

/** Decode a data: URL without fetch() (fetch fails the whole import with "Failed to fetch" on one bad picture). Throws on bad data. */
export function dataUrlToBytes(u: string): { mime: string; bytes: Uint8Array } {
  const m = /^data:([\w.+-]+\/[\w.+-]+)((?:;[\w.+-]+=[\w.+-]+)*)(;base64)?,(.*)$/s.exec(u);
  if (!m) throw new Error("not a data URL");
  if (m[3]) {
    const b64 = m[4].replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 === 1 || !b64.length) throw new Error("bad base64");
    const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: m[1], bytes };
  }
  return { mime: m[1], bytes: new TextEncoder().encode(decodeURIComponent(m[4])) };
}
export function dataUrlOk(u: string): boolean { try { dataUrlToBytes(u); return true; } catch { return false; } }
