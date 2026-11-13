// WP16: Library search (all fields, stripped, ranked, Arabic digits) and the tree/cardsIn shape cache.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/lib/store";
import { buildSearchDoc, isHousekeepingTag, parseQuery, scoreDoc, stripForSearch } from "../src/lib/search";
import type { Card, Note } from "../src/lib/model";

const note = (id: string, fields: string[], tags: string[] = []): Note => ({ id, ntid: "basic", fields, tags, modified: 1 } as any);
const card = (id: string, nid: string, source: string, extra: Partial<Card> = {}): Card => ({ id, nid, ord: 0, source, state: "new", due: 0, stability: 0, difficulty: 5, reps: 0, lapses: 0, lastReview: 0, suspended: false, flag: 0, created: 1, mod: 1, ...extra } as any);

function seed() {
  const s = new Store();
  s.notetypes.set("basic", { id: "basic", name: "Basic", kind: "standard", fields: ["Front", "Back", "Extra", "Source"], templates: [], css: "" } as any);
  const notes = [
    note("n1", ["Adenosine for SVT", "<b>6&nbsp;mg</b> rapid IV push", "Then 12 mg", "ERC 2025"], ["cardio", "#AK_Step1_v12::Cardio"]),
    note("n2", ["Pneumothorax", "Air in the pleural space"], ["resp"]),
    note("n3", ["Signs of tension pneumothorax in trauma patients", "Tracheal deviation"], ["resp", "auto::System::Respiratory"]),
    note("n4", ["Which is a cause of {{c1::pneumothorax::condition}}?", ""], ["#AK_Step1_v12::Resp"]),
    note("n5", ["كالسيوم غلوكونات", "١٠٪ — ١٢٣"], []),
    note("n6", ["Long front " + "x".repeat(200) + " disimpaction", "b"], ["step1_deck"]),
    note("n7", ["Bowel care", "manual disimpaction"], ["pneumothorax-tagged"]),
  ];
  for (const n of notes) s.notes.set(n.id, n);
  const cards = [card("c1", "n1", "Med::Cardio"), card("c2", "n2", "Med::Resp"), card("c2b", "n2", "Med::Resp", { state: "review", due: 0, reps: 3 }), card("c3", "n3", "Med::Resp"), card("c4", "n4", "Med::Resp"), card("c5", "n5", "Ar"), card("c6", "n6", "Med::GI"), card("c7", "n7", "Med::GI")];
  for (const c of cards) s.cards.set(c.id, c);
  return s;
}
const ids = (m: Map<string, number> | null) => [...(m ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

test("stripForSearch drops markup, keeps cloze answers, decodes entities", () => {
  assert.equal(stripForSearch("<style>.x{}</style><b>6&nbsp;mg</b> {{c1::rapid::speed}}<br>push [sound:a.mp3] &amp; &#1632;"), "6 mg rapid push & ٠");
});

test("search reads every field, beyond 140 characters, with Arabic/Persian digits on both sides (03-4, 10-8)", async () => {
  const s = seed();
  assert.deepEqual(ids(await s.searchNotes("6 mg rapid")), ["n1"]);
  assert.deepEqual(ids(await s.searchNotes("ERC 2025")), ["n1"]);
  assert.deepEqual(new Set(ids(await s.searchNotes("disimpaction"))), new Set(["n6", "n7"]));
  assert.deepEqual(ids(await s.searchNotes("١٠٪")), ["n5"]);
  assert.deepEqual(ids(await s.searchNotes("۱۲۳")), ["n5"]);
  assert.deepEqual(ids(await s.searchNotes("123")), ["n5"]);
});

test("ranking: exact front first, then word starts, then other fields, tags last; housekeeping tags only when asked (03-5)", async () => {
  const s = seed();
  const r = ids(await s.searchNotes("pneumothorax"));
  assert.equal(r[0], "n2"); // title is exactly the word
  assert.equal(r[r.length - 1], "n7"); // only a tag mentions it
  assert.ok(r.indexOf("n3") < r.indexOf("n7") && r.indexOf("n4") < r.indexOf("n7"));
  assert.deepEqual(ids(await s.searchNotes("step1")), ["n6"]); // #AK_Step1 tags are housekeeping; "step1_deck" is a real tag
  assert.deepEqual(new Set(ids(await s.searchNotes("#ak_step1"))), new Set(["n1", "n4"]));
  assert.deepEqual(ids(await s.searchNotes("respiratory")), []); // auto:: tag
  assert.deepEqual(ids(await s.searchNotes("auto::system::resp")), ["n3"]);
  assert.deepEqual(new Set(ids(await s.searchNotes("tag:resp"))), new Set(["n2", "n3"]));
  assert.deepEqual(ids(await s.searchNotes("condition")), []); // a cloze hint isn't content
});

test("narrowing reuses the previous hits and stays correct; a note edit is seen at once", async () => {
  const s = seed();
  assert.equal((await s.searchNotes("pneu"))!.size, 4);
  assert.equal((await s.searchNotes("pneumo"))!.size, 4);
  assert.equal((await s.searchNotes("pneumot pleural"))!.size, 1);
  s.notes.set("n5", { ...s.notes.get("n5")!, fields: ["pneumothorax ar", ""] });
  assert.equal((await s.searchNotes("pneumot"))!.size, 5);
  const cancel = { cancelled: true }; assert.equal(await s.searchNotes("air", cancel), null);
});

test("helpers", () => {
  for (const t of ["#AK_Step1", "!FLAG", "auto::System::X", "AnkiHub_Deleted", "88768", "…", "anki::due", "needs-review::x", "manual::x"]) assert.ok(isHousekeepingTag(t), t);
  for (const t of ["cardio", "step1::hy", "leech", "Anki-like"]) assert.ok(!isHousekeepingTag(t), t);
  const d = buildSearchDoc(note("x", ["", "Front here", "back"], ["a", "#b"]));
  assert.ok(scoreDoc(d, parseQuery("front")!) >= 1000);
  assert.equal(parseQuery("  "), null);
});

test("tree and cardsIn come from a cached shape that survives reviews and follows structural changes (09-3)", () => {
  const s = seed();
  const t = s.tree("decks"); const med = t.children.find((c) => c.name === "Med")!;
  assert.equal(t.total, 8); assert.equal(med.total, 7); assert.deepEqual(med.children.map((c) => c.name), ["Cardio", "GI", "Resp"]);
  assert.deepEqual(s.cardsIn("Med::Resp").map((c) => c.id).sort(), ["c2", "c2b", "c3", "c4"]);
  const sv = s.structureVersion;
  s.cards.set("c2", { ...s.cards.get("c2")!, state: "review", due: 0, reps: 1 }); // a review: same deck, same note
  assert.equal(s.structureVersion, sv);
  assert.equal(s.cardsIn("Med::Resp").find((c) => c.id === "c2")!.reps, 1); // current object
  s.cards.set("c2", { ...s.cards.get("c2")!, source: "Med::GI" }); // a move
  assert.ok(s.structureVersion > sv);
  assert.deepEqual(s.cardsIn("Med::GI").map((c) => c.id).sort(), ["c2", "c6", "c7"]);
  s.cards.delete("c7"); assert.deepEqual(s.cardsIn("Med::GI").map((c) => c.id).sort(), ["c2", "c6"]);
  // tags view: a card is counted once per node even when two tags share a parent
  s.notes.set("n2", { ...s.notes.get("n2")!, tags: ["resp::lung", "resp::pleura"] });
  (s as any).treeCache.clear();
  const tags = s.tree("tags"); const resp = tags.children.find((c) => c.name === "resp")!;
  assert.equal(resp.total, 3); // c2b (n2), c3 (n3: "resp"), c2 moved but still n2 → counted once each
  assert.deepEqual(s.cardsIn("resp", "tags").map((c) => c.id).sort(), ["c2", "c2b", "c3"]);
  assert.deepEqual(s.cardsIn("resp::lung", "tags").map((c) => c.id).sort(), ["c2", "c2b"]);
  assert.deepEqual(s.cardsIn("auto::System::Respiratory", "tags"), []); // auto:: tags are not in the Tags view
  assert.deepEqual(s.cardsIn("Respiratory", "systems").map((c) => c.id), ["c3"]);
});

test("refsKey is memoised per version and structure (03-1)", () => {
  const s = seed(); const k = s.refsKey(); assert.equal(s.refsKey(), k);
  s.notes.set("n1", { ...s.notes.get("n1")!, modified: 99 }); assert.notEqual(s.refsKey(), k);
});
