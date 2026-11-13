// WP19: caches keyed on a notes revision, and the full backup written in slices.
import test from "node:test"; import assert from "node:assert/strict";
import { Store, RevMap } from "../src/lib/store.ts";
import type { Note, Notetype } from "../src/lib/model.ts";

const nt = { id: "nt", name: "Basic+", kind: "standard", fields: ["Front", "Back", "Sketchy"], templates: [], css: "" } as unknown as Notetype;
const note = (i: number, extra: Partial<Note> = {}) => ({ id: "n" + i, ntid: "nt", fields: [`front ${i}`, `back ${i}`, i % 2 ? "sketchy text" : ""], tags: i % 3 ? [] : ["sketchy::x", "ask-claude"], modified: 1000 + i, ...extra }) as unknown as Note;
function fresh() { const s = new Store(); s.notetypes.set(nt.id, nt); for (let i = 0; i < 30; i++) s.notes.set("n" + i, note(i)); return s; }

test("RevMap counts every set, delete and clear", () => {
  const m = new RevMap<string, number>([["a", 1], ["b", 2]]); assert.equal(m.rev, 0); assert.equal(m.size, 2);
  m.set("c", 3); m.delete("a"); m.clear(); assert.equal(m.rev, 3);
  assert.notEqual(new RevMap().id, m.id);
});

test("sketchyCount, the ask-claude list and refsKey are cached until a note changes", () => {
  const s = fresh();
  const a = s.sketchyCount(); assert.deepEqual(a, { notes: 20, tags: 10 });
  assert.equal(s.sketchyCount(), a, "same object: no second walk over the notes");
  const k1 = s.refsKey(); assert.equal(s.refsKey(), k1);
  assert.equal(s.improveList().length, 10);
  s.notes.set("n1", note(1, { fields: ["front 1", "back 1", ""], modified: 5000 }));
  assert.deepEqual(s.sketchyCount(), { notes: 19, tags: 10 }, "a changed note is counted again");
  assert.notEqual(s.refsKey(), k1);
  s.notes.set("n0", note(0, { tags: [] })); assert.equal(s.improveList().length, 9);
  s.notes.delete("n3"); assert.deepEqual(s.sketchyCount(), { notes: 17, tags: 8 });
  // a whole new map put in its place (a restore, a load) is wrapped and counted from scratch, under a new id
  const r1 = s.notesRev(); s.notes = new Map(s.notes); assert.notEqual(s.notesRev(), r1); s.notes.set("n5", note(5, { fields: ["a", "b", ""] })); assert.deepEqual(s.sketchyCount(), { notes: 16, tags: 8 });
});

test("the full backup written in slices is the same JSON as the one-piece backup", async () => {
  const s = fresh();
  for (let i = 0; i < 9000; i++) s.reviews.push({ id: "r" + i, cid: "c" + (i % 50), ts: 1_700_000_000_000 + i * 1000, rating: 3, state: "review", elapsed: 1, scheduled: 1, ms: 1000 } as any);
  const fr: number[] = []; const blob = await s.backupBlob(false, (f) => fr.push(f));
  const a = JSON.parse(await blob.text()); const b = JSON.parse(JSON.stringify(s.backup())); delete a.at; delete b.at;
  assert.deepEqual(a, b); assert.equal(fr[fr.length - 1], 1); assert.ok(fr.length >= 3);
});
