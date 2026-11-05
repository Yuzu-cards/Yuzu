import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubSync, SyncError, mergeCards, mergeNotes, mergeReviews, mergeTombstones } from "../src/lib/sync.ts";
import type { Card, Note } from "../src/lib/model.ts";
import { fakeGitHub } from "./fake-github.ts";

const mkCard = (id: string, mod: number): Card => ({ id, nid: "n" + id, ord: 0, state: "review", suspended: false, flag: 0, due: 0, stability: 5, difficulty: 5, reps: 1, lapses: 0, lastReview: mod, step: 0, created: 0, mod, source: "Medicine" });
const mkNote = (id: string, modified: number, text = "x"): Note => ({ id, ntid: "t", guid: id, fields: [text], tags: [], created: 0, modified });
const cfg = { owner: "o", repo: "r", token: "t" };
const client = (gh: ReturnType<typeof fakeGitHub>) => { const c = new GitHubSync(cfg); c.fetchImpl = gh.fetchImpl as any; return c; };

test("two devices converge through push/pull with last-change-wins, starting from an empty repository", async () => {
  const gh = fakeGitHub();
  const A = client(gh), B = client(gh);
  assert.match((await A.check()).message, /empty/);
  const aCards = new Map([["1", mkCard("1", 100)], ["2", mkCard("2", 100)]]);
  const aNotes = new Map([["n1", mkNote("n1", 100)]]);
  const snapA = () => ({ notetypes: [], notes: [...aNotes.values()], cards: [...aCards.values()], reviews: [{ id: "1-100", cid: "1", ts: 100, rating: 3 as const, state: "review" as const, elapsedDays: 0, scheduledDays: 1, durationMs: 0 }], settings: { updatedAt: 1 } });
  const s1 = await GitHubSync.shard(snapA());
  const r1 = await A.push(s1.hashes, s1.make, null, "A");
  assert.ok(r1.pushed > 0); assert.ok(gh.files()[".yuzu"], "bootstrap commit made");
  const man = (await B.pullManifest())!;
  const got = await B.pullChanged(man, {});
  const bCards = new Map<string, Card>(); const bNotes = new Map<string, Note>(); let bReviews: any[] = [];
  mergeCards(bCards, got.cards!); mergeNotes(bNotes, got.notes!); bReviews = mergeReviews(bReviews, got.reviews!).list;
  assert.equal(bCards.size, 2); assert.equal(bNotes.size, 1); assert.equal(bReviews.length, 1);
  bCards.set("1", { ...bCards.get("1")!, mod: 200, lastReview: 200, reps: 2 });
  bReviews.push({ id: "1-200", cid: "1", ts: 200, rating: 3, state: "review", elapsedDays: 1, scheduledDays: 2, durationMs: 0 });
  const s2 = await GitHubSync.shard({ notetypes: [], notes: [...bNotes.values()], cards: [...bCards.values()], reviews: bReviews, settings: { updatedAt: 1 } });
  const r2 = await B.push(s2.hashes, s2.make, man, "B");
  assert.ok(r2.pushed >= 1 && r2.pushed <= 3, "only changed shards pushed: " + r2.pushed);
  aCards.set("2", { ...aCards.get("2")!, suspended: true, mod: 150 });
  const man2 = (await A.pullManifest())!;
  const gotA = await A.pullChanged(man2, r1.manifest.files);
  mergeCards(aCards, gotA.cards!);
  const mergedReviews = mergeReviews(snapA().reviews, gotA.reviews ?? []);
  assert.equal(aCards.get("1")!.reps, 2, "B's newer review state wins");
  assert.equal(aCards.get("2")!.suspended, true, "A's newer suspend survives");
  assert.equal(mergedReviews.list.length, 2);
  const s3 = await GitHubSync.shard({ ...snapA(), cards: [...aCards.values()], reviews: mergedReviews.list });
  const r3 = await A.push(s3.hashes, s3.make, man2, "A");
  assert.ok(r3.pushed >= 1);
  const man3 = (await B.pullManifest())!;
  const gotB = await B.pullChanged(man3, r2.manifest.files);
  mergeCards(bCards, gotB.cards ?? []);
  assert.equal(bCards.get("2")!.suspended, true);
  assert.equal(bCards.get("1")!.reps, 2);
  const s4 = await GitHubSync.shard({ notetypes: [], notes: [...bNotes.values()], cards: [...bCards.values()], reviews: mergedReviews.list, settings: { updatedAt: 1 } });
  const r4 = await B.push(s4.hashes, s4.make, man3, "B");
  assert.equal(r4.pushed, 0, "converged: nothing left to push");
});

test("a push that loses the race gets a conflict error; retrying after a pull succeeds", async () => {
  const gh = fakeGitHub();
  const A = client(gh), B = client(gh);
  const base = await GitHubSync.shard({ notetypes: [], notes: [], cards: [mkCard("1", 1)], reviews: [], settings: { updatedAt: 1 } });
  const r0 = await A.push(base.hashes, base.make, null, "A");
  const manA = (await A.pullManifest())!; const manB = (await B.pullManifest())!;
  const sB = await GitHubSync.shard({ notetypes: [], notes: [], cards: [mkCard("1", 1), mkCard("2", 2)], reviews: [], settings: { updatedAt: 1 } });
  await B.push(sB.hashes, sB.make, manB, "B");
  const sA = await GitHubSync.shard({ notetypes: [], notes: [], cards: [mkCard("1", 1), mkCard("3", 3)], reviews: [], settings: { updatedAt: 1 } });
  await assert.rejects(A.push(sA.hashes, sA.make, manA, "A"), (e: any) => e instanceof SyncError && e.kind === "conflict");
  const man2 = (await A.pullManifest())!; const got = await A.pullChanged(man2, r0.manifest.files);
  const cards = new Map([["1", mkCard("1", 1)], ["3", mkCard("3", 3)]]); mergeCards(cards, got.cards!);
  const sA2 = await GitHubSync.shard({ notetypes: [], notes: [], cards: [...cards.values()], reviews: [], settings: { updatedAt: 1 } });
  const r = await A.push(sA2.hashes, sA2.make, man2, "A");
  assert.ok(r.pushed >= 1);
  const final = await B.pullChanged((await B.pullManifest())!, {});
  assert.deepEqual(final.cards!.map((c) => c.id).sort(), ["1", "2", "3"]);
});

test("transient 5xx responses are retried; a bad token gives a readable error", async () => {
  const gh = fakeGitHub({ flaky: 2 });
  const A = client(gh);
  assert.equal(await A.pullManifest(), null, "survived two 502s");
  const bad = new GitHubSync(cfg); bad.fetchImpl = (async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })) as any;
  const r = await bad.check(); assert.equal(r.ok, false); assert.match(r.message, /Token rejected/);
});

test("shard cache: unchanged shards are not re-serialized, changed ones are", async () => {
  const cache = new Map();
  const cards = [mkCard("1", 1), mkCard("2", 1)];
  const a = await GitHubSync.shard({ notetypes: [], notes: [], cards, reviews: [], settings: {} }, cache);
  const sizeBefore = cache.size;
  cards[0] = { ...cards[0], mod: 2 };
  const b = await GitHubSync.shard({ notetypes: [], notes: [], cards, reviews: [], settings: {} }, cache);
  assert.equal(cache.size, sizeBefore);
  const changed = Object.keys(a.hashes).filter((p) => a.hashes[p] !== b.hashes[p]);
  assert.equal(changed.length, 1, "exactly one card shard changed: " + changed.join());
});

test("tombstones: a deleted note does not come back from remote, later edits do", async () => {
  const local = new Map<string, any>(); const tombs = { "n:a": 1000, "c:x": 1000 };
  assert.equal(mergeNotes(local, [{ id: "a", modified: 900 } as any], tombs), 0);
  assert.equal(mergeNotes(local, [{ id: "a", modified: 1001 } as any], tombs), 1, "an edit after the deletion wins");
  const cards = new Map<string, any>();
  assert.equal(mergeCards(cards, [{ id: "x", nid: "b", mod: 500 } as any, { id: "y", nid: "a", mod: 500 } as any], tombs), 0, "card tombstone and note tombstone both apply");
  assert.deepEqual(mergeTombstones({ "n:a": 5 }, { "n:a": 3, "n:b": 9 }), { "n:a": 5, "n:b": 9 });
});

test("large shards are stored gzip-compressed and round-trip; changing one card re-uploads kilobytes", async () => {
  const gh = fakeGitHub(); const A = client(gh), B = client(gh);
  const cards = Array.from({ length: 40000 }, (_, i) => mkCard(String(i), 1));
  const s1 = await GitHubSync.shard({ notetypes: [], notes: [], cards, reviews: [], settings: { updatedAt: 1 } });
  const r1 = await A.push(s1.hashes, s1.make, null, "A");
  assert.equal(Object.keys(r1.manifest.stored ?? {}).length, 0, "bulk first sync stores plain files inline (few large requests)");
  assert.ok(gh.calls() < 60, `bulk upload should take few requests, took ${gh.calls()}`);
  const got = await B.pullChanged((await B.pullManifest())!, {});
  assert.equal(got.cards!.length, 40000, "all cards come back through gunzip");
  cards[7] = { ...cards[7], mod: 2, reps: 2 };
  const s2 = await GitHubSync.shard({ notetypes: [], notes: [], cards, reviews: [], settings: { updatedAt: 1 } });
  const r2 = await A.push(s2.hashes, s2.make, (await A.pullManifest())!, "A");
  assert.equal(r2.pushed, 1); assert.ok(r2.bytes < 20000, `one review should upload a few KB, got ${r2.bytes}`);
  assert.ok(Object.values(r2.manifest.stored ?? {}).some((p) => p.endsWith(".gz")), "incremental shard stored gzip-compressed");
  const got2 = await B.pullChanged((await B.pullManifest())!, r1.manifest.files); assert.equal(got2.cards!.find((c) => c.id === "7")!.reps, 2, "mixed plain + gz files read back");
});

test("history compaction folds the branch into one parentless commit holding the same files", async () => {
  const gh = fakeGitHub(); const A = client(gh);
  let cards = [mkCard("1", 1)];
  for (let i = 0; i < 4; i++) { cards = [...cards, mkCard(String(i + 2), i + 2)]; const sh = await GitHubSync.shard({ notetypes: [], notes: [], cards, reviews: [], settings: { updatedAt: i } }); await A.push(sh.hashes, sh.make, await A.pullManifest(), "A", undefined, { notes: 0, cards: cards.length, reviews: 0 }); }
  const before = Object.keys(gh.files()).length; const man = (await A.pullManifest())!;
  assert.equal(man.commits, 4); assert.equal(man.counts?.cards, 5); assert.ok(gh.parentsOfHead().length === 1);
  assert.equal(await A.compact("A"), true);
  assert.deepEqual(gh.parentsOfHead(), [], "orphan commit"); assert.equal(Object.keys(gh.files()).length, before, "same files");
  const after = (await A.pullManifest())!; assert.equal(after.commits, 0);
  const got = await A.pullChanged(after, {}); assert.equal(got.cards!.length, 5);
});

test("sync lock: a second device waits instead of colliding; the push releases it; an abandoned lock expires", async () => {
  const gh = fakeGitHub(); const A = client(gh), B = client(gh);
  const sh = await GitHubSync.shard({ notetypes: [], notes: [], cards: [mkCard("1", 1)], reviews: [], settings: {} });
  await A.pullManifest(); await A.push(sh.hashes, sh.make, null, "A"); // first commit exists now
  assert.equal((await A.acquireLock("A")).held, true);
  const b = await B.acquireLock("B"); assert.equal(b.held, false); assert.equal(b.by, "A");
  assert.equal((await A.acquireLock("A")).held, true, "re-entrant for the same device");
  const sh2 = await GitHubSync.shard({ notetypes: [], notes: [], cards: [mkCard("1", 1), mkCard("2", 2)], reviews: [], settings: {} });
  await A.pullManifest(); await A.push(sh2.hashes, sh2.make, await A.pullManifest(), "A");
  assert.equal((await B.acquireLock("B")).held, true, "push released the lock");
  await B.releaseLock(); assert.equal((await A.acquireLock("A")).held, true); await A.releaseLock();
  // abandoned lock: expired → taken over
  const old = GitHubSync.LOCK_MS; GitHubSync.LOCK_MS = -1; await A.acquireLock("A"); GitHubSync.LOCK_MS = old;
  assert.equal((await B.acquireLock("B")).held, true, "expired lock is taken over");
});

test("rate limit: a long wait is reported with the resume time instead of an error loop", async () => {
  const c = new GitHubSync(cfg); const reset = Math.floor(Date.now() / 1000) + 1800;
  c.fetchImpl = (async () => new Response(JSON.stringify({ message: "API rate limit exceeded" }), { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } })) as any;
  await assert.rejects(c.pullManifest(), (e: any) => e instanceof SyncError && e.kind === "ratelimit" && Math.abs(e.resumeAt - reset * 1000) < 1000 && /resumes by itself/.test(e.message));
});

test("clock: edits are stamped after anything observed from another device, even with a slow local clock", async () => {
  const { stamp, observe } = await import("../src/lib/clock.ts");
  const ahead = Date.now() + 10 * 60000; // the other phone's clock is 10 minutes ahead
  observe(ahead);
  const t = stamp(); assert.ok(t > ahead, "a later edit here beats the other device's earlier one");
  assert.ok(stamp() > t, "strictly increasing");
  observe(Date.now() + 3 * 86400000); assert.ok(stamp() < Date.now() + 86400000, "implausible future times are ignored");
});

import { mapDeck } from "../src/lib/store.ts";
test("deck map: exact, parent fallback keeps the rest, unmapped stays", () => {
  const m = { "Rob's EM::12_Pediatrics": "Medicine::Specialties::EM::Rob's::12_Pediatrics", "AnKing Step Deck": "Medicine::Exams::Step 1::AnKing" };
  assert.equal(mapDeck("Rob's EM::12_Pediatrics", m), "Medicine::Specialties::EM::Rob's::12_Pediatrics");
  assert.equal(mapDeck("AnKing Step Deck::Cardio::New", m), "Medicine::Exams::Step 1::AnKing::Cardio::New");
  assert.equal(mapDeck("Languages::German", m), null);
});

test("sync lock: same install by id, older locks by name in any case; GitHub's own trouble is not a conflict", async () => {
  const { sameDevice } = await import("../src/lib/sync.ts");
  assert.equal(sameDevice({ device: "S25 Ultra" }, "S25 ULTRA"), true, "a renamed-case device still owns its old lock");
  assert.equal(sameDevice({ device: "PC" }, "S25 Ultra"), false);
  assert.equal(sameDevice({ device: "S25 Ultra", id: "a1" }, "S25 Ultra", "b2"), false, "two installs with the same name are told apart by id");
  assert.equal(sameDevice({ device: "Phone", id: "a1" }, "Renamed", "a1"), true, "renaming the device keeps the lock");
});
