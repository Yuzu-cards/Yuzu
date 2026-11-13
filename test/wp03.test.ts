// WP03: record merge correctness between two devices (06-2, 06-5, 06-6, 10-18 sync side).
// Each test runs two "devices" through the real push/pull code against the in-memory fake GitHub, with the same merge order the
// store uses (tombstones → notes → cards → revived cards), and checks that both devices end up with the same records and nothing is lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubSync, mergeCards, mergeNotes, mergeTombstones, mergeCard, mergeNote, stampCard, stampNote, cardParts, type NoteConflict } from "../src/lib/sync.ts";
import type { Card, Note } from "../src/lib/model.ts";
import { fakeGitHub } from "./fake-github.ts";

let clock = 1_800_000_000_000; const now = () => ++clock;
const mkNote = (id: string, fields: string[], t: number, tags: string[] = []): Note => ({ id, ntid: "basic", guid: id, fields, tags, created: t, modified: t });
const mkCard = (id: string, nid: string, t: number): Card => ({ id, nid, ord: 0, state: "review", suspended: false, flag: 0, due: t + 86400000, stability: 5, difficulty: 5, reps: 1, lapses: 0, lastReview: t, step: 0, created: t, mod: t, source: "Medicine::Cardio" });
const review = (c: Card, t: number): Card => ({ ...c, reps: c.reps + 1, lastReview: t, due: t + 5 * 86400000, stability: c.stability * 2, mod: t }); // what rate() does: spread + new scheduling + mod

class Device {
  notes = new Map<string, Note>(); cards = new Map<string, Card>(); tombs: Record<string, number> = {};
  known: Record<string, string> = {}; doneAt = 0; conflicts: NoteConflict[] = []; gh: GitHubSync; pushed = 0;
  constructor(public name: string, repo: ReturnType<typeof fakeGitHub>) { this.gh = new GitHubSync({ owner: "o", repo: "r", token: "t" }); this.gh.fetchImpl = repo.fetchImpl as any; }
  deleteNote(nid: string) { const t = now(); this.notes.delete(nid); this.tombs["n:" + nid] = t; for (const c of [...this.cards.values()]) if (c.nid === nid) this.cards.delete(c.id); }
  editNote(nid: string, fields: string[], tags?: string[]) { const n = this.notes.get(nid)!; const t = now(); this.notes.set(nid, stampNote(n, { ...n, fields, tags: tags ?? n.tags, modified: t, edited: t }, t)); }
  suspend(cid: string, on = true) { const c = this.cards.get(cid)!; this.cards.set(cid, stampCard(c, { ...c, suspended: on }, now(), ["u"])); }
  flag(cid: string, f: number) { const c = this.cards.get(cid)!; this.cards.set(cid, stampCard(c, { ...c, flag: f }, now(), ["u"])); }
  move(cid: string, source: string) { const c = this.cards.get(cid)!; this.cards.set(cid, stampCard(c, { ...c, source }, now(), ["d"])); }
  answer(cid: string) { this.cards.set(cid, review(this.cards.get(cid)!, now())); }
  /** The store's syncNow() merge order, minus locks and media. */
  async sync() {
    const remote = await this.gh.pullManifest();
    if (remote) {
      const got = await this.gh.pullChanged(remote, this.known);
      if (got.tombstones) {
        this.tombs = mergeTombstones(this.tombs, got.tombstones);
        for (const [k, t] of Object.entries(got.tombstones)) {
          if (k.startsWith("n:")) { const id = k.slice(2); const n = this.notes.get(id); if (n && n.modified <= t) { this.notes.delete(id); for (const c of [...this.cards.values()]) if (c.nid === id) this.cards.delete(c.id); } }
          else if (k.startsWith("c:")) { const id = k.slice(2); const c = this.cards.get(id); if (c && (c.mod ?? c.lastReview) <= t) this.cards.delete(id); }
        }
      }
      const revived: string[] = [];
      if (got.notes) mergeNotes(this.notes, got.notes, this.tombs, { revived, conflicts: this.conflicts, since: this.doneAt, from: remote.device || "another device" });
      if (got.cards) mergeCards(this.cards, got.cards, this.tombs, { notes: this.notes });
      // reviveCards(): the cards of a note brought back, from the card files this sync didn't download
      const have = new Set([...this.cards.values()].map((c) => c.nid)); const need = new Set(revived.filter((id) => !have.has(id)));
      if (need.size) { const files: Record<string, string> = {}; for (const [p, h] of Object.entries(remote.files)) if (p.startsWith("cards/") && !(p in got.files)) files[p] = h; const more = await this.gh.pullChanged({ ...remote, files }, {}); mergeCards(this.cards, (more.cards ?? []).filter((c) => need.has(c.nid)), this.tombs, { notes: this.notes }); }
    }
    const snapAt = now();
    const sh = await GitHubSync.shard({ notetypes: [], notes: [...this.notes.values()], cards: [...this.cards.values()], reviews: [], tombstones: this.tombs, settings: { updatedAt: 1 } });
    const res = await this.gh.push(sh.hashes, sh.make, remote, this.name, undefined, { notes: this.notes.size, cards: this.cards.size, reviews: 0 });
    this.known = res.manifest.files; this.doneAt = snapAt; this.pushed = res.pushed;
  }
  state() { return { notes: [...this.notes.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((n) => [n.id, n.fields, [...n.tags].sort()]), cards: [...this.cards.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((c) => [c.id, c.nid, c.reps, c.suspended, c.flag, c.source, c.due]) }; }
}

async function pair(nNotes = 6) {
  const repo = fakeGitHub(); const A = new Device("Phone", repo), B = new Device("Deck", repo); const t = now();
  for (let i = 1; i <= nNotes; i++) { A.notes.set("n" + i, mkNote("n" + i, [`Q cardio ${i}?`, `A ${i}`], t)); A.cards.set("c" + i, mkCard("c" + i, "n" + i, t)); }
  await A.sync(); await B.sync(); await A.sync();
  assert.deepEqual(B.state(), A.state(), "start in step");
  return { A, B };
}
/** Sync both a few times, in turn, and require that they agree and that nothing is left to push (no ping-pong). */
async function settle(A: Device, B: Device, first: Device = A) {
  const order = first === A ? [A, B] : [B, A];
  for (let i = 0; i < 3; i++) for (const d of order) await d.sync();
  assert.deepEqual(A.state(), B.state(), "both devices hold the same collection");
  await A.sync(); await B.sync(); assert.equal(A.pushed + B.pushed, 0, "converged: nothing left to push");
}

for (const first of ["deleter", "editor"] as const) {
  test(`06-2: delete on one device + edit on the other → the edited note comes back WITH its card on both (${first} syncs first)`, async () => {
    const { A, B } = await pair();
    A.deleteNote("n2");                                   // Phone deletes n2 (offline)
    B.editNote("n2", ["Q cardio 2? typo fixed on B", "A 2"]); // Deck fixes a typo in n2 afterwards (offline)
    const d1 = first === "deleter" ? A : B, d2 = first === "deleter" ? B : A;
    await d1.sync(); await d2.sync(); if (d1 === A) await A.sync();
    // as soon as the deleting device has pulled the edit, it has the card back too (no empty note, no extra round needed)
    for (const d of [A, B]) { assert.equal(d.notes.get("n2")?.fields[0], "Q cardio 2? typo fixed on B", d.name + " has the edit"); assert.equal([...d.cards.values()].filter((c) => c.nid === "n2").length, 1, d.name + " has n2's card"); }
    await settle(A, B, d1);
    assert.equal(A.cards.size, 6); assert.equal(A.notes.size, 6);
  });
}

test("06-2: a deletion made after the other device's edit still wins (later change wins), and the card goes with the note", async () => {
  const { A, B } = await pair();
  B.editNote("n3", ["Q cardio 3? edited", "A 3"]); A.deleteNote("n3"); // delete is the later change
  await B.sync(); await A.sync(); await settle(A, B);
  assert.equal(A.notes.has("n3"), false); assert.equal([...B.cards.values()].some((c) => c.nid === "n3"), false);
});

for (const first of ["deleter", "reviewer"] as const) test(`06-2: a note deleted here and only reviewed (not edited) elsewhere stays deleted; its card does not linger (${first} syncs first)`, async () => {
  const { A, B } = await pair();
  A.deleteNote("n4"); B.answer("c4"); // the review is later than the delete, but a review doesn't edit the note
  if (first === "deleter") { await A.sync(); await B.sync(); } else { await B.sync(); await A.sync(); }
  for (const c of A.cards.values()) assert.ok(A.notes.has(c.nid), "deleting device: no card without a note right after its sync");
  await settle(A, B);
  assert.equal(A.notes.has("n4"), false); assert.equal(B.notes.has("n4"), false);
  assert.equal(A.cards.has("c4"), B.cards.has("c4"), "both agree on the card");
  for (const d of [A, B]) for (const c of d.cards.values()) assert.ok(d.notes.has(c.nid), `${d.name}: no card without a note`);
});

test("06-5: the same note edited on two devices — front from one, back from the other, both tags kept; nothing to resolve", async () => {
  const { A, B } = await pair();
  A.editNote("n1", ["Q cardio 1? +A-front", "A 1"], ["tagA"]);
  B.editNote("n1", ["Q cardio 1?", "A 1 +B-back"], ["tagB"]);
  await A.sync(); await B.sync(); await settle(A, B);
  for (const d of [A, B]) { const n = d.notes.get("n1")!; assert.deepEqual(n.fields, ["Q cardio 1? +A-front", "A 1 +B-back"], d.name); assert.deepEqual([...n.tags].sort(), ["tagA", "tagB"], d.name); }
  assert.equal(A.conflicts.length + B.conflicts.length, 0, "different fields: no conflict");
});

test("06-5: the same FIELD edited on both: the later edit wins and the other is kept as a conflict copy on exactly one device", async () => {
  for (const first of [0, 1]) {
    const { A, B } = await pair();
    A.editNote("n1", ["Front by Phone", "A 1"]); B.editNote("n1", ["Front by Deck (later)", "A 1"]);
    const [d1, d2] = first ? [B, A] : [A, B];
    await d1.sync(); await d2.sync(); await settle(A, B, d1);
    assert.equal(A.notes.get("n1")!.fields[0], "Front by Deck (later)"); assert.equal(B.notes.get("n1")!.fields[0], "Front by Deck (later)");
    const all = [...A.conflicts, ...B.conflicts]; assert.equal(all.length, 1, "one copy of the replaced edit, order " + first);
    assert.equal(all[0].lost, "Front by Phone"); assert.equal(all[0].kept, "Front by Deck (later)"); assert.equal(all[0].field, 0);
  }
});

test("06-5: a tag removed on one device and another added on the other: the removal and the addition both stick", async () => {
  const { A, B } = await pair();
  A.editNote("n5", ["Q cardio 5?", "A 5"], ["old", "keep"]); await A.sync(); await B.sync();
  A.editNote("n5", ["Q cardio 5?", "A 5"], ["keep"]);            // Phone removes "old"
  B.editNote("n5", ["Q cardio 5?", "A 5 (fixed)"], ["old", "keep", "new"]); // Deck later adds "new" (still has "old")
  await A.sync(); await B.sync(); await settle(A, B);
  assert.deepEqual([...A.notes.get("n5")!.tags].sort(), ["keep", "new"]); assert.equal(A.notes.get("n5")!.fields[1], "A 5 (fixed)");
});

test("06-6: suspend on one device + a later review on the other → suspended AND reviewed on both (and the reverse order)", async () => {
  for (const suspendFirst of [true, false]) {
    const { A, B } = await pair();
    if (suspendFirst) { A.suspend("c1"); B.answer("c1"); } else { B.answer("c1"); A.suspend("c1"); }
    await A.sync(); await B.sync(); await settle(A, B);
    for (const d of [A, B]) { const c = d.cards.get("c1")!; assert.equal(c.suspended, true, `${d.name} keeps the suspension (${suspendFirst})`); assert.equal(c.reps, 2, `${d.name} keeps the review (${suspendFirst})`); }
  }
});

test("06-6: a flag and a deck move on one device survive reviews on the other; un-suspending later wins over an older suspend", async () => {
  const { A, B } = await pair();
  A.flag("c2", 3); A.move("c3", "Medicine::Renal"); B.answer("c2"); B.answer("c3"); B.answer("c3");
  await B.sync(); await A.sync(); await settle(A, B);
  for (const d of [A, B]) { assert.equal(d.cards.get("c2")!.flag, 3); assert.equal(d.cards.get("c2")!.reps, 2); assert.equal(d.cards.get("c3")!.source, "Medicine::Renal"); assert.equal(d.cards.get("c3")!.reps, 3); }
  A.suspend("c4"); await A.sync(); await B.sync(); B.suspend("c4", false); A.answer("c4");
  await A.sync(); await B.sync(); await settle(A, B);
  for (const d of [A, B]) { assert.equal(d.cards.get("c4")!.suspended, false, d.name + ": the later unsuspend wins"); assert.equal(d.cards.get("c4")!.reps, 2); }
});

test("06-6: an undone review (same scheduling as before, newer mod) still beats the other device's copy of that review", async () => {
  const { A, B } = await pair();
  A.suspend("c5"); await A.sync(); await B.sync();
  const before = A.cards.get("c5")!; A.answer("c5"); await A.sync(); await B.sync(); // B has the review
  A.cards.set("c5", { ...before, mod: now() });    // undoLast(): the pre-review card, fresh mod
  await A.sync(); await B.sync(); await settle(A, B);
  assert.equal(B.cards.get("c5")!.reps, 1, "undo reached the other device"); assert.equal(B.cards.get("c5")!.suspended, true);
});

test("10-18 (sync side): a deletion undone after it synced comes back on the other device with its card and review state", async () => {
  const { A, B } = await pair();
  A.answer("c6"); const card = A.cards.get("c6")!, note = A.notes.get("n6")!;
  A.deleteNote("n6"); await A.sync(); await B.sync(); assert.equal(B.notes.has("n6"), false, "deletion reached B");
  const t = now(); delete A.tombs["n:n6"]; A.notes.set("n6", { ...note, modified: t }); A.cards.set("c6", { ...card, mod: t }); // undoDelete()
  await A.sync(); await B.sync(); await settle(A, B);
  assert.equal(B.notes.has("n6"), true); assert.equal(B.cards.get("c6")?.reps, 2);
});

test("merge rules are symmetric and stable; records without stamps (older versions) merge whole as before", () => {
  const t = now(); const c = mkCard("x", "n", t);
  const s = stampCard(c, { ...c, suspended: true }, t + 5, ["u"]); const r = review(c, t + 9);
  assert.deepEqual(mergeCard(s, r), mergeCard(r, s)); const m = mergeCard(s, r); assert.equal(mergeCard(m, r), m); assert.equal(mergeCard(m, s), m);
  assert.deepEqual(cardParts(m), { s: t + 9, u: t + 5, d: 0 });
  const old1 = { ...c, mod: t + 1, suspended: true }, old2 = review(c, t + 2); assert.equal(mergeCard(old1, old2), old2, "no stamps: later mod wins whole");
  const n = mkNote("n", ["a", "b"], t); const e1 = stampNote(n, { ...n, fields: ["A", "b"] }, t + 1), e2 = stampNote(n, { ...n, fields: ["a", "B"], tags: ["x"] }, t + 2);
  assert.deepEqual(mergeNote(e1, e2), mergeNote(e2, e1)); const mn = mergeNote(e1, e2); assert.equal(mergeNote(mn, e2), mn); assert.equal(mergeNote(mn, e1), mn);
  const o1 = { ...n, fields: ["A", "b"], modified: t + 1 }, o2 = { ...n, fields: ["a", "B"], modified: t + 2 }; assert.equal(mergeNote(o1, o2), o2, "no stamps: later modified wins whole");
  // an older Yuzu edits a stamped field without re-stamping: its edit counts from its `modified`, so it is not undone by an older stamp
  const legacy = { ...e1, fields: ["A from old version", "b"], modified: t + 7 }; assert.equal(mergeNote(legacy, e2).fields[0], "A from old version");
});
