// Yuzu card packs: small JSON files written by Claude (or by hand) and imported like an Anki file.
//
// {
//   "yuzu_pack": 1,
//   "name": "Hyperkalemia in the ED",
//   "category": "Medicine::Emergency Medicine::Electrolytes",   // where the cards go (deck path)
//   "tags": ["auto::System::Renal", "auto::Specialty::Emergency Medicine"],  // applied to every card
//   "cards": [
//     { "type": "cloze", "text": "First ECG change in hyperkalemia: {{c1::peaked T waves}}", "extra": "optional explanation", "tags": ["step1"] },
//     { "type": "basic", "front": "Antidote for hyperkalemia-induced membrane instability?", "back": "IV calcium gluconate 10%, 10–30 mL", "image": "data:image/png;base64,..." }
//   ]
// }
import type { Card, Note, Notetype } from "../lib/model";
import { noteTitle } from "../lib/render";
import { IO_ID, parseMasks, formatMasks, type Mask } from "../lib/occlusion";
import { MCQ_ID, optionsFromPack, formatOptions, valid } from "../lib/mcq";
import { str, strTags, normCategory, dataUrlOk } from "../lib/coerce";

export const PACK_CLOZE: Notetype = {
  id: "yuzu-cloze", name: "Yuzu Cloze", kind: "cloze",
  css: ".card{font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:20px;line-height:1.45;text-align:left;padding:4px} .extra{margin-top:14px;padding-top:10px;border-top:1px solid #8884;font-size:17px;opacity:.9} img{max-width:100%;border-radius:8px;display:block;margin:10px auto} .src{margin-top:12px;font-size:12px;opacity:.6}",
  fields: ["Text", "Extra", "Image", "Source"],
  templates: [{ name: "Cloze", qfmt: "{{#Image}}{{Image}}{{/Image}}{{cloze:Text}}", afmt: "{{#Image}}{{Image}}{{/Image}}{{cloze:Text}}{{#Extra}}<div class=extra>{{Extra}}</div>{{/Extra}}{{#Source}}<div class=src>{{Source}}</div>{{/Source}}" }],
};
export const PACK_BASIC: Notetype = {
  id: "yuzu-basic", name: "Yuzu Basic", kind: "standard",
  css: PACK_CLOZE.css,
  fields: ["Front", "Back", "Image", "Source"],
  templates: [{ name: "Card 1", qfmt: "{{#Image}}{{Image}}{{/Image}}{{Front}}", afmt: "{{FrontSide}}<hr id=answer>{{Back}}{{#Source}}<div class=src>{{Source}}</div>{{/Source}}" }],
};

export const PACK_MCQ: Notetype = {
  id: MCQ_ID, name: "Yuzu MCQ", kind: "standard",
  css: PACK_CLOZE.css,
  fields: ["Question", "Options", "Image", "Source", "Explanation"],
  templates: [{ name: "Choice", qfmt: "{{#Image}}{{Image}}{{/Image}}{{Question}}", afmt: "{{FrontSide}}<hr id=answer>{{#Explanation}}<div class=extra>{{Explanation}}</div>{{/Explanation}}{{#Source}}<div class=src>{{Source}}</div>{{/Source}}" }],
};

export const PACK_IO: Notetype = {
  id: IO_ID, name: "Yuzu Image Occlusion", kind: "cloze",
  css: PACK_CLOZE.css + " .io{position:relative;display:block;margin:6px auto;line-height:0} .io img{display:block;width:100%;height:auto;border-radius:8px} .io-box{position:absolute;box-sizing:border-box;border:2px dashed #8888} .io-hide{background:#f08a24;border:2px solid #b8600c;border-radius:4px} .io-open{border:3px solid #7fa34a;background:#7fa34a22;border-radius:4px} .io-ans{margin-top:10px;line-height:1.4;font-weight:600}",
  fields: ["Title", "Masks", "Image", "Source", "Extra"],
  templates: [{ name: "Occlusion", qfmt: "{{Title}}", afmt: "{{Title}}" }],
};

export const VOCAB_ID = "yuzu-vocab";
/** German (or any language) vocabulary: two cards, word → meaning and meaning → word. Audio: a recording when the pack has one, else the device says the word. */
export const PACK_VOCAB: Notetype = {
  id: VOCAB_ID, name: "Yuzu Vocab", kind: "standard",
  css: PACK_CLOZE.css + " .vw{font-size:1.5em;font-weight:700;line-height:1.3} .va{opacity:.7;font-weight:600;margin-right:.25em} .vpl{opacity:.7;font-size:.8em;margin-top:2px} .vex{margin-top:10px;font-style:italic;opacity:.85} .vm{font-size:1.25em;font-weight:600}",
  fields: ["Word", "Meaning", "Audio", "Source", "Article", "Plural", "Example", "Lang"],
  templates: [
    { name: "Word → meaning", qfmt: "<div class=vw>{{#Article}}<span class=va>{{Article}}</span>{{/Article}}{{Word}}</div>{{Audio}}", afmt: "{{FrontSide}}<hr id=answer><div class=vm>{{Meaning}}</div>{{#Plural}}<div class=vpl>Plural: {{Plural}}</div>{{/Plural}}{{#Example}}<div class=vex>{{Example}}</div>{{/Example}}{{#Source}}<div class=src>{{Source}}</div>{{/Source}}" },
    { name: "Meaning → word", qfmt: "<div class=vm>{{Meaning}}</div>", afmt: "{{FrontSide}}<hr id=answer><div class=vw>{{#Article}}<span class=va>{{Article}}</span>{{/Article}}{{Word}}</div>{{Audio}}{{#Plural}}<div class=vpl>Plural: {{Plural}}</div>{{/Plural}}{{#Example}}<div class=vex>{{Example}}</div>{{/Example}}" },
  ],
};

// Revisions: give a card a stable "id" (unique within the pack) and re-importing a later version updates
// that note in place, keeping its review history. "replaces" names an existing note id to update instead
// (used to revise cards imported before they had ids).
export interface PackCard { id?: string; replaces?: string; source?: string; type?: "cloze" | "basic" | "mcq" | "occlusion" | "vocab"; masks?: Mask[]; word?: string; meaning?: string; article?: string; plural?: string; example?: string; audio?: string; lang?: string; question?: string; options?: unknown; answer?: number | string; explanation?: string; text?: string; extra?: string; front?: string; back?: string; image?: string; tags?: string[]; category?: string }
export interface Pack { yuzu_pack: 1; id?: string; name?: string; source?: string; category?: string; tags?: string[]; cards: PackCard[] }


export function hash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

export function normalizeText(s: string): string {
  return s.replace(/\{\{c\d+::(.*?)(::[^}]*)?\}\}/g, "$1").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function shingles(s: string): Set<string> { const w = s.split(" "); return new Set(w.length > 1 ? w.slice(1).map((x, i) => w[i] + " " + x) : w); }

const MEDIA_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpeg", "image/jpg": "jpeg", "image/pjpeg": "jpeg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif",
  "image/svg+xml": "svg", "image/bmp": "bmp", "image/heic": "heic", "image/heif": "heif",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/ogg": "ogg", "audio/opus": "opus", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "audio/webm": "webm", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/flac": "flac",
};
/** Largest picture or recording a pack may carry, decoded (a phone photo fits; a runaway base64 blob does not). */
export const PACK_MEDIA_MAX = 10 * 1024 * 1024;
/** A pack's data: URL → a short stored file name (hash + known extension), or null when it is not a known image/sound type or too big. */
export function packMediaName(dataUrl: unknown, kind: "image" | "audio"): string | null {
  if (typeof dataUrl !== "string") return null;
  const m = /^data:([a-z]+\/[a-z0-9.+-]+)(;[^,]*)?,/i.exec(dataUrl.slice(0, 200));
  if (!m) return null;
  const mime = m[1].toLowerCase(); const ext = MEDIA_EXT[mime];
  if (!ext || !mime.startsWith(kind + "/")) return null;
  const body = dataUrl.length - m[0].length; const bytes = /;base64$/i.test(m[2] ?? "") ? body * 0.75 : body;
  if (bytes > PACK_MEDIA_MAX) return null;
  return `pack-${hash(dataUrl)}.${ext}`;
}

/** Why a card of a pack was not added (counted and worded in the result instead of being called a duplicate). */
export type InvalidReason = "notCard" | "text" | "mcqAnswer" | "mcqOpts" | "ioMasks" | "ioImage" | "vocab" | "gap" | "dupId" | "replaces";
const REASONS: Record<InvalidReason, [string, string]> = {
  notCard: ["entry was not a card", "entries were not cards"],
  text: ["card had no text", "cards had no text"],
  mcqAnswer: ["MCQ had no correct answer", "MCQs had no correct answer"],
  mcqOpts: ["MCQ had fewer than 2 options", "MCQs had fewer than 2 options"],
  ioMasks: ["picture card had no boxes", "picture cards had no boxes"],
  ioImage: ["picture card had no readable picture", "picture cards had no readable picture"],
  vocab: ["word had no meaning", "words had no meaning"],
  gap: ["cloze had no gap like {{c1::…}}", "clozes had no gap like {{c1::…}}"],
  dupId: ["card repeated an id used earlier in the pack", "cards repeated an id used earlier in the pack"],
  replaces: ["card tried to replace a note that isn't from a pack", "cards tried to replace a note that isn't from a pack"],
};
export interface PackResult {
  notetypes: Notetype[]; notes: Note[]; cards: Card[]; media: { name: string; dataUrl: string }[];
  /** Every card not added for any reason (duplicates + deleted + invalid); kept for older callers. */
  skipped: number;
  /** Already in the collection. */ duplicates: number;
  /** The user deleted these notes (tombstone); not brought back unless asked. */ deleted: number; deletedIds: string[];
  /** Broken cards, with the reason, by position in the pack. */ invalid: { index: number; reason: InvalidReason }[];
  /** Notes already in the collection that had no cards (an interrupted import): their cards are made again. */ repaired: string[];
  /** Things dropped from cards that were still added ("1 picture could not be read"). */ warnings: string[];
  similar: number; updated: string[]; unchanged: number; mediaRejected?: number;
}
export interface PackOptions {
  /** The collection's tombstones: notes the user deleted stay deleted. */ tombstones?: Record<string, number>;
  /** Bring deleted notes back anyway. */ restoreDeleted?: boolean;
  /** Does this existing note have any cards? (no = repair it) */ hasCards?: (nid: string) => boolean;
}
const TYPES = new Set(["cloze", "basic", "mcq", "occlusion", "vocab"]);
const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
export const countOf = plural;


export function parsePack(json: unknown, existing: Iterable<Note>, now = Date.now(), opts: PackOptions = {}): PackResult {
  const p = json as Pack;
  if (!p || typeof p !== "object" || p.yuzu_pack !== 1 || !Array.isArray(p.cards)) throw new Error("Not a Yuzu card pack (expected { yuzu_pack: 1, cards: [...] })");
  const tomb = opts.tombstones ?? {}; const hasCards = opts.hasCards ?? (() => true);
  const byId = new Map<string, Note>(); const normOf = new Map<string, string>();
  const exact = new Map<string, string>(); const index = new Map<string, Set<string>>(); const texts = new Map<string, Set<string>>();
  for (const n of existing) {
    const t = normalizeText(n.fields.map(str).join(" ")); if (!exact.has(t)) exact.set(t, n.id); byId.set(n.id, n); normOf.set(n.id, normalizeText(n.fields.slice(0, 2).map(str).join(" ")));
    const sh = shingles(t); texts.set(n.id, sh);
    for (const x of sh) (index.get(x) ?? index.set(x, new Set()).get(x)!).add(n.id);
  }
  const notes: Note[] = []; const cards: Card[] = []; const media: PackResult["media"] = [];
  let duplicates = 0, deleted = 0, similar = 0, unchanged = 0, badImages = 0, badAudio = 0, mediaRejected = 0;
  const updated: string[] = []; const invalid: PackResult["invalid"] = []; const repaired: string[] = []; const deletedIds: string[] = [];
  const seenIds = new Set<string>(); const madeHere = new Set<string>();
  const packKey = str(p.id) || str(p.name) || "pack";
  const base = normCategory(p.category, "Medicine::Inbox");
  const packTags = strTags(p.tags); const packLang = str((p as any).lang);
  const isDeleted = (id: string) => tomb["n:" + id] !== undefined && !byId.has(id) && !opts.restoreDeleted;
  p.cards.forEach((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { invalid.push({ index: i, reason: "notCard" }); return; }
    const c = raw as PackCard;
    const text = str(c.text), extra = str(c.extra), front = str(c.front), back = str(c.back), question = str(c.question), word = str(c.word), meaning = str(c.meaning) || back;
    const cid = str(c.id).trim(), replaces = str(c.replaces).trim(), image = str(c.image), audio = str(c.audio);
    const type = TYPES.has(c.type as string) ? c.type! : (text ? "cloze" : c.options ? "mcq" : c.masks ? "occlusion" : word ? "vocab" : "basic");
    const nt = type === "cloze" ? PACK_CLOZE : type === "mcq" ? PACK_MCQ : type === "occlusion" ? PACK_IO : type === "vocab" ? PACK_VOCAB : PACK_BASIC;
    if (cid && seenIds.has(cid)) { invalid.push({ index: i, reason: "dupId" }); return; }
    let imageField = ""; let imageBad = false;
    if (/^data:/i.test(image)) {
      const name = dataUrlOk(image) ? packMediaName(image, "image") : null;
      if (name) { media.push({ name, dataUrl: image }); imageField = `<img src="${name}">`; }
      else if (dataUrlOk(image)) mediaRejected++; else imageBad = true;
    }
    const src = str(c.source ?? p.source);
    const mopts = type === "mcq" ? optionsFromPack(c.options, c.answer) : [];
    const masks = type === "occlusion" ? parseMasks(formatMasks(Array.isArray(c.masks) ? c.masks.filter((m) => m && typeof m === "object").map((m) => ({ x: +m.x, y: +m.y, w: +m.w, h: +m.h, label: str(m.label) })) : [])) : [];
    let audioField = ""; let audioBad = false; const lang = str(c.lang) || packLang || "de-DE";
    if (type === "vocab") { const say = lang.replace(/^de$/i, "de-DE");
      const aname = /^data:/i.test(audio) && dataUrlOk(audio) ? packMediaName(audio, "audio") : null;
      if (/^data:/i.test(audio) && dataUrlOk(audio) && !aname) mediaRejected++;
      if (aname) { media.push({ name: aname, dataUrl: audio }); audioField = `[sound:${aname}]`; }
      else if (/^[\w.-]+\.(mp3|ogg|wav|m4a|opus)$/i.test(audio)) audioField = `[sound:${audio}]`;
      else { audioBad = /^data:/.test(audio); audioField = `[tts:${say}:${[str(c.article), word].filter(Boolean).join(" ")}]`; } }
    const fields = type === "vocab" ? [word, meaning, audioField, src, str(c.article), str(c.plural), str(c.example), lang] : type === "occlusion" ? [front || question || "Image occlusion", formatMasks(masks), imageField, src, extra] : type === "cloze" ? [text, extra, imageField, src] : type === "mcq" ? [question || front, formatOptions(mopts), imageField, src, str(c.explanation) || extra] : [front, back, imageField, src];
    const bad: InvalidReason | null = type === "mcq" ? (!fields[0].trim() ? "text" : mopts.length < 2 ? "mcqOpts" : !valid(mopts) ? "mcqAnswer" : null)
      : type === "occlusion" ? (!imageField ? "ioImage" : !masks.length ? "ioMasks" : null)
      : !fields[0].trim() ? "text"
      : type === "vocab" && !meaning.trim() ? "vocab"
      : type === "cloze" && !/\{\{c[1-9]\d*::/.test(text) ? "gap" : null;
    if (bad) { invalid.push({ index: i, reason: bad }); return; }
    if (cid) seenIds.add(cid);
    const warn = () => { if (imageBad) badImages++; if (audioBad) badAudio++; };
    const norm = normalizeText(fields.slice(0, 2).join(" "));
    let target: string | null = cid ? "p" + hash(packKey + "#" + cid) : null;
    if (replaces && byId.has(replaces)) {
      const old = byId.get(replaces)!;
      // Only a pack's own note (ids "p…") or a note of the same type may be rewritten: an Anki note is changed with curation "edits".
      if (!(old.id.startsWith("p") || old.ntid === nt.id)) { invalid.push({ index: i, reason: "replaces" }); return; }
      target = replaces;
    }
    const prev = target ? byId.get(target) : undefined;
    const cat = normCategory(c.category, base);
    if (prev) {
      // Revision of a card already in the collection: update in place, keep scheduling.
      const tags = [...new Set([...prev.tags.filter((t) => t !== "needs-review::similar"), ...packTags, ...strTags(c.tags)])];
      if (normOf.get(prev.id) === norm && fields.every((f, i) => (prev.fields[i] ?? "") === (f ?? "")) && tags.length === prev.tags.length) {
        if (!hasCards(prev.id) && !madeHere.has(prev.id)) { repaired.push(prev.id); madeHere.add(prev.id); pushCards(prev.id, type, text, masks.length, cat, now + i); warn(); return; }
        unchanged++; return;
      }
      notes.push({ ...prev, ntid: nt.id, fields, tags, modified: Math.max(now + i, prev.modified + 1) });
      updated.push(prev.id); madeHere.add(prev.id); warn();
      pushCards(prev.id, type, text, masks.length, cat, now + i);
      return;
    }
    if (target && isDeleted(target)) { deleted++; deletedIds.push(target); return; }
    const same = exact.get(norm);
    if (same !== undefined) {
      // Already here. A note left without cards by an interrupted import gets its cards back.
      if (byId.has(same) && !madeHere.has(same) && !hasCards(same)) { repaired.push(same); madeHere.add(same); pushCards(same, type, text, masks.length, cat, now + i); warn(); return; }
      duplicates++; return;
    }
    const id = target ?? "p" + hash(norm + "|" + nt.id);
    if (isDeleted(id)) { deleted++; deletedIds.push(id); return; }
    // near-duplicate check against existing notes
    const sh = shingles(norm); const cand = new Map<string, number>();
    for (const x of sh) { const ids = index.get(x); if (ids && ids.size < 2000) for (const id of ids) cand.set(id, (cand.get(id) ?? 0) + 1); }
    let isSimilar = false;
    for (const [id, k] of cand) {
      const other = texts.get(id)!; const j = k / (sh.size + other.size - k); const containment = k / Math.max(1, Math.min(sh.size, other.size));
      if (j >= 0.6 || (containment >= 0.8 && Math.min(sh.size, other.size) >= 4)) { isSimilar = true; break; }
    }
    const tags = [...new Set([...packTags, ...strTags(c.tags), ...(isSimilar ? ["needs-review::similar"] : [])])];
    const note: Note = { id, ntid: nt.id, guid: id, fields, tags, created: now + i, modified: now + i };
    notes.push(note); exact.set(norm, id); madeHere.add(id); warn();
    texts.set(id, sh); for (const x of sh) (index.get(x) ?? index.set(x, new Set()).get(x)!).add(id);
    if (isSimilar) similar++;
    pushCards(id, type, text, masks.length, cat, now + i);
  });
  function pushCards(id: string, type: string, text: string, nMasks: number, source: string, t: number) {
    for (const ord of packOrds(type, text, nMasks)) {
      cards.push({ id: `${id}-${ord}`, nid: id, ord, state: "new", suspended: false, flag: 0, due: t, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: 0, step: 0, created: t, mod: t, source });
    }
  }
  const warnings: string[] = [];
  if (badImages) warnings.push(`${plural(badImages, "picture")} could not be read and ${badImages === 1 ? "was" : "were"} left out`);
  if (badAudio) warnings.push(`${plural(badAudio, "recording")} could not be read (the device voice is used instead)`);
  if (mediaRejected) warnings.push(`${mediaRejected} picture${mediaRejected === 1 ? "" : "s"} or sound${mediaRejected === 1 ? "" : "s"} left out (not a known image or sound type, or over ${PACK_MEDIA_MAX / 1048576} MB)`);
  return { notetypes: [PACK_CLOZE, PACK_BASIC, PACK_MCQ, PACK_IO, PACK_VOCAB], notes, cards, media, skipped: duplicates + deleted + invalid.length, duplicates, deleted, deletedIds, invalid, repaired, warnings, similar, updated, unchanged, mediaRejected };
}

export function packOrds(type: string, text?: string, masks?: number): number[] {
  if (type === "occlusion") return Array.from({ length: Math.max(1, masks ?? 1) }, (_, i) => i);
  if (type === "vocab") return [0, 1];
  if (type !== "cloze") return [0];
  const o = [...new Set([...(text ?? "").matchAll(/\{\{c([1-9]\d*)::/g)].map((m) => Number(m[1]) - 1))].sort((a, b) => a - b);
  return o.length ? o : [0];
}

/** "2 MCQs had no correct answer, 1 cloze had no gap like {{c1::…}}" */
export function describeInvalid(invalid: { reason: InvalidReason }[]): string {
  const by = new Map<InvalidReason, number>(); for (const x of invalid) by.set(x.reason, (by.get(x.reason) ?? 0) + 1);
  return [...by].map(([k, n]) => `${n.toLocaleString("en-US")} ${REASONS[k][n === 1 ? 0 : 1]}`).join(", ");
}

/** What an import did, counted for callers (the quick-add editor keeps its form when nothing was saved). */
export interface PackSummary {
  /** New notes and the cards they made. */ added: number; addedCards: number;
  updated: number; unchanged: number; repaired: number; repairedCards: number;
  skippedDuplicate: number; skippedDeleted: number; skippedInvalid: number; invalid: { index: number; reason: InvalidReason }[];
  similar: number; warnings: string[]; noteIds: string[]; message: string;
}
export function summarizePack(r: PackResult): PackSummary {
  const upd = new Set(r.updated); const rep = new Set(r.repaired);
  const fresh = r.notes.filter((n) => !upd.has(n.id)); const freshIds = new Set(fresh.map((n) => n.id));
  const addedCards = r.cards.filter((c) => freshIds.has(c.nid)).length; const repairedCards = r.cards.filter((c) => rep.has(c.nid)).length;
  const s: PackSummary = { added: fresh.length, addedCards, updated: r.updated.length, unchanged: r.unchanged, repaired: r.repaired.length, repairedCards, skippedDuplicate: r.duplicates, skippedDeleted: r.deleted, skippedInvalid: r.invalid.length, invalid: r.invalid, similar: r.similar, warnings: r.warnings, noteIds: [...fresh.map((n) => n.id), ...r.updated, ...r.repaired], message: "" };
  s.message = describeSummary(s, fresh.slice(0, 3).map((n) => noteTitle(n)).join(" · "));
  return s;
}
function describeSummary(s: PackSummary, titles: string): string {
  const notesCards = (n: number, c: number) => (n === c ? plural(n, "card") : `${plural(n, "note")} (${plural(c, "card")})`);
  const parts: string[] = [];
  if (s.added) parts.push(`${notesCards(s.added, s.addedCards)} added`);
  if (s.updated) parts.push(`${s.updated.toLocaleString("en-US")} updated (review history kept)`);
  if (s.repaired) parts.push(`${s.repaired.toLocaleString("en-US")} repaired (${plural(s.repairedCards, "missing card")} made again)`);
  const done = parts.length;
  if (s.unchanged) parts.push(`${s.unchanged.toLocaleString("en-US")} unchanged`);
  if (s.skippedDuplicate) parts.push(`${plural(s.skippedDuplicate, "card")} already in your collection`);
  if (s.skippedDeleted) parts.push(`${plural(s.skippedDeleted, "card")} you deleted (left out)`);
  if (s.skippedInvalid) parts.push(`${plural(s.skippedInvalid, "broken card")} left out (${describeInvalid(s.invalid)})`);
  if (s.similar) parts.push(`${s.similar.toLocaleString("en-US")} tagged needs-review::similar`);
  parts.push(...s.warnings);
  if (!done) return `Nothing added — ${parts.length ? parts.join(", ") : "the pack had no cards"}`;
  return parts.join(", ") + (titles ? ` — ${titles}` : "");
}
/** One line for the user (kept for callers that only show text). */
export function describePack(r: PackResult): string { return summarizePack(r).message; }
