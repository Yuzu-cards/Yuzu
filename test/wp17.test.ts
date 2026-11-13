// WP17: card editor gaps, occlusion box editing, near-duplicates paired with the card they resemble.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePack } from "../src/import/pack.ts";
import { similarPairs, SIMILAR_TAG } from "../src/lib/dupes.ts";
import type { Note } from "../src/lib/model.ts";

test("Make gap: wraps the selection in the next number; nothing selected → no gap at the start", async () => {
  const { wrapGap } = await import("../src/ui/CardEditor.tsx");
  const t = "Give calcium gluconate first";
  const r = wrapGap(t, 5, 22)!; assert.equal(r.text, "Give {{c1::calcium gluconate}} first"); assert.equal(r.text.slice(r.a, r.b), "calcium gluconate");
  const r2 = wrapGap(r.text, r.text.indexOf("first"), r.text.length)!; assert.match(r2.text, /\{\{c2::first\}\}$/);
  assert.equal(wrapGap(t, 0, 0), null, "caret only: the editor says 'select words first' instead");
  assert.equal(wrapGap(t, 4, 5), null, "a lone space is not a gap");
});

test("occlusion boxes move and resize inside the picture", async () => {
  const { moveBox, resizeBox, MIN_BOX } = await import("../src/ui/Occlusion.tsx");
  const m = { x: 10, y: 10, w: 20, h: 20, label: "LV" };
  assert.deepEqual(moveBox(m, 5, -3), { ...m, x: 15, y: 7 });
  assert.deepEqual(moveBox(m, 200, 200), { ...m, x: 80, y: 80 }, "kept inside the picture");
  assert.deepEqual(moveBox(m, -50, -50), { ...m, x: 0, y: 0 });
  assert.deepEqual(resizeBox(m, 10, 5), { ...m, w: 30, h: 25 });
  assert.deepEqual(resizeBox(m, -100, -100), { ...m, w: MIN_BOX, h: MIN_BOX }, "never smaller than the smallest box");
  assert.deepEqual(resizeBox(m, 500, 500), { ...m, w: 90, h: 90 }, "never past the edge");
});

const mk = (id: string, text: string, tags: string[] = [], similarTo?: string): Note => ({ id, ntid: "yuzu-cloze", guid: id, fields: [text, ""], tags, created: 1, modified: 1, ...(similarTo ? { similarTo } : {}) });

test("near-duplicate: the new note records the card it resembles, and the pair shows up", () => {
  const old = mk("old", "Hyperkalaemia with ECG changes: give {{c1::calcium gluconate}} first, then {{c2::insulin and dextrose}} IV.");
  const r = parsePack({ yuzu_pack: 1, cards: [{ type: "cloze", text: "Hyperkalaemia with ECG changes: give {{c1::calcium gluconate}} first, then {{c2::insulin and dextrose}} IV now." }] }, [old]);
  assert.equal(r.similar, 1); const n = r.notes[0];
  assert.ok(n.tags.includes(SIMILAR_TAG)); assert.equal(n.similarTo, "old");
  const all = new Map([old, n].map((x) => [x.id, x]));
  const pairs = similarPairs(all.values(), new Set(), (id) => all.get(id));
  assert.equal(pairs.length, 1, "before: 0 pairs, because only the new note carries the tag"); assert.deepEqual([pairs[0][0], pairs[0][1]].sort(), [n.id, "old"].sort());
  // Keep both dismisses it
  assert.equal(similarPairs(all.values(), new Set([[n.id, "old"].sort().join("|")]), (id) => all.get(id)).length, 0);
  // a partner that was deleted meanwhile: nothing to show
  assert.equal(similarPairs([n], new Set(), () => undefined).length, 0);
});

test("three variants of one card: the original is offered too", () => {
  const a = mk("a", "Antidote for paracetamol overdose is {{c1::N-acetylcysteine}} given IV");
  const b = mk("b", "The antidote for paracetamol overdose is {{c1::N-acetylcysteine}} given IV", [SIMILAR_TAG], "a");
  const c = mk("c", "Antidote for paracetamol overdose: {{c1::N-acetylcysteine}} given IV early", [SIMILAR_TAG], "a");
  const all = new Map([a, b, c].map((x) => [x.id, x]));
  const pairs = similarPairs(all.values(), new Set(), (id) => all.get(id));
  assert.equal(pairs.length, 1, "one pair at a time per note");
  assert.ok(pairs[0].includes("a") || (pairs[0].includes("b") && pairs[0].includes("c")));
  const ids = new Set(pairs.flatMap((p) => [p[0], p[1]]));
  // after resolving the first pair (say b merged into a), c pairs with a
  const left = new Map([a, c].map((x) => [x.id, x]));
  const next = similarPairs(left.values(), new Set(), (id) => left.get(id));
  assert.equal(next.length, 1); assert.deepEqual([next[0][0], next[0][1]].sort(), ["a", "c"]); void ids;
});
