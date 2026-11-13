// Typed answers on language cards: what the expected answer is, and how close a typed reply came to it.
import type { Note, Notetype } from "./model";
import { latinDigits } from "./num";

export const VOCAB_NT = "yuzu-vocab"; // = VOCAB_ID in import/pack.ts (kept here so this module has no import cycle)
const ARTICLES = ["der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines"];

/** Plain text of a field: no HTML, no [sound:…] or [tts:…] tags. */
export function plainField(s: string): string {
  return (s ?? "").replace(/\[(sound|tts):[^\]]*\]/gi, "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

export interface Expected { /** shown after ✗ / near miss */ shown: string; /** each accepted answer (raw text) */ accept: string[]; /** German noun: the article, so a wrong article can be named */ article?: string; word?: string }

/** The answer a card asks for: Meaning (word → meaning) or Article + Word (meaning → word) on Yuzu vocab cards;
 *  otherwise the first field the back adds that the front did not show. */
export function expectedAnswer(nt: Notetype, note: Note, ord: number): Expected | null {
  const f = (name: string) => plainField(note.fields[nt.fields.indexOf(name)] ?? "");
  if (nt.id === VOCAB_NT) {
    if (ord === 0) { const m = f("Meaning"); return m ? { shown: m, accept: splitAlternatives(m) } : null; }
    const word = f("Word"), article = f("Article"); if (!word) return null;
    const full = [article, word].filter(Boolean).join(" ");
    return { shown: full, accept: [full, word], article: article || undefined, word };
  }
  const t = nt.templates[Math.min(ord, nt.templates.length - 1)]; if (!t) return null;
  const used = (fmt: string) => [...fmt.matchAll(/\{\{([^#/^}][^}]*)\}\}/g)].map((m) => m[1].split(":").pop()!.trim());
  const front = new Set(used(t.qfmt));
  for (const name of used(t.afmt)) {
    if (front.has(name) || name === "FrontSide") continue;
    const v = f(name); if (v) return { shown: v, accept: splitAlternatives(v) };
  }
  return null;
}

/** "painkiller; analgesic", "Herz / Kardia", "heart (organ)" → each alternative (and without the bracket), plus the whole text. */
export function splitAlternatives(raw: string): string[] {
  const parts = raw.split(/[;,/]|\s[-–]\s/).map((x) => x.trim()).filter(Boolean);
  const bare = parts.map((x) => x.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  return [...new Set([raw, ...parts, ...bare])];
}

export const normAnswer = (x: string) => latinDigits(x).toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const fold = (x: string) => normAnswer(x).replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss").normalize("NFD").replace(/\p{M}/gu, "");
const stripArticle = (x: string) => { const w = normAnswer(x).split(" "); return w.length > 1 && ARTICLES.includes(w[0]) ? w.slice(1).join(" ") : w.join(" "); };

/** Edit distance with swapped neighbours counting as one edit (optimal string alignment); 9 when clearly apart. */
function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

export type TypedVerdict = { ok: true } | { ok: false; near?: string };

/** Right, a near miss (says what was off), or wrong. */
export function checkTyped(typed: string, exp: Expected): TypedVerdict {
  const t = normAnswer(typed); if (!t) return { ok: false };
  const acc = exp.accept.map(normAnswer).filter(Boolean);
  if (acc.includes(t)) return { ok: true };
  // ae / oe / ue / ss typed for ä / ö / ü / ß (no German keyboard) count as right
  const spelled = (a: string) => new RegExp("^" + a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ä/g, "(ä|ae)").replace(/ö/g, "(ö|oe)").replace(/ü/g, "(ü|ue)").replace(/ß/g, "(ß|ss)") + "$", "u");
  if (acc.some((a) => /[äöüß]/.test(a) && spelled(a).test(t))) return { ok: true };
  // German noun with the wrong article: the word itself is right
  if (exp.article && exp.word) {
    const w = normAnswer(exp.word), parts = t.split(" ");
    if (parts.length > 1 && ARTICLES.includes(parts[0]) && parts.slice(1).join(" ") === w && parts[0] !== normAnswer(exp.article)) return { ok: false, near: `wrong article — it's ${exp.article}` };
  }
  const ft = fold(stripArticle(typed));
  for (const a of exp.accept) {
    const fa = fold(stripArticle(a)); if (!fa) continue;
    if (ft === fa) return { ok: false, near: "check the umlauts / accents" };
    if (fa.length >= 4 && lev(ft, fa) === 1) return { ok: false, near: "one letter off — check the spelling" };
  }
  return { ok: false };
}
