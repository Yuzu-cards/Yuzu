// Cloze gaps, one place for every reader (1.10.0). Besides {{c1::text}} and {{c1::text::hint}}, Anki 26.05's
// {{c1,2,3::text}} (also written {{c1,c2::text}}) hides one piece of text on several cards: card 1, 2 and 3 all ask for it.

/** Every gap: group 1 = the card numbers ("1" or "1,2,3"), group 2 = the answer, group 3 = the hint. */
export const CLOZE_RE = /\{\{c(\d+(?:\s*,\s*c?\d+)*)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
/** "1, c2,3" → [1, 2, 3] */
export function gapNums(spec: string): number[] { return [...new Set(spec.split(",").map((x) => Number(x.trim().replace(/^c/i, ""))).filter((n) => Number.isInteger(n) && n > 0))]; }
/** Does this gap belong to card `n` (1-based)? */
export const gapHas = (spec: string, n: number) => gapNums(spec).includes(n);
/** Every card number the text's gaps make, sorted (1-based). */
export function clozeNumbers(text: string): number[] {
  const s = new Set<number>(); for (const m of (text ?? "").matchAll(CLOZE_RE)) for (const n of gapNums(m[1])) s.add(n);
  return [...s].sort((a, b) => a - b);
}
/** Is there at least one gap? */
export const hasCloze = (text: string) => { CLOZE_RE.lastIndex = 0; const ok = CLOZE_RE.test(text ?? ""); CLOZE_RE.lastIndex = 0; return ok; };
/** Every gap filled in by its answer. */
export function fillClozes(s: string): string { return (s ?? "").replace(CLOZE_RE, "$2"); }
/** Replace each gap: `f(answer, hint, numbers)`. */
export function mapClozes(s: string, f: (answer: string, hint: string | undefined, nums: number[]) => string): string {
  return (s ?? "").replace(CLOZE_RE, (_m, spec, ans, hint) => f(ans, hint, gapNums(spec)));
}
