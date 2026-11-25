// "The line" of a note: the sentence a card is built on, as plain text. Read aloud on the back, and shown as the previous
// line above the next card of a story. A cloze note's line is its text with every gap filled in; a vocab note's is the
// article and the word (and its example when asked); any other note's is the field named after the deck's language
// ("German", "Deutsch", "Satz"…), else its first field.
import type { Note, Notetype } from "./model";
import { plainField, VOCAB_NT } from "./typed";

/** A cloze text with every gap filled in by its answer ("{{c1::Hund::animal}}" → "Hund"). */
export function fillClozes(s: string): string { return (s ?? "").replace(/\{\{c\d+::([\s\S]*?)(?:::[^}]*)?\}\}/g, "$1"); }

const LANG_FIELD: Record<string, RegExp> = {
  de: /^(german|deutsch|de|wort|satz|sentence|beispiel|example|word|expression|ausdruck)$/i,
  fr: /^(french|français|fr|mot|phrase|word|sentence|expression)$/i,
  es: /^(spanish|español|es|palabra|frase|word|sentence|expression)$/i,
};
/** A field as plain text; inline formatting goes without leaving a gap ("<b>bellt</b>." → "bellt."). */
const plain = (s: string) => plainField((s ?? "").replace(/<\/?(b|i|u|em|strong|span|font|sub|sup|mark|small|a)\b[^>]*>/gi, ""));
const GERMAN = /[äöüßÄÖÜ]|\b(der|die|das|den|dem|des|ein|eine|einen|und|ist|nicht|ich|du|wir|sie|es|mit|auf|zu|im)\b/;
const ANY_LANG = /^(word|sentence|expression|text|phrase|line|zeile)$/i;

export function lineText(note: Note, nt: Notetype | undefined, opts: { lang?: string | null; example?: boolean } = {}): string {
  const f = (name: string) => { const i = nt ? nt.fields.indexOf(name) : -1; return i >= 0 ? plain(note.fields[i] ?? "") : ""; };
  if (nt?.id === VOCAB_NT) {
    const word = [f("Article"), f("Word")].filter(Boolean).join(" ");
    const ex = opts.example ? f("Example") : "";
    return ex ? `${word}. ${ex}` : word;
  }
  if (nt?.kind === "cloze") return plain(fillClozes(note.fields[0] ?? ""));
  const re = LANG_FIELD[(opts.lang ?? "").slice(0, 2).toLowerCase()];
  const names = nt?.fields ?? [];
  let i = re ? names.findIndex((n) => re.test(n.trim())) : -1;
  if (i < 0) i = names.findIndex((n) => ANY_LANG.test(n.trim()));
  // Front/Back with no names: for German, the side that reads German (an English → German card says the back)
  if (i < 0 && /^de/i.test(opts.lang ?? "") && names.length >= 2) { const g = [0, 1].map((k) => GERMAN.test(plain(note.fields[k] ?? ""))); if (g[1] && !g[0]) i = 1; }
  if (i < 0 || !plain(note.fields[i] ?? "")) i = 0;
  return plain(fillClozes(note.fields[i] ?? ""));
}
