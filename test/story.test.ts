// 1.9.0, decks built in sequence (a story, a course): per-deck options, strict order for new cards, a per-deck new-card
// cap, the previous line, a pack's line numbers / look / fonts, story lines that repeat, the dictionary from your vocab cards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/lib/store.ts";
import type { Card, Note } from "../src/lib/model.ts";
import { resolveOpts, compareLines, renameKeys, langFromPath, deckLang, cleanDeckOpts } from "../src/lib/deckopts.ts";
import { parsePack, summarizePack } from "../src/import/pack.ts";
import { buildLexicon, lookup, normWord, candidates } from "../src/lib/lexicon.ts";
import { lineText, fillClozes } from "../src/lib/line.ts";
import { mergeSettings, stampChanges, sanitizeSettings } from "../src/lib/settingsync.ts";
import { DEFAULT_SETTINGS } from "../src/lib/store.ts";

const BASIC = { id: "t", name: "Basic", kind: "standard", fields: ["Front", "Back"], templates: [], css: "" } as any;
const CLOZE = { id: "yuzu-cloze", name: "Yuzu Cloze", kind: "cloze", fields: ["Text", "Extra", "Image", "Source"], templates: [], css: "" } as any;
const VOCAB = { id: "yuzu-vocab", name: "Yuzu Vocab", kind: "standard", fields: ["Word", "Meaning", "Audio", "Source", "Article", "Plural", "Example", "Lang"], templates: [], css: "" } as any;

function store() {
  const s = new Store(); (s as any).touch = () => {}; (s as any).persist = async (_w: string, p: Promise<unknown>) => p.catch(() => undefined);
  for (const nt of [BASIC, CLOZE, VOCAB]) s.notetypes.set(nt.id, nt);
  s.settings = { ...s.settings, newPerDay: 50, burySiblings: true };
  s.loaded = true; return s;
}
let k = 0;
function add(s: Store, deck: string, opts: { created: number; seq?: number; ords?: number[]; text?: string; ntid?: string; fields?: string[]; due?: number }) {
  const nid = "n" + ++k;
  s.notes.set(nid, { id: nid, ntid: opts.ntid ?? "yuzu-cloze", guid: nid, fields: opts.fields ?? [opts.text ?? `line ${k} {{c1::x}}`, "", "", ""], tags: [], created: opts.created, modified: 1, ...(opts.seq !== undefined ? { seq: opts.seq } : {}) } as Note);
  for (const ord of opts.ords ?? [0]) s.cards.set(`${nid}-${ord}`, { id: `${nid}-${ord}`, nid, ord, state: "new", suspended: false, flag: 0, due: opts.due ?? opts.created, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: 0, step: 0, created: opts.due ?? opts.created, mod: 0, source: deck } as Card);
  return nid;
}
const ids = (cards: Card[]) => cards.map((c) => c.nid);

test("options: the deepest deck that sets an option wins, option by option", () => {
  const map = { "Lang": { lang: "de-DE", ordered: false }, "Lang::Story": { ordered: true }, "Lang::Story::Part 2": { prevLine: true } } as any;
  const r = resolveOpts(map, "Lang::Story::Part 2::Scene");
  assert.deepEqual(r.opts, { prevLine: true, ordered: true, lang: "de-DE" });
  assert.equal(r.at.ordered, "Lang::Story"); assert.equal(r.at.lang, "Lang");
  assert.equal(resolveOpts({ ...map, "Lang::Story": null }, "Lang::Story::X").opts.ordered, false, "a cleared deck falls back to the one above");
});

test("options: garbage from another device or a backup is dropped, removals (null) are kept", () => {
  const c = cleanDeckOpts({ "A": { ordered: "yes", newPerDay: -4, look: "neon", lang: "<script>", readAloud: "auto", tapWord: false }, "B": null, "C": 5 });
  assert.deepEqual(c, { A: { newPerDay: 0, readAloud: "auto", tapWord: false }, B: null });
});

test("language from a deck's name", () => {
  assert.equal(langFromPath("Languages::German::Goethe A1"), "de-DE");
  assert.equal(langFromPath("Mephisto"), "de-DE");
  assert.equal(langFromPath("Medicine::Cardiology"), null);
  assert.equal(deckLang({ "Mephisto": { lang: "off" } }, "Mephisto::Act 1"), null, "turned off");
  assert.equal(deckLang({ "Medicine::Words": { lang: "fr-FR" } }, "Medicine::Words::A"), "fr-FR");
});

test("strict order: new cards come in line order, not import order, and the deck isn't split between its subdecks", () => {
  const s = store(); k = 0;
  // imported in a muddle: part 2 first, line 3 last, with a few cards with an early "due" from an Anki position
  const l4 = add(s, "Story::Part 2", { created: 100, seq: 4 }); const l5 = add(s, "Story::Part 2", { created: 101, seq: 5 });
  const l1 = add(s, "Story::Part 1", { created: 200, seq: 1, due: 999 }); const l2 = add(s, "Story::Part 1", { created: 201, seq: 2 });
  const l3 = add(s, "Story::Part 1", { created: 300, seq: 3, due: 1 });
  // without the option: round-robin and due order
  const before = ids(s.queue("Story"));
  assert.notDeepEqual(before, [l1, l2, l3, l4, l5]);
  s.settings = { ...s.settings, deckOpts: { Story: { ordered: true } } };
  assert.deepEqual(ids(s.queue("Story")), [l1, l2, l3, l4, l5]);
  assert.deepEqual(ids(s.queue("")), [l1, l2, l3, l4, l5], "the same from Today (the whole collection)");
});

test("strict order: Anki notes without line numbers go by when they were made; a note's cards stay together, siblings wait a day", () => {
  const s = store(); k = 0; s.settings = { ...s.settings, deckOpts: { "Goethe": { ordered: true } } };
  const b = add(s, "Goethe::Kapitel 2", { created: 20, ords: [0, 1] }); const a = add(s, "Goethe::Kapitel 1", { created: 10, ords: [0, 1] }); const c = add(s, "Goethe::Kapitel 1", { created: 30 });
  assert.deepEqual(s.queue("Goethe").map((x) => x.id), [`${a}-0`, `${b}-0`, `${c}-0`], "bury siblings: one card per note a day, the next line takes its place");
  s.settings = { ...s.settings, burySiblings: false };
  assert.deepEqual(s.queue("Goethe").map((x) => x.id), [`${a}-0`, `${a}-1`, `${b}-0`, `${b}-1`, `${c}-0`]);
  assert.equal(compareLines({ seq: 5, created: 9e12 } as any, { created: 1 } as any) < 0, true, "a numbered line before an unnumbered one");
});

test("strict order: an ordered deck is one stream that takes its turn with the other decks", () => {
  const s = store(); k = 0; s.settings = { ...s.settings, newPerDay: 4, deckOpts: { "Story": { ordered: true } } };
  const st = [1, 2, 3, 4].map((i) => add(s, "Story::Part " + i, { created: i * 10, seq: i }));
  const med = [1, 2, 3, 4].map((i) => add(s, "Medicine::Cardio", { created: i }));
  const q = ids(s.queue(""));
  assert.equal(q.length, 4); assert.deepEqual(q.filter((n) => st.includes(n)), st.slice(0, 2)); assert.deepEqual(q.filter((n) => med.includes(n)), med.slice(0, 2));
});

test("a deck's new-card cap: holds for it and everything under it, counts today's new cards, inside the overall limit", () => {
  const s = store(); k = 0; s.settings = { ...s.settings, newPerDay: 20, deckOpts: { "Story": { ordered: true, newPerDay: 3 }, "Story::Part 2": { newPerDay: 1 } } };
  const p1 = [1, 2].map((i) => add(s, "Story::Part 1", { created: i, seq: i })); const p2 = [3, 4, 5].map((i) => add(s, "Story::Part 2", { created: i, seq: i }));
  const other = add(s, "Medicine", { created: 1 });
  const q = ids(s.queue(""));
  assert.deepEqual(q.filter((n) => n !== other), [p1[0], p1[1], p2[0]], "3 from Story, only 1 of them from Part 2");
  assert.ok(q.includes(other), "other decks are not held back");
  // one new Story card seen today: 2 left
  const now = Date.now(); s.reviews.push({ id: "r1", cid: p1[0] + "-0", ts: now - 1000, rating: 3, state: "new", elapsedDays: 0, scheduledDays: 0, durationMs: 1000 });
  s.cards.set(p1[0] + "-0", { ...s.cards.get(p1[0] + "-0")!, state: "learning", due: now + 600000 });
  assert.deepEqual(ids(s.queue("Story")), [p1[1], p2[0]]);
  assert.equal(s.capsLeft().get("Story"), 2);
});

test("the line's place and the previous line: the note before in line order, never a sibling card", () => {
  const s = store(); k = 0; s.settings = { ...s.settings, deckOpts: { "Story": { ordered: true, prevLine: true } } };
  const a = add(s, "Story", { created: 3, seq: 1, text: "Es war {{c1::einmal}} ein König.", ords: [0, 1] }); const b = add(s, "Story", { created: 1, seq: 2, text: "Er hatte {{c1::drei}} Töchter." });
  const info = s.lineOf(s.cards.get(b + "-0")!)!;
  assert.equal(info.n, 2); assert.equal(info.total, 2); assert.equal(info.prev?.id, a);
  assert.equal(lineText(info.prev!, CLOZE), "Es war einmal ein König.", "gaps filled");
  assert.equal(s.lineOf(s.cards.get(a + "-1")!)!.prev, null, "the first line has none (its own sibling is not 'the line before')");
  s.settings = { ...s.settings, deckOpts: { "Story": { ordered: true } } };
  assert.equal(s.lineOf(s.cards.get(b + "-0")!)!.prev, null, "off unless the deck asks for it");
  assert.deepEqual(s.lineProgress("Story"), { started: 0, total: 2, next: 1 });
});

test("order subdeck by subdeck (like Anki's deck order), several lines before, the line number switch", () => {
  const s = store(); k = 0; s.settings = { ...s.settings, burySiblings: false, deckOpts: { "Goethe": { ordered: true, orderBy: "subdeck", prevLine: true, prevLines: 2, lineNo: false } } };
  const k10 = add(s, "Goethe::Kapitel 10", { created: 1 }); const k2b = add(s, "Goethe::Kapitel 2", { created: 30 }); const k2a = add(s, "Goethe::Kapitel 2", { created: 20 }); const k1 = add(s, "Goethe::kapitel 1", { created: 40 });
  assert.deepEqual(ids(s.queue("Goethe")), [k1, k2a, k2b, k10], "Kapitel 1, 2, 10 (numbers read as numbers, case ignored), lines in order inside");
  const info = s.lineOf(s.cards.get(k2b + "-0")!)!;
  assert.deepEqual(info.prevs.map((n) => n.id), [k1, k2a]); assert.equal(info.showNo, false); assert.equal(info.n, 3);
  s.settings = { ...s.settings, deckOpts: { "Goethe": { ordered: true } } };
  assert.deepEqual(ids(s.queue("Goethe")), [k10, k2a, k2b, k1], "by line (when made) across the deck");
  assert.equal(s.lineOf(s.cards.get(k1 + "-0")!)!.n, 4, "the cached order follows the switch");
  assert.deepEqual(cleanDeckOpts({ A: { prevLines: 9, orderBy: "x", readPace: "slow", lineNo: false } }), { A: { prevLines: 3, readPace: "slow", lineNo: false } });
});

test("a renamed deck keeps its options; the old place is cleared (null) so the move syncs", () => {
  assert.deepEqual(renameKeys({ "A::B": { ordered: true }, "A::B::C": { prevLine: true }, "X": { lang: "de-DE" } } as any, "A::B", "Z"), { "A::B": null, "A::B::C": null, "Z": { ordered: true }, "Z::C": { prevLine: true }, "X": { lang: "de-DE" } });
  assert.equal(renameKeys({ X: {} } as any, "A", "B"), null, "nothing to move");
});

test("deck options sync deck by deck: one deck changed on the phone, another on the tablet, both survive", () => {
  const base = sanitizeSettings({ ...DEFAULT_SETTINGS, deckOpts: { A: { ordered: true }, B: { lang: "de-DE" } } } as any, DEFAULT_SETTINGS);
  const t0 = stampChanges({ ...DEFAULT_SETTINGS } as any, base, 1000);
  const phone = stampChanges(t0, { ...t0, deckOpts: { ...t0.deckOpts, A: { ordered: false } } }, 2000);
  const tablet = stampChanges(t0, { ...t0, deckOpts: { ...t0.deckOpts, B: { lang: "fr-FR" }, C: { prevLine: true } } }, 3000);
  const m = mergeSettings(phone, tablet).settings as any;
  assert.deepEqual(m.deckOpts, { A: { ordered: false }, B: { lang: "fr-FR" }, C: { prevLine: true } });
});

test("pack: ordered gives line numbers, seqStart continues a part 2, a card's own seq wins", () => {
  const r = parsePack({ yuzu_pack: 1, id: "s1", category: "Mephisto", ordered: true, cards: [{ id: "a", text: "Eins {{c1::zwei}}" }, { id: "b", text: "Drei {{c1::vier}}" }] }, []);
  assert.deepEqual(r.notes.map((n) => n.seq), [1, 2]);
  assert.deepEqual(r.deck?.hints, { ordered: true });
  const r2 = parsePack({ yuzu_pack: 1, id: "s2", category: "Mephisto", seqStart: 101, cards: [{ id: "a", text: "Fünf {{c1::sechs}}" }, { id: "b", seq: 7, text: "Sieben {{c1::acht}}" }] }, []);
  assert.deepEqual(r2.notes.map((n) => n.seq), [101, 7]);
  assert.equal(parsePack({ yuzu_pack: 1, cards: [{ text: "Plain {{c1::card}}" }] }, []).notes[0].seq, undefined, "packs without order are unchanged");
});

test("pack: a story's repeated line is kept (with its id, in an ordered pack); without ids it is still a duplicate", () => {
  const story = { yuzu_pack: 1, id: "st", category: "Story", ordered: true, cards: [{ id: "1", text: "{{c1::Ja}}." }, { id: "2", text: "Wirklich {{c1::nicht}}?" }, { id: "3", text: "{{c1::Ja}}." }] };
  const existing = [{ id: "x", ntid: "yuzu-cloze", guid: "x", fields: ["{{c1::Ja}}.", "", "", ""], tags: [], created: 1, modified: 1 } as Note];
  const r = parsePack(story, existing);
  assert.equal(r.notes.length, 3, "all three lines, even though one is already in another deck");
  assert.equal(r.duplicates, 0); assert.equal(r.similar, 0, "lines of a story are not flagged as similar to each other");
  const plain = parsePack({ yuzu_pack: 1, cards: [{ text: "{{c1::Ja}}." }, { text: "{{c1::Ja}}." }] }, []);
  assert.equal(plain.notes.length, 1); assert.equal(plain.duplicates, 1);
});

test("pack: a line put in later moves the lines after it, without touching their reviews", () => {
  const v1 = { yuzu_pack: 1, id: "st", category: "Story", ordered: true, cards: [{ id: "a", text: "A {{c1::a}}" }, { id: "c", text: "C {{c1::c}}" }] };
  const r1 = parsePack(v1, []);
  const v2 = { ...v1, cards: [{ id: "a", text: "A {{c1::a}}" }, { id: "b", text: "B {{c1::b}}" }, { id: "c", text: "C {{c1::c}}" }] };
  const r2 = parsePack(v2, r1.notes);
  const byText = new Map(r2.notes.map((n) => [n.fields[0], n]));
  assert.equal(byText.get("B {{c1::b}}")?.seq, 2); assert.equal(byText.get("C {{c1::c}}")?.seq, 3);
  assert.equal(r2.unchanged, 1); assert.equal(r2.reordered.length, 1);
  assert.equal(r2.cards.filter((c) => c.nid === byText.get("C {{c1::c}}")!.id).length, 0, "the moved line keeps its cards (none made again)");
  const sum = summarizePack(r2); assert.equal(sum.added, 1); assert.match(sum.message, /1 moved to its new place/);
});

test("pack: the deck's look — CSS once for the deck, fonts stored as media and named in the CSS; bad fonts reported", () => {
  const font = "data:font/woff2;base64," + Buffer.from("wOF2-fake-font").toString("base64");
  const r = parsePack({ yuzu_pack: 1, id: "bassiet", category: "Bassiet", style: { css: "@font-face{font-family:B;src:url('bassiet.woff2')} .card{font-family:B}", fonts: { "bassiet.woff2": font, "x.exe": "data:application/x-msdownload;base64,AAAA" } }, cards: [{ front: "Q", back: "A" }] }, []);
  const f = r.media.find((m) => m.name.startsWith("_font-"));
  assert.ok(f && f.name.endsWith(".woff2"));
  assert.equal(r.deck?.style?.css, `@font-face{font-family:B;src:url("${f!.name}")} .card{font-family:B}`);
  assert.match(r.warnings.join(" "), /1 font could not be read/);
  assert.equal(r.notes[0].fields.join("").includes("font"), false, "nothing repeated in the cards");
});

test("the pack's suggestions never override what the person set", async () => {
  const s = store(); (s as any).saveSettings = async (patch: any) => { s.settings = { ...s.settings, ...patch }; };
  s.settings = { ...s.settings, deckOpts: { "Mephisto": { ordered: false } } };
  await (s as any).applyPackDeck({ path: "Mephisto", hints: { ordered: true, prevLine: true, lang: "de-DE" }, style: { css: ".card{color:red}" } }, "meph", { message: "1 card added" });
  assert.deepEqual(s.settings.deckOpts.Mephisto, { ordered: false, prevLine: true, lang: "de-DE" });
  assert.equal(s.settings.deckStyles.Mephisto?.css, ".card{color:red}");
  assert.equal(s.lookFor("Mephisto").own, false, "the look is stored but not switched on: Yuzu decks read alike unless asked");
  s.settings = { ...s.settings, deckOpts: { "Mephisto": { look: "own" } } };
  assert.deepEqual([s.lookFor("Mephisto::Act 1").own, s.lookFor("Mephisto::Act 1").css], [true, ".card{color:red}"]);
  s.settings = { ...s.settings, cardStyle: "deck", deckOpts: { "Mephisto": { look: "yuzu" } } };
  assert.equal(s.lookFor("Mephisto").own, false, "a deck set to the Yuzu style keeps it on a device that shows decks' own looks");
});

test("your own dictionary: vocab cards, plurals, endings, articles, umlauts; medical two-sided cards are left out", () => {
  const notes: Note[] = [
    { id: "v1", ntid: "yuzu-vocab", guid: "v1", fields: ["Hund", "dog", "", "", "der", "Hunde", "", "de-DE"], tags: [], created: 1, modified: 1 },
    { id: "v2", ntid: "yuzu-vocab", guid: "v2", fields: ["gehen", "to go", "", "", "", "", "", "de-DE"], tags: [], created: 1, modified: 1 },
    { id: "v3", ntid: "yuzu-vocab", guid: "v3", fields: ["Übelkeit", "nausea", "", "", "die", "", "", "de-DE"], tags: [], created: 1, modified: 1 },
    { id: "b1", ntid: "t", guid: "b1", fields: ["the cat", "die Katze"], tags: [], created: 1, modified: 1 },
    { id: "m1", ntid: "t", guid: "m1", fields: ["Troponin", "cardiac marker"], tags: [], created: 1, modified: 1 },
  ];
  const deck: Record<string, string> = { v1: "Languages::German::Goethe A1", v2: "Languages::German::Goethe A1", v3: "Medizin Wortschatz", b1: "Languages::German::Basics", m1: "Medicine::Cardio" };
  const lex = buildLexicon(notes, (id) => ({ "yuzu-vocab": VOCAB, t: BASIC } as any)[id], (nid) => deckLang({}, deck[nid]), (nid) => deck[nid]);
  assert.equal(lookup(lex, "Hund")[0]?.meaning, "dog"); assert.equal(lookup(lex, "Hunden")[0]?.meaning, "dog"); assert.equal(lookup(lex, "Hunde")[0]?.word, "der Hund");
  assert.equal(lookup(lex, "geht")[0]?.meaning, "to go"); assert.equal(lookup(lex, "Ubelkeit")[0]?.meaning, "nausea");
  assert.equal(lookup(lex, "Katze")[0]?.meaning, "the cat", "an unnamed Front/Back is looked up both ways");
  assert.equal(lookup(lex, "Troponin").length, 0, "not from a medical deck");
  assert.equal(lookup(lex, "Hund", { not: "v1" }).length, 0, "the card you're on is not its own answer");
  assert.equal(normWord("der Hund, -e"), "hund"); assert.ok(candidates("Katzen").includes("katze"));
});

test("the line: cloze filled, vocab with its article and example, other notes by the language's field", () => {
  assert.equal(fillClozes("Ich {{c1::gehe::verb}} nach {{c2::Hause}}."), "Ich gehe nach Hause.");
  const v = { id: "v", ntid: "yuzu-vocab", fields: ["Hund", "dog", "[tts:de-DE:der Hund]", "", "der", "Hunde", "Der Hund <b>bellt</b>.", "de-DE"] } as any;
  assert.equal(lineText(v, VOCAB, { example: true }), "der Hund. Der Hund bellt.");
  const g = { id: "g", ntid: "g", fields: ["the doctor", "der Arzt [sound:arzt.mp3]"] } as any;
  assert.equal(lineText(g, { id: "g", kind: "standard", fields: ["English", "German"] } as any, { lang: "de-DE" }), "der Arzt");
  assert.equal(lineText(g, BASIC, { lang: "de-DE" }), "der Arzt", "Front/Back: the German side");
  assert.equal(lineText({ fields: ["Wie geht es dir?", "How are you?"] } as any, BASIC, { lang: "de-DE" }), "Wie geht es dir?");
});
