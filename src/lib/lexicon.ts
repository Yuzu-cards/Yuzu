// Your own dictionary (1.9.0): every word your vocab cards teach, so a word tapped on any German card shows the meaning
// you learned it with. Sources: Yuzu Vocab notes (Word, Plural → Meaning), and two-sided notes in language decks whose
// word side is short (a field named German/Deutsch/Wort… against English/Meaning/Bedeutung…, or Front/Back both ways).
// Built only when first needed and kept until a note changes. Words are matched without articles, case or umlaut
// differences, and a few common German endings ("Hunden" finds "Hund", "geht" finds "gehen").
import type { Note, Notetype } from "./model";
import { plainField, VOCAB_NT } from "./typed";

export interface Entry { nid: string; word: string; meaning: string; deck: string; vocab: boolean }
export type Lexicon = Map<string, Entry[]>;

const ARTICLES = /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|sich|zu|to|the|a|an|le|la|les|l'|el|los|las|un|une)\s+/i;
/** The key a word is filed under: lower case, umlauts folded, no article, nothing after a comma or bracket ("der Hund, -e" → "hund"). */
export function normWord(s: string): string {
  let t = (s ?? "").replace(/[(\[,;/|].*$/s, "").trim().toLowerCase();
  for (let k = 0; k < 2; k++) t = t.replace(ARTICLES, "");
  return t.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss").replace(/[^\p{L}\p{N}\s'-]/gu, "").replace(/\s+/g, " ").trim();
}
const ENDINGS = ["ten", "test", "tet", "en", "em", "er", "es", "st", "et", "te", "n", "s", "e", "t"];
/** The keys to try for a word as it appears in a sentence, most likely first. */
export function candidates(word: string): string[] {
  const n = normWord(word); if (!n) return [];
  const out = [n];
  const add = (b: string) => { if (b.length >= 3) for (const x of [b, b + "en", b + "n", b + "e"]) if (!out.includes(x)) out.push(x); };
  for (const e of ENDINGS) if (n.endsWith(e) && n.length - e.length >= 3) add(n.slice(0, -e.length));
  if (n.startsWith("ge") && n.length > 5) { const p = n.slice(2); add(p.replace(/(t|en)$/, "")); }
  return out;
}

const WORD_FIELD = /^(german|deutsch|de|wort|word|vokabel|ausdruck|expression|french|français|spanish|español|target)$/i;
const MEANING_FIELD = /^(english|en|meaning|bedeutung|translation|übersetzung|ubersetzung|definition|englisch)$/i;
const short = (s: string, words = 4, chars = 40) => !!s && s.length <= chars && s.split(" ").length <= words;

/**
 * Build the dictionary. `langOf(nid)`: the language of the deck a note's cards are in (null: not a language deck), so
 * medical two-sided cards never turn into "meanings". `deckOf(nid)`: where the note lives, shown with the meaning.
 */
export function buildLexicon(notes: Iterable<Note>, notetype: (id: string) => Notetype | undefined, langOf: (nid: string) => string | null, deckOf: (nid: string) => string): Lexicon {
  const lex: Lexicon = new Map(); for (const n of notes) addToLexicon(lex, n, notetype, langOf, deckOf); return lex;
}
/** File one note's word(s) (the dictionary can be built a slice at a time, see Store.warmLexicon). */
export function addToLexicon(lex: Lexicon, n: Note, notetype: (id: string) => Notetype | undefined, langOf: (nid: string) => string | null, deckOf: (nid: string) => string): void {
  const put = (key: string, e: Entry) => { if (!key || key.length < 2) return; const l = lex.get(key); if (!l) lex.set(key, [e]); else if (l.length < 6 && !l.some((x) => x.nid === e.nid)) l.push(e); };
  {
    const nt = notetype(n.ntid); if (!nt || nt.kind === "cloze") return;
    const fv = (i: number) => (i >= 0 ? plainField(n.fields[i] ?? "") : "");
    if (nt.id === VOCAB_NT) {
      const at = (name: string) => nt.fields.indexOf(name);
      const word = fv(at("Word")), meaning = fv(at("Meaning")), art = fv(at("Article")), pl = fv(at("Plural"));
      if (!word || !meaning) return;
      const e: Entry = { nid: n.id, word: [art, word].filter(Boolean).join(" "), meaning, deck: deckOf(n.id), vocab: true };
      put(normWord(word), e); if (pl) put(normWord(pl.replace(/^-/, word)), e);
      return;
    }
    if (n.fields.length < 2 || !langOf(n.id)) return;
    const names = nt.fields.map((x) => x.trim());
    let wi = names.findIndex((x) => WORD_FIELD.test(x)), mi = names.findIndex((x) => MEANING_FIELD.test(x));
    const named = wi >= 0 && mi >= 0 && wi !== mi;
    if (!named) { wi = 0; mi = 1; }
    const a = fv(wi), b = fv(mi); if (!a || !b) return;
    const deck = deckOf(n.id);
    if (short(a) && b.length <= 120) { const k = normWord(a); if (k.split(" ").length === 1 || named) put(k, { nid: n.id, word: a, meaning: b, deck, vocab: false }); }
    // Front/Back with no names: either side may be the foreign one, so the short back finds the front too
    if (!named && short(b) && a.length <= 120) { const k = normWord(b); if (k.split(" ").length === 1) put(k, { nid: n.id, word: b, meaning: a, deck, vocab: false }); }
  }
}

/** The best entries for a tapped word: exact before an ending taken off, vocab cards first, then cards from `near` (the deck you're in). */
export function lookup(lex: Lexicon, word: string, opts: { near?: string; not?: string } = {}): Entry[] {
  const top = (p: string) => p.split("::").slice(0, 2).join("::");
  for (const k of candidates(word)) {
    const l = (lex.get(k) ?? []).filter((e) => e.nid !== opts.not);
    if (!l.length) continue;
    return [...l].sort((x, y) => Number(y.vocab) - Number(x.vocab) || Number(!!opts.near && top(y.deck) === top(opts.near)) - Number(!!opts.near && top(x.deck) === top(opts.near)) || x.meaning.length - y.meaning.length);
  }
  return [];
}
