// Duplicate review: pairs of similar notes and the merge operation.
import type { Card, Note } from "./model";
import { normalizeText } from "../import/pack";

export const SIMILAR_TAG = "needs-review::similar";

function shingles(s: string): Set<string> { const w = s.split(" "); return new Set(w.length > 1 ? w.slice(1).map((x, i) => w[i] + " " + x) : w); }

/** Pair up notes carrying the similar tag by text overlap (best partner for each). A tagged note also pairs with the
 *  existing note it was found to resemble when it came in (`similarTo`), which carries no tag itself. */
export function similarPairs(notes: Iterable<Note>, dismissed: Set<string> = new Set(), get?: (id: string) => Note | undefined): [string, string, number][] {
  const tagged = [...notes].filter((n) => n.tags.includes(SIMILAR_TAG));
  const at = new Map(tagged.map((n, i) => [n.id, i]));
  for (const n of [...tagged]) { const o = n.similarTo && !at.has(n.similarTo) ? get?.(n.similarTo) : undefined; if (o) { at.set(o.id, tagged.length); tagged.push(o); } }
  const sh = tagged.map((n) => shingles(normalizeText(n.fields.slice(0, 2).join(" "))));
  const pairs: [string, string, number][] = []; const used = new Set<string>();
  const score = (i: number, j: number) => { let k = 0; for (const x of sh[i]) if (sh[j].has(x)) k++; return k / Math.max(1, Math.min(sh[i].size, sh[j].size)); };
  const cand: [number, number, number][] = []; const seen = new Set<string>();
  const add = (i: number, j: number, s: number) => { const k = i < j ? i + "|" + j : j + "|" + i; if (!seen.has(k)) { seen.add(k); cand.push([s, i, j]); } };
  // the recorded partner first: the import already judged them alike (its test is stricter than the 0.4 below)
  for (let i = 0; i < tagged.length; i++) { const p = tagged[i].similarTo; const j = p !== undefined && tagged[i].tags.includes(SIMILAR_TAG) ? at.get(p) : undefined; if (j !== undefined && j !== i) add(i, j, Math.max(0.4, score(i, j))); }
  for (let i = 0; i < tagged.length; i++) { if (!tagged[i].tags.includes(SIMILAR_TAG)) continue; for (let j = i + 1; j < tagged.length; j++) { if (!tagged[j].tags.includes(SIMILAR_TAG)) continue; const s = score(i, j); if (s >= 0.4) add(i, j, s); } }
  cand.sort((a, b) => b[0] - a[0]);
  for (const [s, i, j] of cand) {
    const a = tagged[i].id, b = tagged[j].id; const key = [a, b].sort().join("|");
    if (used.has(a) || used.has(b) || dismissed.has(key)) continue;
    used.add(a); used.add(b); pairs.push([a, b, s]);
  }
  return pairs;
}

/** Scheduling strength of a note = its best card: more reps, then later review. */
export function strength(cards: Card[]): number { return Math.max(0, ...cards.map((c) => c.reps * 1e13 + c.lastReview)); }

/** Merge `drop` into `keep`: union of tags (minus the review tag), stronger scheduling per card ord. Returns the updated keep note and cards. */
export function mergeInto(keep: Note, keepCards: Card[], drop: Note, dropCards: Card[], now: number): { note: Note; cards: Card[] } {
  const tags = [...new Set([...keep.tags, ...drop.tags])].filter((t) => t !== SIMILAR_TAG);
  const cards = keepCards.map((kc) => {
    const dc = dropCards.find((c) => c.ord === kc.ord) ?? dropCards[0];
    if (!dc || strength([dc]) <= strength([kc])) return { ...kc, mod: now };
    const { id, nid, ord, source, ...sched } = dc; void id; void nid; void ord; void source;
    return { ...kc, ...sched, mod: now };
  });
  return { note: { ...keep, tags, modified: now }, cards };
}
