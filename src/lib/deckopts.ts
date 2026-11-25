// Per-deck options (1.9.0, for decks built like a course or a story): set on a deck, they apply to it and every deck under
// it, unless a deeper deck sets the same option itself (the deepest one wins, option by option). Synced deck by deck
// (settings "deckOpts.<path>", lib/settingsync.ts): a deck's options changed on the phone and another deck's on the tablet
// both survive. A removed or renamed deck's entry becomes null, so the removal travels too.
import type { Note } from "./model";

export interface DeckOpts {
  /** New cards come strictly in the deck's own order (line by line), never round-robin between its subdecks. */
  ordered?: boolean;
  /** At most this many new cards a day from this deck (inside the overall new-card limit). */
  newPerDay?: number;
  /** "own": the deck's own look (its CSS and fonts, no Yuzu reading style); "yuzu": the Yuzu style even when this device
   *  shows decks' own looks. Unset: what this device's Look setting says. */
  look?: "own" | "yuzu";
  /** Show the previous line above the card (ordered decks). */
  prevLine?: boolean;
  /** The language the deck is in (a BCP-47 tag like "de-DE"), or "off": no reading aloud, no word meanings. */
  lang?: string;
  /** Read the line aloud: a button on the back (default), on every flip, or not at all. */
  readAloud?: "button" | "auto" | "off";
  /** Tap a word on the back for its meaning from your own vocab cards (default on in a language deck). */
  tapWord?: boolean;
  /** Strict order by line only (default), or subdeck by subdeck first ("Kapitel 2" before "Kapitel 10"), like Anki's deck order. */
  orderBy?: "line" | "subdeck" | "field";
  /** With orderBy "field": the note field whose number is the order (a Goethe deck's "Nr", "Index", "Sort"…). */
  orderField?: string;
  /** New cards from this deck come first each day (up to its own cap), before the other decks take turns. */
  priority?: boolean;
  /** "Say it" (record yourself and compare) on the back of this deck's cards (default on in a language deck). */
  sayIt?: boolean;
  /** How many lines before this one to show (1–3, default 1). */
  prevLines?: number;
  /** Reading pace for "Read the line": normal (default) or slow from the first tap. */
  readPace?: "normal" | "slow";
  /** Show "line N of M" above the card (default on in an ordered deck). */
  lineNo?: boolean;
  /** The subject design (Settings → Look) on this deck's cards; false turns it off here. */
  art?: boolean;
}
export type DeckOptsMap = Record<string, DeckOpts | null>;
export const OPT_KEYS = ["ordered", "newPerDay", "look", "prevLine", "lang", "readAloud", "tapWord", "orderBy", "prevLines", "readPace", "lineNo", "art", "orderField", "priority", "sayIt"] as const;
export type OptKey = (typeof OPT_KEYS)[number];

/** A deck's look, shared by all its cards instead of repeated in every card (and so in every file): CSS, and fonts kept as media. */
export interface DeckStyle { css: string; /** the pack it came with */ from?: string; at: number }
export type DeckStylesMap = Record<string, DeckStyle | null>;
export const DECK_CSS_MAX = 64 * 1024;

/** Keep what another device, a backup or a pack wrote within what the app can use. */
export function cleanDeckOpts(v: unknown): DeckOptsMap {
  const out: DeckOptsMap = {}; if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [path, o] of Object.entries(v as Record<string, unknown>)) {
    if (!path || path.length > 400) continue;
    if (o === null) { out[path] = null; continue; }
    if (!o || typeof o !== "object" || Array.isArray(o)) continue;
    const x = o as Record<string, unknown>; const d: DeckOpts = {};
    if (typeof x.ordered === "boolean") d.ordered = x.ordered;
    if (typeof x.newPerDay === "number" && Number.isFinite(x.newPerDay)) d.newPerDay = Math.max(0, Math.min(9999, Math.round(x.newPerDay)));
    if (x.look === "own" || x.look === "yuzu") d.look = x.look;
    if (typeof x.prevLine === "boolean") d.prevLine = x.prevLine;
    if (typeof x.lang === "string" && (x.lang === "off" || /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(x.lang))) d.lang = x.lang;
    if (x.readAloud === "button" || x.readAloud === "auto" || x.readAloud === "off") d.readAloud = x.readAloud;
    if (typeof x.tapWord === "boolean") d.tapWord = x.tapWord;
    if (x.orderBy === "line" || x.orderBy === "subdeck" || x.orderBy === "field") d.orderBy = x.orderBy;
    if (typeof x.orderField === "string" && x.orderField.length <= 80) d.orderField = x.orderField;
    if (typeof x.priority === "boolean") d.priority = x.priority;
    if (typeof x.sayIt === "boolean") d.sayIt = x.sayIt;
    if (typeof x.prevLines === "number" && Number.isFinite(x.prevLines)) d.prevLines = Math.max(1, Math.min(3, Math.round(x.prevLines)));
    if (x.readPace === "normal" || x.readPace === "slow") d.readPace = x.readPace;
    if (typeof x.lineNo === "boolean") d.lineNo = x.lineNo;
    if (typeof x.art === "boolean") d.art = x.art;
    out[path] = d;
  }
  return out;
}
export function cleanDeckStyles(v: unknown): DeckStylesMap {
  const out: DeckStylesMap = {}; if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [path, o] of Object.entries(v as Record<string, unknown>)) {
    if (!path) continue;
    if (o === null) { out[path] = null; continue; }
    const x = o as Record<string, unknown>;
    if (!x || typeof x !== "object" || typeof x.css !== "string" || x.css.length > DECK_CSS_MAX) continue;
    out[path] = { css: x.css, at: Number(x.at) || 0, ...(typeof x.from === "string" ? { from: x.from } : {}) };
  }
  return out;
}

/** The decks a path sits in, deepest first: "A::B::C" → ["A::B::C", "A::B", "A"]. */
export function ancestors(path: string): string[] { const parts = path.split("::"); const out: string[] = []; for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join("::")); return out; }

export interface Resolved { opts: DeckOpts; /** where each option was set */ at: Partial<Record<OptKey, string>> }
/** The options in force for a deck path: option by option, from the deepest deck that sets it. */
export function resolveOpts(map: DeckOptsMap, path: string): Resolved {
  const opts: DeckOpts = {}; const at: Resolved["at"] = {};
  for (const p of ancestors(path)) {
    const o = map[p]; if (!o) continue;
    for (const k of OPT_KEYS) if (o[k] !== undefined && at[k] === undefined) { (opts as any)[k] = o[k]; at[k] = p; }
  }
  return { opts, at };
}

/** The style in force for a deck path (the deepest deck that has one). */
export function resolveStyle(map: DeckStylesMap, path: string): { style: DeckStyle; at: string } | null {
  for (const p of ancestors(path)) { const s = map[p]; if (s) return { style: s, at: p }; }
  return null;
}

const LANG_NAMES: [RegExp, string][] = [
  [/^(german|deutsch|goethe.*|mephisto.*|medizin wortschatz|anamnese|dellas.*|fsp.*|telc.*|testdaf.*)$/i, "de-DE"],
  [/^(french|français|francais)$/i, "fr-FR"], [/^(spanish|español|espanol)$/i, "es-ES"], [/^(italian|italiano)$/i, "it-IT"],
  [/^(arabic|العربية)$/i, "ar-SA"], [/^(dutch|nederlands)$/i, "nl-NL"], [/^(portuguese|português)$/i, "pt-PT"], [/^(turkish|türkçe)$/i, "tr-TR"],
];
/** The language a deck path names, if any ("Languages::German::Goethe A1" → de-DE). */
export function langFromPath(path: string): string | null {
  for (const part of path.split("::")) { const t = part.trim(); for (const [re, tag] of LANG_NAMES) if (re.test(t)) return tag; }
  return null;
}
/** The language a deck reads in: its own setting, else what its path names. null: not a language deck (or turned off). */
export function deckLang(map: DeckOptsMap, path: string): string | null {
  const l = resolveOpts(map, path).opts.lang; if (l === "off") return null; return l ?? langFromPath(path);
}

/** A note's place in an ordered deck: a pack's line number first (when it has one), else when it was made (Anki's note
 *  id is its creation time, which is the order the author added the lines). Notes with a line number come first. */
export function compareLines(a: Note | undefined, b: Note | undefined): number {
  const sa = a?.seq, sb = b?.seq;
  if (sa !== undefined && sb !== undefined) { if (sa !== sb) return sa - sb; }
  else if (sa !== undefined) return -1; else if (sb !== undefined) return 1;
  return (a?.created ?? 0) - (b?.created ?? 0) || ((a?.id ?? "") < (b?.id ?? "") ? -1 : (a?.id ?? "") > (b?.id ?? "") ? 1 : 0);
}

/** Deck paths in reading order: "Kapitel 2" before "Kapitel 10", case ignored. */
export const comparePaths = (a: string, b: string) => (a === b ? 0 : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) || (a < b ? -1 : 1));

/** Paths in a map changed by a rename: the moved entries under their new path, the old ones set to null (so removal syncs). */
export function renameKeys<T>(map: Record<string, T | null>, from: string, to: string): Record<string, T | null> | null {
  const re = (p: string) => (p === from || p.startsWith(from + "::") ? to + p.slice(from.length) : p);
  let out: Record<string, T | null> | null = null;
  for (const [k, v] of Object.entries(map)) { if (v === null) continue; const nk = re(k); if (nk === k) continue; out ??= { ...map }; out[k] = null; if (!out[nk]) out[nk] = v; }
  return out;
}
