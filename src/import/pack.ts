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

// Revisions: give a card a stable "id" (unique within the pack) and re-importing a later version updates
// that note in place, keeping its review history. "replaces" names an existing note id to update instead
// (used to revise cards imported before they had ids).
export interface PackCard { id?: string; replaces?: string; source?: string; type?: "cloze" | "basic" | "mcq" | "occlusion"; masks?: Mask[]; question?: string; options?: unknown; answer?: number | string; explanation?: string; text?: string; extra?: string; front?: string; back?: string; image?: string; tags?: string[]; category?: string }
export interface Pack { yuzu_pack: 1; id?: string; name?: string; source?: string; category?: string; tags?: string[]; cards: PackCard[] }

export interface PackResult { notetypes: Notetype[]; notes: Note[]; cards: Card[]; media: { name: string; dataUrl: string }[]; skipped: number; similar: number; updated: string[]; unchanged: number }

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

export function parsePack(json: unknown, existing: Iterable<Note>, now = Date.now()): PackResult {
  const p = json as Pack;
  if (!p || p.yuzu_pack !== 1 || !Array.isArray(p.cards)) throw new Error("Not a Yuzu card pack (expected { yuzu_pack: 1, cards: [...] })");
  const byId = new Map<string, Note>(); const normOf = new Map<string, string>();
  const exact = new Set<string>(); const index = new Map<string, Set<string>>(); const texts = new Map<string, Set<string>>();
  for (const n of existing) {
    const t = normalizeText(n.fields.join(" ")); exact.add(t); byId.set(n.id, n); normOf.set(n.id, normalizeText(n.fields.slice(0, 2).join(" ")));
    const sh = shingles(t); texts.set(n.id, sh);
    for (const x of sh) (index.get(x) ?? index.set(x, new Set()).get(x)!).add(n.id);
  }
  const notes: Note[] = []; const cards: Card[] = []; const media: PackResult["media"] = [];
  let skipped = 0, similar = 0, unchanged = 0; const updated: string[] = [];
  const packKey = p.id || p.name || "pack";
  const base = p.category || "Medicine::Inbox";
  p.cards.forEach((c, i) => {
    const type = c.type ?? (c.text ? "cloze" : c.options ? "mcq" : c.masks ? "occlusion" : "basic");
    const nt = type === "cloze" ? PACK_CLOZE : type === "mcq" ? PACK_MCQ : type === "occlusion" ? PACK_IO : PACK_BASIC;
    let imageField = "";
    if (c.image && /^data:image\//.test(c.image)) { const name = `pack-${hash(c.image)}.${c.image.slice(11, c.image.indexOf(";")) || "png"}`; media.push({ name, dataUrl: c.image }); imageField = `<img src="${name}">`; }
    const src = c.source ?? p.source ?? "";
    const opts = type === "mcq" ? optionsFromPack(c.options, c.answer) : [];
    const masks = type === "occlusion" ? parseMasks(formatMasks(Array.isArray(c.masks) ? c.masks.map((m) => ({ x: +m.x, y: +m.y, w: +m.w, h: +m.h, label: String(m.label ?? "") })) : [])) : [];
    const fields = type === "occlusion" ? [c.front ?? c.question ?? "Image occlusion", formatMasks(masks), imageField, src, c.extra ?? ""] : type === "cloze" ? [c.text ?? "", c.extra ?? "", imageField, src] : type === "mcq" ? [c.question ?? c.front ?? "", formatOptions(opts), imageField, src, c.explanation ?? c.extra ?? ""] : [c.front ?? "", c.back ?? "", imageField, src];
    if (!fields[0].trim() || (type === "mcq" && !valid(opts)) || (type === "occlusion" && (!masks.length || !imageField))) { skipped++; return; }
    const norm = normalizeText(fields.slice(0, 2).join(" "));
    const target = c.replaces && byId.has(c.replaces) ? c.replaces : c.id ? "p" + hash(packKey + "#" + c.id) : null;
    const prev = target ? byId.get(target) : undefined;
    if (prev) {
      // Revision of a card already in the collection: update in place, keep scheduling.
      const tags = [...new Set([...prev.tags.filter((t) => t !== "needs-review::similar"), ...(p.tags ?? []), ...(c.tags ?? [])])];
      if (normOf.get(prev.id) === norm && prev.fields[2] === fields[2] && (prev.fields[3] ?? "") === fields[3] && (prev.fields[4] ?? "") === (fields[4] ?? "") && tags.length === prev.tags.length) { unchanged++; return; }
      const ntid = nt.id;
      notes.push({ ...prev, ntid, fields, tags, modified: Math.max(now + i, prev.modified + 1) });
      updated.push(prev.id);
      pushCards(prev.id, type, c, now + i);
      return;
    }
    if (exact.has(norm)) { skipped++; return; }
    // near-duplicate check against existing notes
    const sh = shingles(norm); const cand = new Map<string, number>();
    for (const x of sh) { const ids = index.get(x); if (ids && ids.size < 2000) for (const id of ids) cand.set(id, (cand.get(id) ?? 0) + 1); }
    let isSimilar = false;
    for (const [id, k] of cand) {
      const other = texts.get(id)!; const j = k / (sh.size + other.size - k); const containment = k / Math.max(1, Math.min(sh.size, other.size));
      if (j >= 0.6 || (containment >= 0.8 && Math.min(sh.size, other.size) >= 4)) { isSimilar = true; break; }
    }
    const tags = [...new Set([...(p.tags ?? []), ...(c.tags ?? []), ...(isSimilar ? ["needs-review::similar"] : [])])];
    const id = target ?? "p" + hash(norm + "|" + nt.id);
    const note: Note = { id, ntid: nt.id, guid: id, fields, tags, created: now + i, modified: now + i };
    notes.push(note); exact.add(norm);
    texts.set(id, sh); for (const x of sh) (index.get(x) ?? index.set(x, new Set()).get(x)!).add(id);
    if (isSimilar) similar++;
    pushCards(id, type, c, now + i);
  });
  function pushCards(id: string, type: string, c: PackCard, t: number) {
    for (const ord of packOrds(type, c.text, c.masks?.length)) {
      cards.push({ id: `${id}-${ord}`, nid: id, ord, state: "new", suspended: false, flag: 0, due: t, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: 0, step: 0, created: t, mod: t, source: c.category || base });
    }
  }
  return { notetypes: [PACK_CLOZE, PACK_BASIC, PACK_MCQ, PACK_IO], notes, cards, media, skipped, similar, updated, unchanged };
}

export function packOrds(type: string, text?: string, masks?: number): number[] {
  if (type === "occlusion") return Array.from({ length: Math.max(1, masks ?? 1) }, (_, i) => i);
  if (type !== "cloze") return [0];
  const o = [...new Set([...(text ?? "").matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]) - 1))].sort((a, b) => a - b);
  return o.length ? o : [0];
}

export function describePack(r: PackResult): string {
  const added = r.notes.length - r.updated.length;
  const t = r.notes.filter((n) => !r.updated.includes(n.id)).slice(0, 3).map((n) => noteTitle(n)).join(" · ");
  return `${added} cards added${r.updated.length ? `, ${r.updated.length} updated (review history kept)` : ""}${r.unchanged ? `, ${r.unchanged} unchanged` : ""}${r.skipped ? `, ${r.skipped} skipped as duplicates` : ""}${r.similar ? `, ${r.similar} tagged needs-review::similar` : ""}${t ? ` — ${t}` : ""}`;
}
