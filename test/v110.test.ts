// 1.10.0: Anki's bulk tools (Find & Replace, Set due date, Reset), practice without scheduling, priority and field order
// for decks, read-and-make, best hours, subject designs (which deck gets which; the Mephisto deck never).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store, replaceText, DEFAULT_SETTINGS } from "../src/lib/store.ts";
import type { Card, Note } from "../src/lib/model.ts";
import { splitLines, tokens, clozeLine, readPack } from "../src/lib/readmake.ts";
import { hourStats } from "../src/lib/hours.ts";
import { deckTheme, artFor, THEME_COLORS } from "../src/ui/subjectart.ts";
import { sanitizeSettings } from "../src/lib/settingsync.ts";
import { parsePack } from "../src/import/pack.ts";

const DAY = 86400000;
function store() {
  const s = new Store(); (s as any).touch = () => {}; (s as any).persist = async (_w: string, p: Promise<unknown>) => p.catch(() => undefined);
  s.notetypes.set("t", { id: "t", name: "Basic", kind: "standard", fields: ["Front", "Back", "Nr"], templates: [], css: "" } as any);
  s.settings = { ...s.settings, newPerDay: 50, burySiblings: false }; s.loaded = true; return s;
}
let k = 0;
function add(s: Store, deck: string, o: { fields?: string[]; created?: number; state?: Card["state"]; due?: number; stability?: number; lastReview?: number } = {}) {
  const nid = "n" + ++k; s.notes.set(nid, { id: nid, ntid: "t", guid: nid, fields: o.fields ?? [`front ${k}`, `back ${k}`, ""], tags: [], created: o.created ?? k, modified: 1 } as Note);
  const st = o.state ?? "new"; s.cards.set(nid + "-0", { id: nid + "-0", nid, ord: 0, state: st, suspended: false, flag: 0, due: o.due ?? k, stability: o.stability ?? (st === "new" ? 0 : 10), difficulty: 5, reps: st === "new" ? 0 : 3, lapses: 0, lastReview: o.lastReview ?? (st === "new" ? 0 : Date.now() - 5 * DAY), step: 0, created: k, mod: 1, source: deck } as Card);
  return nid;
}

test("replaceText: only the text — never inside tags, sound names or gap markers; $1 works with a pattern", () => {
  const html = `<img src="heart.png"> Das Herz {{c1::schlägt::verb}} [sound:herz.mp3] <b class="herz">Herz</b>`;
  const r = replaceText(html, /herz/giu, "Lunge");
  assert.equal(r.text, `<img src="heart.png"> Das Lunge {{c1::schlägt::verb}} [sound:herz.mp3] <b class="herz">Lunge</b>`); assert.equal(r.count, 2);
  assert.equal(replaceText("10 mg und 20 mg", /(\d+) mg/gu, "$1 mg/kg").text, "10 mg/kg und 20 mg/kg");
  assert.equal(replaceText("x", /x/gu, null).count, 1);
});

test("Find & Replace across notes: count first, then replace in one field or all, synced per field, one Undo", async () => {
  const s = store(); k = 0; const a = add(s, "D", { fields: ["Aspirin 75 mg", "aspirin blocks COX", ""] }); const b = add(s, "D", { fields: ["Paracetamol", "none", ""] });
  assert.deepEqual(s.findMatches([a, b], "aspirin"), { notes: 1, places: 2 });
  assert.deepEqual(s.findMatches([a, b], "aspirin", { caseSensitive: true }), { notes: 1, places: 1 });
  assert.deepEqual(s.findMatches([a, b], "aspirin", { field: "Back" }), { notes: 1, places: 1 });
  assert.deepEqual(s.findMatches([a], "[", { regex: true }), { notes: 0, places: 0 }, "a broken pattern finds nothing (and doesn't throw)");
  assert.equal(await s.findReplace([a, b], "aspirin", "ASS", { field: "Back" }), 1);
  assert.deepEqual(s.notes.get(a)!.fields.slice(0, 2), ["Aspirin 75 mg", "ASS blocks COX"]);
  assert.ok(s.notes.get(a)!.pm?.f?.[1][0]! > 1 && s.notes.get(a)!.edited, "the field carries its own change stamp, so sync keeps it");
  await s.undoBulkEdit(); assert.equal(s.notes.get(a)!.fields[1], "aspirin blocks COX");
});

test("Set due date: review cards come back on the chosen day (spread over a range); new cards stay new; Undo", async () => {
  const s = store(); k = 0; const r1 = add(s, "D", { state: "review", due: Date.now() + 40 * DAY }); const r2 = add(s, "D", { state: "learning", due: Date.now() + DAY }); const n1 = add(s, "D");
  const now = Date.now(); const res = await s.setDueDays([r1 + "-0", r2 + "-0", n1 + "-0"], 0);
  assert.deepEqual(res, { changed: 2, skippedNew: 1 });
  assert.ok(s.cards.get(r1 + "-0")!.due <= now + 1000 && s.queue("D").some((c) => c.id === r1 + "-0"), "due today: in today's queue");
  assert.equal(s.cards.get(r2 + "-0")!.state, "review", "a learning card set to a day becomes a review card");
  assert.equal(s.cards.get(n1 + "-0")!.state, "new");
  await s.setDueDays([r1 + "-0"], 3, 7); const d = (s.cards.get(r1 + "-0")!.due - s.dayStart(now)) / DAY; assert.ok(d >= 3 && d < 8, String(d));
  await s.undoBulkEdit(); assert.ok(s.cards.get(r1 + "-0")!.due <= now + 1000, "undo goes back one step");
  assert.ok(s.cards.get(r1 + "-0")!.pm?.s, "the schedule part is stamped (syncs as a schedule change)");
});

test("Reset to new: memory cleared, review history and counts kept, Undo puts it back", async () => {
  const s = store(); k = 0; const r = add(s, "D", { state: "review", stability: 40 }); s.reviews.push({ id: "x", cid: r + "-0", ts: Date.now() - DAY, rating: 3, state: "review", elapsedDays: 1, scheduledDays: 4, durationMs: 1 });
  assert.equal(await s.resetCards([r + "-0"]), 1);
  const c = s.cards.get(r + "-0")!; assert.equal(c.state, "new"); assert.equal(c.stability, 0); assert.equal(c.reps, 3); assert.equal(s.reviews.length, 1);
  await s.undoBulkEdit(); assert.equal(s.cards.get(r + "-0")!.state, "review"); assert.equal(s.cards.get(r + "-0")!.stability, 40);
});

test("practice cards: shakiest first, new previewed in deck order, paused left out — nothing in the store changes", () => {
  const s = store(); k = 0; const now = Date.now();
  const weak = add(s, "P", { state: "review", stability: 1, lastReview: now - 20 * DAY }); const strong = add(s, "P", { state: "review", stability: 300, lastReview: now - DAY });
  const n2 = add(s, "P", { created: 20 }); const n1 = add(s, "P", { created: 10 }); const paused = add(s, "P"); s.cards.set(paused + "-0", { ...s.cards.get(paused + "-0")!, suspended: true });
  assert.deepEqual(s.practiceCards("P", "weakest").map((c) => c.nid), [weak, strong]);
  assert.deepEqual(s.practiceCards("P", "new", 30).map((c) => c.nid), [n2, n1].sort((a, b) => s.cards.get(a + "-0")!.due - s.cards.get(b + "-0")!.due));
  assert.equal(s.practiceCards("P", "all").length, 4);
  const before = JSON.stringify([...s.cards.values()]); s.practiceCards("P", "random", 2); assert.equal(JSON.stringify([...s.cards.values()]), before);
});

test("a deck's new cards first (priority): it gets its cap before the others take turns", () => {
  const s = store(); k = 0; s.settings = { ...s.settings, newPerDay: 6, deckOpts: { Story: { ordered: true, newPerDay: 4, priority: true } } };
  const story = [1, 2, 3, 4, 5].map(() => add(s, "Story")); const med = [1, 2, 3, 4].map(() => add(s, "Med"));
  const q = s.queue("").map((c) => c.nid);
  assert.equal(q.filter((n) => story.includes(n)).length, 4, "4 from the story (its cap)"); assert.equal(q.filter((n) => med.includes(n)).length, 2);
  s.settings = { ...s.settings, deckOpts: { Story: { ordered: true, newPerDay: 4 } } };
  assert.equal(s.queue("").filter((c) => story.includes(c.nid)).length, 3, "without priority: turns (3 and 3)");
});

test("order by a number field (Goethe's Nr): notes without a number after; the previous line follows the same order", () => {
  const s = store(); k = 0; s.settings = { ...s.settings, deckOpts: { G: { ordered: true, orderBy: "field", orderField: "Nr", prevLine: true } } };
  const c = add(s, "G", { fields: ["c", "", "Nr. 10"], created: 1 }); const a = add(s, "G", { fields: ["a", "", "2"], created: 3 }); const none = add(s, "G", { fields: ["x", "", ""], created: 0 }); const b = add(s, "G", { fields: ["b", "", "<b>9</b>"], created: 2 });
  assert.deepEqual(s.queue("G").map((x) => x.nid), [a, b, c, none]);
  assert.equal(s.lineOf(s.cards.get(c + "-0")!)!.prev?.id, b);
  assert.deepEqual(s.deckFields("G"), ["Front", "Back", "Nr"]);
});

test("read and make: lines, words, gaps (neighbours merge), the ordered pack", () => {
  assert.deepEqual(splitLines("Wer reitet so spät? Es ist der Vater.\n\n„Mein Sohn, was birgst du?“ Siehst, Vater, du…"), ["Wer reitet so spät?", "Es ist der Vater.", "„Mein Sohn, was birgst du?“", "Siehst, Vater, du…"]);
  const t = tokens("Es ist der Vater."); assert.deepEqual(t.filter((x) => x.word).map((x) => x.t), ["Es", "ist", "der", "Vater"]);
  assert.equal(clozeLine("Es ist der Vater.", new Set([4, 6])), "Es ist {{c1::der Vater}}.");
  assert.equal(clozeLine("Es ist der Vater.", new Set([0, 6]), true), "{{c1::Es}} ist der {{c2::Vater}}.");
  assert.equal(clozeLine("a < b & c", new Set([0])), "{{c1::a}} &lt; b &amp; c");
  const lines = ["Eins zwei.", "Drei vier.", "Fünf sechs."];
  const p = readPack({ title: "Erlkönig", category: "Languages::German::Reading::Erlkönig", lang: "de-DE", lines, gaps: new Map([[0, new Set([2])], [2, new Set([0])]]) });
  assert.match(p.id, /^read-erlkonig-[0-9a-z]+$/);
  assert.equal(readPack({ title: "Erlkönig", category: "x", lines, gaps: new Map() }).id, p.id, "the same text: the same pack (re-saving updates)");
  assert.notEqual(readPack({ title: "Erlkönig", category: "x", lines: ["Anders."], gaps: new Map() }).id, p.id, "another text with the same title: its own pack"); assert.deepEqual(p.cards.map((c) => [c.id, c.seq]), [["l1", 10], ["l3", 30]]);
  const r = parsePack(p, []); assert.equal(r.notes.length, 2); assert.equal(r.invalid.length, 0); assert.deepEqual(r.deck?.hints, { ordered: true, prevLine: true, lang: "de-DE" });
});

test("best hours: answers and recall per hour; the best two-hour window needs enough answers", () => {
  const at = (h: number, d: number) => { const x = new Date(); x.setDate(x.getDate() - d); x.setHours(h, 10, 0, 0); return x.getTime(); };
  const revs: any[] = []; for (let d = 1; d <= 20; d++) { revs.push({ ts: at(7, d), rating: 3, state: "review" }, { ts: at(8, d), rating: 3, state: "review" }, { ts: at(22, d), rating: d % 2 ? 1 : 3, state: "review" }, { ts: at(23, d), rating: 1, state: "review" }); }
  revs.sort((a, b) => a.ts - b.ts);
  const h = hourStats(revs); assert.equal(h.hours[7].n, 20); assert.equal(h.hours[22].recall, 50);
  assert.deepEqual([h.best?.from, h.best?.to, h.best?.recall], [7, 9, 100]);
  assert.equal(hourStats(revs.slice(0, 5)).best, null, "too few answers: no claim");
});

test("subject designs: by system; German decks gothic; other languages a notebook; the Mephisto deck never", () => {
  assert.equal(deckTheme("German::Mephisto::Geschichte::Reich I", "de-DE"), "none");
  assert.equal(deckTheme("Languages::German::Mephisto", "de-DE"), "none");
  assert.equal(deckTheme("Languages::German::Goethe A1", "de-DE"), "German");
  assert.equal(deckTheme("Languages::French", "fr-FR"), "Languages");
  assert.equal(deckTheme("Medicine::Cardio", null), null);
  assert.equal(artFor("Cardiovascular", null, "#D65A3C")?.key, "Cardiovascular"); assert.ok(artFor("Cardiovascular", null, "#D65A3C")?.foot);
  assert.equal(artFor("Cardiovascular", "German", "#D65A3C")?.key, "German", "the deck's design wins over the card's system");
  assert.equal(artFor("Cardiovascular", "none", "#D65A3C"), null); assert.equal(artFor(undefined, null, "#888"), null);
  assert.match(decodeURIComponent(artFor("Neurology", null, "#D9A43C")!.strip), /#EE9DB6/, "neurons: gold with pink cell bodies");
  assert.match(decodeURIComponent(artFor(undefined, "German", "#000")!.strip), new RegExp(THEME_COLORS.German.main));
  const st = sanitizeSettings({ ...DEFAULT_SETTINGS, cardArt: "neon", timebox: 999 } as any, DEFAULT_SETTINGS) as any; assert.equal(st.cardArt, "rich"); assert.equal(st.timebox, 240);
});
