// WP02: pack, curation and import robustness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePack, summarizePack, describeInvalid, packOrds } from "../src/import/pack.ts";
import { cleanNote, strTags, normCategory, dataUrlToBytes, dataUrlOk } from "../src/lib/sanitize.ts";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("10-1/10-9: wrongly typed values become text; a string tag is one tag", () => {
  const r = parsePack({ yuzu_pack: 1, id: "t", tags: "renal", cards: [
    { front: "Q", back: "A", tags: ["step1", 2026, null, { x: 1 }] },
    { front: "Q2", back: { x: 1 } },
    { type: "cloze", text: "a {{c1::b}}", extra: 5, tags: "step1" },
  ] }, []);
  for (const n of r.notes) { assert.ok(n.fields.every((f) => typeof f === "string"), JSON.stringify(n.fields)); assert.ok(n.tags.every((t) => typeof t === "string")); }
  assert.deepEqual(r.notes[0].tags, ["renal", "step1", "2026"]);
  assert.equal(r.notes[1].fields[1], "", "an object is not text");
  assert.equal(r.notes[2].fields[1], "5"); assert.deepEqual(r.notes[2].tags, ["renal", "step1"]);
});

test("10-1: stored notes with bad values are repaired", () => {
  const bad: any = { id: "n", ntid: "yuzu-basic", guid: "n", fields: ["Q", { x: 1 }, 42, null], tags: ["ok", 2026, ""], created: 0, modified: 0 };
  const r = cleanNote(bad); assert.equal(r.changed, true); assert.deepEqual(r.note.fields, ["Q", "", "42", ""]); assert.deepEqual(r.note.tags, ["ok", "2026"]);
  const good = { id: "g", ntid: "x", guid: "g", fields: ["a"], tags: ["t"], created: 0, modified: 0 }; assert.equal(cleanNote(good).note, good);
  assert.deepEqual(strTags("one"), ["one"]); assert.deepEqual(strTags(undefined), []);
});

test("10-10/10-12: broken cards are counted apart from duplicates, with reasons; clozes need a real gap", () => {
  const r = parsePack({ yuzu_pack: 1, id: "b", cards: [
    { type: "mcq", question: "No right answer", options: ["a", "b"] },
    { type: "mcq", question: "Also none", options: ["a", "b"] },
    { type: "mcq", question: "One option", options: ["a"], answer: 0 },
    { type: "vocab", word: "Herz" },
    { type: "cloze", text: "Hyperkalemia causes peaked T waves" },
    { type: "cloze", text: "zero {{c0::gap}}" },
    { type: "cloze", text: 42 },
    "not a card",
    { type: "cloze", text: "fine {{c0::x}} and {{c1::y}}" },
  ] }, []);
  assert.equal(r.notes.length, 1); assert.deepEqual(r.cards.map((c) => c.ord), [0], "c0 is not a card; c1 is ord 0");
  assert.equal(r.duplicates, 0); assert.equal(r.invalid.length, 8);
  assert.equal(describeInvalid(r.invalid), "2 MCQs had no correct answer, 1 MCQ had fewer than 2 options, 1 word had no meaning, 3 clozes had no gap like {{c1::…}}, 1 entry was not a card");
  const m = summarizePack(r).message; assert.match(m, /^1 card added, 8 broken cards left out \(2 MCQs had no correct answer/); assert.doesNotMatch(m, /duplicate/);
  assert.deepEqual(packOrds("cloze", "{{c0::a}} {{c2::b}}"), [1]);
});

test("10-11: a repeated id inside one pack is left out, not silently overwritten", () => {
  const r = parsePack({ yuzu_pack: 1, id: "d", cards: [{ id: "same", front: "First version", back: "a" }, { id: "same", front: "Second different text", back: "b" }] }, []);
  assert.equal(r.notes.length, 1); assert.equal(r.notes[0].fields[0], "First version"); assert.equal(r.invalid[0].reason, "dupId");
  assert.match(summarizePack(r).message, /1 card added, 1 broken card left out \(1 card repeated an id/);
});

test("10-14: deck paths are normalised", () => {
  assert.equal(normCategory("::::Medicine::::Renal::"), "Medicine::Renal");
  assert.equal(normCategory("Medicine:::Renal"), "Medicine::Renal", "a stray colon is trimmed off the part");
  assert.equal(normCategory("x".repeat(5000)).length, 80);
  assert.equal(normCategory(42, "Medicine::Inbox"), "42"); assert.equal(normCategory({}, "Medicine::Inbox"), "Medicine::Inbox");
  const r = parsePack({ yuzu_pack: 1, category: "::::Medicine::::Renal::", cards: [{ front: "Q", back: "A" }, { front: "Q2", back: "A", category: "  " }] }, []);
  assert.deepEqual(r.cards.map((c) => c.source), ["Medicine::Renal", "Medicine::Renal"]);
});

test("10-15: notes the user deleted stay deleted unless asked", () => {
  const pack = { yuzu_pack: 1, id: "t", cards: [{ id: "a", front: "Q one", back: "A" }, { front: "Q two", back: "B" }] };
  const r1 = parsePack(pack, []);
  const tombstones = Object.fromEntries(r1.notes.map((n) => ["n:" + n.id, 1]));
  const r2 = parsePack(pack, [], Date.now(), { tombstones });
  assert.equal(r2.notes.length, 0); assert.equal(r2.deleted, 2); assert.equal(summarizePack(r2).message, "Nothing added — 2 cards you deleted (left out)");
  const r3 = parsePack(pack, [], Date.now(), { tombstones, restoreDeleted: true }); assert.equal(r3.notes.length, 2);
});

test("10-16: replaces may not turn an Anki note into a pack note", () => {
  const anki = { id: "1690000000000", ntid: "1500000000", guid: "g", fields: ["{{c1::a}} {{c2::b}}", ""], tags: [], created: 0, modified: 0 };
  const r = parsePack({ yuzu_pack: 1, id: "x", cards: [{ id: "n", replaces: anki.id, front: "Overwritten", back: "B" }] }, [anki]);
  assert.equal(r.notes.length, 0); assert.equal(r.updated.length, 0); assert.equal(r.invalid[0].reason, "replaces");
  const own = parsePack({ yuzu_pack: 1, id: "x", cards: [{ front: "Old", back: "B" }] }, []).notes[0];
  const r2 = parsePack({ yuzu_pack: 1, id: "x", cards: [{ id: "n", replaces: own.id, front: "New", back: "B" }] }, [own]);
  assert.deepEqual(r2.updated, [own.id], "a pack's own note can still be revised");
});

test("10-4: a note already here without cards gets its cards back on re-import", () => {
  const pack = { yuzu_pack: 1, id: "big", category: "Medicine::Renal", cards: [{ id: "a", type: "cloze", text: "K {{c1::5.5}} {{c2::6}}" }, { front: "No id", back: "B" }] };
  const r1 = parsePack(pack, []);
  const r2 = parsePack(pack, r1.notes, Date.now(), { hasCards: () => false });
  assert.deepEqual(r2.repaired.sort(), r1.notes.map((n) => n.id).sort()); assert.equal(r2.cards.length, 3); assert.equal(r2.notes.length, 0);
  assert.ok(r2.cards.every((c) => c.source === "Medicine::Renal"));
  assert.match(summarizePack(r2).message, /^2 repaired \(3 missing cards made again\)/);
  const r3 = parsePack(pack, r1.notes, Date.now(), { hasCards: () => true }); assert.equal(r3.cards.length, 0); assert.equal(r3.unchanged + r3.duplicates, 2);
});

test("10-6: one unreadable picture is dropped from its card, the rest of the pack goes in", () => {
  const r = parsePack({ yuzu_pack: 1, cards: [{ front: "Good", back: "A", image: PNG }, { front: "Bad picture", back: "B", image: "data:image/png;base64,%%%%not base64" }, { type: "occlusion", front: "IO", image: "data:image/png;base64,%%", masks: [{ x: 1, y: 1, w: 5, h: 5, label: "x" }] }] }, []);
  assert.equal(r.notes.length, 2); assert.equal(r.media.length, 1); assert.equal(r.notes[1].fields[2], "");
  assert.equal(r.invalid[0].reason, "ioImage");
  assert.match(summarizePack(r).message, /1 picture could not be read and was left out/);
  assert.equal(dataUrlOk(PNG), true); assert.equal(dataUrlToBytes(PNG).mime, "image/png"); assert.throws(() => dataUrlToBytes("data:image/png;base64,%%"));
});

test("01-16/05-14/01-3: counts and plurals; nothing new says so", () => {
  const cards = Array.from({ length: 3 }, (_, i) => ({ type: "cloze", text: `Fact ${"abc"[i]} {{c1::one}} and {{c2::two}}` }));
  const r = parsePack({ yuzu_pack: 1, cards }, []); const s = summarizePack(r);
  assert.equal(s.added, 3); assert.equal(s.addedCards, 6); assert.match(s.message, /^3 notes \(6 cards\) added/);
  const again = summarizePack(parsePack({ yuzu_pack: 1, cards }, r.notes));
  assert.equal(again.added, 0); assert.equal(again.skippedDuplicate, 3); assert.equal(again.message, "Nothing added — 3 cards already in your collection");
  const one = summarizePack(parsePack({ yuzu_pack: 1, cards: [{ front: "Q", back: "A" }] }, [])); assert.match(one.message, /^1 card added/);
});
