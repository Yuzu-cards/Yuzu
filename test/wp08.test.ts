// WP08: typed answers on vocab cards, Hard on learning steps, MCQ back split.
import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedAnswer, checkTyped, plainField } from "../src/lib/typed";
import { PACK_VOCAB, PACK_BASIC, PACK_MCQ } from "../src/import/pack";
import { rate, previewIntervals, DEFAULT_CONFIG } from "../src/scheduler/fsrs";
import { renderCard } from "../src/lib/render";
import type { Card, Note } from "../src/lib/model";

const vocab = (word: string, meaning: string, article = "", plural = "", example = ""): Note =>
  ({ id: "n", ntid: PACK_VOCAB.id, fields: [word, meaning, `[tts:de-DE:${[article, word].filter(Boolean).join(" ")}]`, "Langenscheidt", article, plural, example, "de-DE"], tags: [], mod: 0 } as unknown as Note);
const verdict = (typed: string, note: Note, ord: number) => checkTyped(typed, expectedAnswer(PACK_VOCAB, note, ord)!);

test("vocab word → meaning: only the Meaning counts (not plural, example or source)", () => {
  const n = vocab("Niere", "kidney", "die", "die Nieren", "Die Niere filtert das Blut.");
  assert.equal(expectedAnswer(PACK_VOCAB, n, 0)!.shown, "kidney");
  assert.deepEqual(verdict("kidney", n, 0), { ok: true });
  assert.deepEqual(verdict("Kidney ", n, 0), { ok: true });
});

test("alternatives split on ; , / before normalising", () => {
  const n = vocab("Schmerzmittel", "painkiller; analgesic", "das");
  assert.deepEqual(verdict("painkiller", n, 0), { ok: true });
  assert.deepEqual(verdict("analgesic", n, 0), { ok: true });
  assert.deepEqual(verdict("painkiller; analgesic", n, 0), { ok: true });
  const h = vocab("Herz", "heart (organ)", "das");
  assert.deepEqual(verdict("heart", h, 0), { ok: true });
});

test("meaning → word: article + word, the word alone, no [tts:…] tag", () => {
  const n = vocab("Schmerzmittel", "painkiller", "das");
  const e = expectedAnswer(PACK_VOCAB, n, 1)!;
  assert.equal(e.shown, "das Schmerzmittel"); assert.ok(!/tts/.test(e.shown));
  assert.deepEqual(verdict("das Schmerzmittel", n, 1), { ok: true });
  assert.deepEqual(verdict("Schmerzmittel", n, 1), { ok: true });
});

test("near misses say what was off", () => {
  const n = vocab("Übelkeit", "nausea", "die");
  assert.deepEqual(verdict("die Ubelkeit", n, 1), { ok: false, near: "check the umlauts / accents" });
  assert.deepEqual(verdict("die Uebelkeit", n, 1), { ok: true }, "ue for ü counts as right");
  assert.deepEqual(verdict("der Übelkeit", n, 1), { ok: false, near: "wrong article — it's die" });
  assert.deepEqual(verdict("die Übelkiet", n, 1).ok, false);
  assert.deepEqual(verdict("die Übelkeiy", n, 1), { ok: false, near: "one letter off — check the spelling" });
  assert.deepEqual(verdict("Leber", n, 1), { ok: false });
  assert.deepEqual(verdict("nausae", n, 0), { ok: false, near: "one letter off — check the spelling" });
});

test("other note types: the first field the back adds", () => {
  const n = { id: "b", ntid: PACK_BASIC.id, fields: ["Herz", "heart [sound:x.mp3]", "", "Source text"], tags: [], mod: 0 } as unknown as Note;
  assert.equal(expectedAnswer(PACK_BASIC, n, 0)!.shown, "heart");
  assert.equal(plainField("a<br>b [tts:de-DE:x] &amp; c"), "a b & c");
});

const fresh = (): Card => ({ id: "c", nid: "n", ord: 0, source: "x", state: "new", step: 0, due: 0, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: 0, suspended: false, flag: 0, mod: 0 } as unknown as Card);
test("Hard on a first learning step is between Again and Good (Anki: average of steps 1 and 2)", () => {
  const T = Date.UTC(2026, 10, 13);
  const h = rate(fresh(), 2, T, DEFAULT_CONFIG);
  assert.equal(h.card.state, "learning"); assert.equal(h.card.step, 0); assert.equal(h.card.due - T, 5.5 * 60000);
  const p = previewIntervals(fresh(), T, DEFAULT_CONFIG);
  assert.notEqual(p[2], p[1], `Again ${p[1]} vs Hard ${p[2]}`);
  // a single relearning step (10m): Hard is 1.5× it
  const lapsed = { ...fresh(), state: "relearning", step: 0, stability: 3, difficulty: 5, reps: 5, lastReview: T - 60000 } as Card;
  assert.equal(rate(lapsed, 2, T, DEFAULT_CONFIG).card.due - T, 15 * 60000);
  // the second learning step repeats on Hard
  const s1 = rate(fresh(), 3, T, DEFAULT_CONFIG).card; assert.equal(rate(s1, 2, T + 600000, DEFAULT_CONFIG).card.due - (T + 600000), 10 * 60000);
});

test("MCQ back: the explanation is rendered separately so it can follow the options", () => {
  const note = { id: "m", ntid: PACK_MCQ.id, fields: ["Q?", "*A\nB", "", "Src", "Because A."], tags: [], mod: 0 } as unknown as Note;
  const r = renderCard({ note, notetype: PACK_MCQ, ord: 0 });
  assert.ok(r.back.includes("Because A."), "the full back keeps it (Library, editor)");
  assert.ok(r.mcqBack && !r.mcqBack.includes("Because A.") && /hr id=answer/.test(r.mcqBack));
  assert.ok(r.mcqTail && r.mcqTail.includes("Because A.") && r.mcqTail.includes("Src"));
});
