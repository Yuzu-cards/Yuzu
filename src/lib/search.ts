// Library search (WP16): every field of a note, stripped of HTML and cloze markup, digits made Latin, ranked.
// A note's text is kept as one lowercased string: front ␁ other fields ␁ tags ␁ housekeeping tags. Plain
// String.indexOf over that is fast enough for 100k notes when the scan is cut into slices (see Store.searchNotes).
import { latinDigits } from "./num";
import type { Note } from "./model";
import { IO_ID } from "./occlusion";

/** Tags that are bookkeeping, not topics: AnKing's #/!/~ trees, Yuzu's auto:: and manual:: labels, AnkiHub
 *  markers, anki::/needs-review:: queues, bare numbers and "…". Search skips them unless the query asks for them. */
export function isHousekeepingTag(t: string): boolean {
  return /^[#!~]/.test(t) || /^(auto|manual|anki|needs[-_]review|ankihub)(::|_|$)/i.test(t) || /^ankihub/i.test(t) || /^\d+$/.test(t) || /^(…|\.{2,})$/.test(t);
}

const SEP = "\u0001";
const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", shy: "" };
/** Visible text of a field: no styles/scripts, no tags, no cloze braces (the answer stays, the hint goes), no [sound:], entities decoded. */
export function stripForSearch(html: string): string {
  if (!html) return "";
  return html
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, "$1")
    .replace(/\[sound:[^\]]*\]/g, " ")
    .replace(/<br\s*\/?>|<\/?(div|p|li|ul|ol|tr|td|th|h\d|table|hr)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); try { return n === 160 ? " " : String.fromCodePoint(n); } catch { return m; } }
      return ENT[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}
const norm = (s: string) => latinDigits(s).toLowerCase();

/** The note as one searchable string (see the header). The front is the first non-empty field, as in the list's titles. */
export function buildSearchDoc(n: Note): string {
  const parts = n.fields.map((f, i) => (n.ntid === IO_ID && i === 1 ? "" : stripForSearch(f))); // an occlusion's mask list is coordinates, not text
  const fi = parts.findIndex((p) => p.length > 0);
  const front = fi >= 0 ? parts[fi] : "";
  const rest = parts.filter((p, i) => i !== fi && p).join("\n");
  const tags: string[] = [], hk: string[] = [];
  for (const t of n.tags) (isHousekeepingTag(t) ? hk : tags).push(t);
  return norm(front) + SEP + norm(rest) + SEP + norm(tags.join(" ")) + SEP + norm(hk.join(" "));
}

export interface SearchQuery { phrase: string; tokens: string[]; tagsOnly: boolean; housekeeping: boolean; key: string }
/** "tag:x" searches tags only; housekeeping tags are searched only when the query looks like one (#…, auto::…, a :: path). */
export function parseQuery(input: string): SearchQuery | null {
  let s = norm(input).replace(/\s+/g, " ").trim(); let tagsOnly = false;
  if (s.startsWith("tag:")) { tagsOnly = true; s = s.slice(4).trim(); }
  if (!s) return null;
  const housekeeping = tagsOnly && /^[#!~]|::/.test(s) || isHousekeepingTag(s) || s.includes("::");
  const tokens = [...new Set(s.split(" "))].sort((a, b) => b.length - a.length); // longest first: fails fastest
  return { phrase: s, tokens, tagsOnly, housekeeping, key: `${tagsOnly ? 1 : 0}${housekeeping ? 1 : 0}` };
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);
/** Does `needle` occur at the start of a word inside doc[from, to)? */
function wordStartIn(doc: string, needle: string, from: number, to: number): boolean {
  for (let i = doc.indexOf(needle, from), k = 0; i >= 0 && i < to && k < 8; i = doc.indexOf(needle, i + 1), k++) if (i === from || !isWordChar(doc[i - 1]) || doc[i - 1] === SEP) return true;
  return false;
}

/** 0 when the note doesn't match (every word must appear); otherwise a rank, higher is better:
 *  the phrase starting the front > as a word in the front > anywhere in the front > in the other fields > words spread out > tags only.
 *  A shorter front wins a tie (a card titled exactly "Pneumothorax" beats a long sentence that mentions it). */
export function scoreDoc(doc: string, q: SearchQuery): number {
  const a = doc.indexOf(SEP), b = doc.indexOf(SEP, a + 1), c = doc.indexOf(SEP, b + 1);
  const from = q.tagsOnly ? b + 1 : 0, to = q.housekeeping ? doc.length : c;
  for (const t of q.tokens) { const i = doc.indexOf(t, from); if (i < 0 || i >= to) return 0; }
  const tie = 1 - Math.min(a, 999) / 1000;
  const p = doc.indexOf(q.phrase, from);
  if (p >= 0 && p < to) {
    if (p < a) return (p === 0 ? 1000 : wordStartIn(doc, q.phrase, 0, a) ? 800 : 600) + tie;
    if (p < b) return (wordStartIn(doc, q.phrase, a + 1, b) ? 400 : 300) + tie;
    return 100 + tie;
  }
  let front = 0, body = 0;
  for (const t of q.tokens) { const i = doc.indexOf(t, from); if (i < a) front++; else if (i < b) body++; }
  if (front === q.tokens.length) return 500 + tie;
  if (front + body === q.tokens.length) return 200 + (front / q.tokens.length) * 50 + tie;
  return 50 + tie;
}
