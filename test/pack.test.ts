import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePack } from "../src/import/pack.ts";
import fs from "node:fs";
test("pack import: cloze ords, images, exact and near duplicates", () => {
  const pack = JSON.parse(fs.readFileSync("test/fixtures/hyperkalemia.yuzu.json", "utf8"));
  const r = parsePack(pack, []);
  assert.equal(r.notes.length, 5); assert.equal(r.media.length, 1);
  assert.equal(r.cards.filter((c) => c.nid === r.notes[1].id).length, 3, "three cloze cards");
  assert.ok(r.notes[0].fields[2].includes("<img src=\"pack-"));
  assert.equal(r.similar, 1, "the shorter restatement is flagged as similar");
  // Importing again: everything is an exact duplicate.
  const again = parsePack(pack, r.notes);
  assert.equal(again.notes.length, 0); assert.equal(again.skipped, 5);
});

test("pack revision: cards with id/replaces update in place, new cloze numbers add cards", () => {
  const v1 = { yuzu_pack: 1, id: "k", cards: [{ id: "a", type: "cloze", text: "K > {{c1::5.5}}" }, { type: "basic", front: "Old front", back: "Old back" }] };
  const r1 = parsePack(v1, []);
  const legacy = r1.notes[1].id;
  const v2 = { yuzu_pack: 1, id: "k", cards: [{ id: "a", type: "cloze", text: "US {{c1::5.0}}, UK {{c2::5.5}}" }, { id: "b", replaces: legacy, type: "basic", front: "New front", back: "New back" }] };
  const r2 = parsePack(v2, r1.notes);
  assert.deepEqual(r2.updated.sort(), [r1.notes[0].id, legacy].sort());
  assert.equal(r2.cards.filter((c) => c.nid === r1.notes[0].id).length, 2);
  assert.equal(parsePack(v2, r2.notes).unchanged, 2);
});

test("duplicates: similar pairs and merge keep the stronger history and union tags", async () => {
  const { similarPairs, mergeInto } = await import("../src/lib/dupes.ts");
  const mk = (id: string, text: string, tags: string[]) => ({ id, ntid: "t", guid: id, fields: [text, ""], tags, created: 0, modified: 0 });
  const a = mk("a", "Which language center is the center for language comprehension? Wernicke area", ["needs-review::similar", "x"]);
  const b = mk("b", "Which language center is the center for language comprehension? Wernicke's area", ["needs-review::similar", "y"]);
  const c = mk("c", "Treatment of PDA involves indomethacin", ["needs-review::similar"]);
  const pairs = similarPairs([a, b, c]);
  assert.equal(pairs.length, 1); assert.deepEqual([pairs[0][0], pairs[0][1]].sort(), ["a", "b"]);
  const card = (id: string, nid: string, reps: number) => ({ id, nid, ord: 0, state: "review" as const, suspended: false, flag: 0, due: 1, stability: reps, difficulty: 5, reps, lapses: 0, lastReview: reps, step: 0, created: 0, mod: 0, source: "M" });
  const m = mergeInto(a, [card("a0", "a", 1)], b, [card("b0", "b", 7)], 100);
  assert.deepEqual(m.note.tags.sort(), ["x", "y"]);
  assert.equal(m.cards[0].id, "a0"); assert.equal(m.cards[0].reps, 7, "stronger scheduling copied onto the kept card");
});

test("pack MCQ cards: options by index or object, bad ones skipped, revision keeps the note", async () => {
  const { parseOptions, shuffled } = await import("../src/lib/mcq.ts");
  const pack = { yuzu_pack: 1, id: "m", cards: [
    { id: "q1", type: "mcq", question: "First-line drug for anaphylaxis?", options: ["Adrenaline IM", "Hydrocortisone", "Chlorphenamine"], answer: 0, explanation: "IM adrenaline 0.5 mg of 1:1000 into the thigh." },
    { id: "q2", question: "Peaked T waves mean?", options: [{ text: "Hypokalaemia", why: "Gives U waves." }, { text: "Hyperkalaemia", correct: true }], tags: ["ecg"] },
    { id: "q3", type: "mcq", question: "No right answer", options: ["a", "b"] },
    { id: "q4", type: "mcq", question: "One option", options: ["a"], answer: 0 },
  ] };
  const r = parsePack(pack, []); assert.equal(r.notes.length, 2); assert.equal(r.skipped, 2); assert.equal(r.cards.length, 2);
  assert.equal(r.notes[0].ntid, "yuzu-mcq"); const o = parseOptions(r.notes[0].fields[1]);
  assert.deepEqual(o.map((x) => x.correct), [true, false, false]); assert.equal(parseOptions(r.notes[1].fields[1])[0].why, "Gives U waves.");
  assert.equal(r.notes[1].fields[4], ""); assert.equal(r.notes[0].fields[4], "IM adrenaline 0.5 mg of 1:1000 into the thigh.");
  // letters work too, and a changed explanation is an update, not a skip
  const v2 = { yuzu_pack: 1, id: "m", cards: [{ id: "q1", type: "mcq", question: "First-line drug for anaphylaxis?", options: ["Adrenaline IM", "Hydrocortisone", "Chlorphenamine"], answer: "A", explanation: "Changed." }] };
  const r2 = parsePack(v2, r.notes); assert.deepEqual(r2.updated, [r.notes[0].id]); assert.equal(parsePack(v2, [...r.notes.filter((n) => n.id !== r.notes[0].id), ...r2.notes]).unchanged, 1);
  // the shuffle is stable for a seed and keeps every option
  const a = shuffled([1, 2, 3, 4, 5], "c1:0"), b = shuffled([1, 2, 3, 4, 5], "c1:0"); assert.deepEqual(a, b); assert.deepEqual([...a].sort(), [1, 2, 3, 4, 5]);
  assert.notDeepEqual(shuffled(Array.from({ length: 12 }, (_, i) => i), "x:0"), shuffled(Array.from({ length: 12 }, (_, i) => i), "x:1"));
});

test("voice helpers: what is spoken, what is heard", async () => {
  const { spokenText, backOnly, matchWord, RATING_WORDS, LETTER_WORDS } = await import("../src/lib/voice.ts");
  assert.equal(spokenText('<style>.a{}</style><div>K <b>above</b> 5.5 is <span class="cloze" data-cloze="1">[...]</span>&nbsp;&amp; ECG</div>'), "K above 5.5 is blank and ECG");
  assert.equal(backOnly("<div>Question?</div><hr id=answer>Calcium <b>gluconate</b>"), "Calcium gluconate");
  assert.equal(backOnly('<div>Q</div><hr id="answer">'), "Q", "an empty answer part falls back to the whole back");
  assert.equal(matchWord("um I'd say good", RATING_WORDS), "3"); assert.equal(matchWord("that was hard", RATING_WORDS), "2"); assert.equal(matchWord("again please", RATING_WORDS), "1"); assert.equal(matchWord("easy", RATING_WORDS), "4");
  assert.equal(matchWord("goodness", RATING_WORDS), null, "whole words only"); assert.equal(matchWord("it is option b", LETTER_WORDS), "1"); assert.equal(matchWord("blah", RATING_WORDS), null);
});

test("reminders: the service worker's decision (when it's time, due, goal met, light days, once a day)", async () => {
  const vm = await import("node:vm"); const src = fs.readFileSync("src/sw.js", "utf8").replace("__VERSION__", "t").replace("__PRECACHE__", "[]");
  const ctx: any = { self: { addEventListener() {}, registration: {} }, caches: {}, location: {}, indexedDB: {}, Request: class {}, URL }; vm.createContext(ctx); vm.runInContext(src + "\nthis.shouldNudge = shouldNudge;", ctx);
  const at = (h: number, m = 0) => new Date(2026, 10, 7, h, m); const ymd = "2026-11-07";
  const base = { on: true, at: "19:00", due: 200, goalMet: false, skipLight: true, light: { [ymd]: false }, date: ymd, notifiedOn: "" };
  assert.equal(ctx.shouldNudge(base, at(19, 5)), true); assert.equal(ctx.shouldNudge(base, at(18, 59)), false, "not before the time");
  assert.equal(ctx.shouldNudge({ ...base, on: false }, at(20)), false); assert.equal(ctx.shouldNudge({ ...base, due: 0 }, at(20)), false, "nothing due");
  assert.equal(ctx.shouldNudge({ ...base, goalMet: true }, at(20)), false, "goal already met today"); assert.equal(ctx.shouldNudge({ ...base, goalMet: true, date: "2026-11-06" }, at(20)), true, "yesterday's goal doesn't count");
  assert.equal(ctx.shouldNudge({ ...base, light: { [ymd]: true } }, at(20)), false, "a light day stays quiet"); assert.equal(ctx.shouldNudge({ ...base, light: { [ymd]: true }, skipLight: false }, at(20)), true);
  assert.equal(ctx.shouldNudge({ ...base, notifiedOn: ymd }, at(21)), false, "once a day"); assert.equal(ctx.shouldNudge({ ...base, notifiedOn: "2026-11-06" }, at(21)), true);
});

test("roleplay prompt: facts, style, the way back into Yuzu", async () => {
  const { buildRoleplayPrompt, STYLES } = await import("../src/lib/roleplay.ts");
  const p = buildRoleplayPrompt({ style: "case", goal: "Step 1", facts: [{ q: "Antidote for digoxin toxicity?", a: "Fab fragments" }, { q: "Peaked T waves", a: "" }] });
  assert.match(p, /1\. Antidote for digoxin toxicity\? → Fab fragments\n2\. Peaked T waves\n/); assert.match(p, /revising for Step 1/); assert.ok(p.includes(STYLES.case.role)); assert.match(p, /yuzu_pack/); assert.match(p, /current guidelines/);
  assert.doesNotMatch(buildRoleplayPrompt({ style: "oral", facts: [] }), /revising for/);
});

test("workload diagnosis: ranked causes with evidence and fixes", async () => {
  const { diagnoseWorkload, extraShare } = await import("../src/lib/diagnose.ts");
  const DAY = 86400000; const now = Date.UTC(2026, 10, 12, 12); const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
  const mk = (id: string, o: any = {}) => ({ id, nid: id, ord: 0, state: "review", suspended: false, flag: 0, due: now, stability: 10, difficulty: 5, reps: 5, lapses: 0, lastReview: now - DAY, step: 0, created: 0, mod: 0, source: "x", ...o });
  const cards = [...Array.from({ length: 200 }, (_, k) => mk("old" + k)), ...Array.from({ length: 300 }, (_, k) => mk("new" + k)), ...Array.from({ length: 8 }, (_, k) => mk("leech" + k, { lapses: 9 }))];
  const reviews: any[] = []; let id = 0;
  for (let d = 0; d < 30; d++) { const ts = now - d * DAY - 3600e3; if (d % 3 === 1) continue; // skips every third day
    for (let k = 0; k < 40; k++) reviews.push({ id: "r" + id++, cid: "new" + ((d * 40 + k) % 300), ts, rating: 3, state: "learning" });
    for (let k = 0; k < 20; k++) reviews.push({ id: "r" + id++, cid: "old" + k, ts, rating: 3, state: "review" });
    for (let k = 0; k < 4; k++) reviews.push({ id: "r" + id++, cid: "leech" + k, ts, rating: 1, state: "review" }); }
  for (let k = 0; k < 200; k++) reviews.push({ id: "q" + k, cid: "old" + k, ts: now - 200 * DAY, rating: 3, state: "review" }); // the old cards were started long ago
  const d = diagnoseWorkload({ now, cards, reviews, newPerDay: 30, desiredRetention: 0.95, decay: 0.15, leechThreshold: 8, fitAt: null, overdue: 120, dueToday: 300, remindersOn: false, dayOf });
  const ids = d.causes.map((c) => c.id);
  assert.deepEqual(new Set(ids), new Set(["backlog", "new", "leeches", "retention", "missed", "tune"]), ids.join());
  assert.equal(ids[0], "new", "the biggest share leads"); assert.ok(d.causes.every((c, i) => i === 0 || d.causes[i - 1].perDay >= c.perDay));
  const nw = d.causes.find((c) => c.id === "new")!; assert.equal(nw.fix?.value, 20); assert.match(nw.evidence, /started in the last 30 days/);
  assert.equal(d.causes.find((c) => c.id === "leeches")!.fix?.ids?.length, 8); assert.equal(d.causes.find((c) => c.id === "missed")!.fix?.kind, "reminders");
  assert.ok(extraShare(0.95, 0.15) > extraShare(0.92, 0.15) && extraShare(0.9, 0.15) === 0);
  const calm = diagnoseWorkload({ now, cards: cards.slice(0, 200), reviews: reviews.filter((r) => r.cid.startsWith("old")), newPerDay: 10, desiredRetention: 0.9, decay: 0.15, leechThreshold: 8, fitAt: now - DAY, overdue: 0, dueToday: 20, remindersOn: true, dayOf });
  assert.ok(!calm.causes.some((c) => ["backlog", "new", "leeches", "retention", "tune"].includes(c.id)), calm.causes.map((c) => c.id).join());
});

test("Arabic and Persian digits are read as numbers", async () => {
  const { latinDigits, parseNum } = await import("../src/lib/num.ts");
  assert.equal(latinDigits("١٢/١١/٢٠٢٦"), "12/11/2026"); assert.equal(latinDigits("۱۲۳"), "123");
  assert.equal(parseNum("٢٫٥"), 2.5); assert.equal(parseNum("2,5"), 2.5); assert.equal(parseNum("1,307"), 1307); assert.equal(parseNum("٨"), 8); assert.equal(parseNum("abc"), null); assert.equal(parseNum(""), null);
});
