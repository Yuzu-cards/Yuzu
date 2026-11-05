// Yuzu's online storage on Google Drive, tested against an in-memory Google (test/fake-google.ts) that can drop
// connections, answer "busy" (503) and "slow down" (403 rate limit) like the real one does on a phone.
//  - a collection the size of the user's (100k notes, 150k cards, 30k reviews) goes up and comes back identical
//  - a first upload cut off half-way resumes: the second try uploads only what's missing
//  - dropped connections and throttling are ridden out by retries
//  - two devices: the lock, the manifest revision check, duplicate files
//  - the media folder: a 2,500-file index, the changes feed (new, deleted, moved away), uploads without lookups, bytes intact
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { fakeGoogle } from "./fake-google.ts";

// ---- a browser-ish world for google.ts: localStorage, and fetch to googleapis routed into the fake
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k) };
let G = fakeGoogle();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => { const u = String(url); if (/googleapis\.com/.test(u)) return G.fetchImpl(u, init ?? {}); return realFetch(url, init); }) as any;
const signIn = () => localStorage.setItem("yuzu-google", JSON.stringify({ access: "tok1", expires: Date.now() + 3600e3, email: "amro@example.com", scope: "drive" }));

const { setRetryScale } = await import("../src/lib/google.ts");
const { DriveSync, DriveMedia, PATHS } = await import("../src/lib/drive.ts");
const { GitHubSync } = await import("../src/lib/sync.ts");
type Snap = Parameters<typeof GitHubSync.shard>[0];
before(() => { setRetryScale(0.002); signIn(); });

// ---- a collection the size of the user's
function bigCollection(nNotes = 100_000, nCards = 150_000, nReviews = 30_000): Snap {
  const notes = Array.from({ length: nNotes }, (_, i) => ({ id: "n" + i, ntid: "basic", guid: "g" + i, fields: [`Question ${i} — what is the mechanism of drug ${i % 977}?`, `Answer ${i}: it blocks receptor ${i % 131} <img src="img${i % 5000}.jpg">`], tags: ["auto::System::" + ["Cardio", "Renal", "Neuro", "GI"][i % 4]], created: 1_700_000_000_000 + i, modified: 1_700_000_000_000 + i }));
  const cards = Array.from({ length: nCards }, (_, i) => ({ id: "c" + i, nid: "n" + (i % nNotes), ord: Math.floor(i / nNotes), state: (["new", "learning", "review"] as const)[i % 3], suspended: i % 97 === 0, flag: 0, due: 1_760_000_000_000 + i * 1000, stability: 1 + (i % 400), difficulty: 1 + (i % 9), reps: i % 30, lapses: i % 4, lastReview: 1_750_000_000_000 + i, step: 0, created: 0, mod: 1_750_000_000_000 + i, source: "Medicine" }));
  const reviews = Array.from({ length: nReviews }, (_, i) => ({ id: `c${i}-${1_740_000_000_000 + i * 60_000}`, cid: "c" + i, ts: 1_740_000_000_000 + i * 60_000, rating: (1 + (i % 4)) as 1 | 2 | 3 | 4, state: "review" as const, elapsedDays: i % 30, scheduledDays: i % 40, durationMs: 4000 + (i % 9000) }));
  return { notetypes: [{ id: "basic", name: "Basic", fields: ["Front", "Back"], templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}" }], css: "" }] as any, notes: notes as any, cards: cards as any, reviews: reviews as any, settings: { newPerDay: 20 }, tombstones: { "n:gone": 1 } };
}
const checksum = (x: unknown) => { const s = JSON.stringify(x); let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16) + ":" + s.length; };
const sortById = <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => (x.id < y.id ? -1 : 1));
async function push(sync: InstanceType<typeof DriveSync>, snap: Snap, device = "A") {
  const { hashes, make } = await GitHubSync.shard(snap, new Map());
  const remote = await sync.pullManifest(); const lock = await sync.acquireLock(device, device + "-id"); assert.equal(lock.held, true, "lock");
  return sync.push(hashes, make, remote, device, undefined, { notes: snap.notes.length, cards: snap.cards.length, reviews: snap.reviews.length });
}

test("a collection the size of the user's goes up to Drive and comes back identical", { timeout: 300_000 }, async () => {
  G = fakeGoogle(); signIn();
  const snap = bigCollection();
  const t0 = Date.now(); const res = await push(new DriveSync({}, "A"), snap); const up = Date.now() - t0;
  assert.ok(res.pushed > 300, `pushed ${res.pushed} files`);
  const folder = G.at(PATHS.collection);
  assert.ok(folder.has("manifest.json"), "manifest on Drive");
  assert.ok([...folder.keys()].filter((k) => k.startsWith("notes__")).length === 128 && [...folder.keys()].filter((k) => k.startsWith("cards__")).length === 256, "notes in 128 shards, cards in 256");
  // another device, nothing known locally: everything comes down
  const B = new DriveSync({}, "B"); const m = await B.pullManifest(); assert.ok(m);
  assert.deepEqual(m!.counts, { notes: 100_000, cards: 150_000, reviews: 30_000 });
  const got = await B.pullChanged(m!, {});
  assert.equal(got.notes!.length, 100_000); assert.equal(got.cards!.length, 150_000); assert.equal(got.reviews!.length, 30_000);
  assert.equal(checksum(sortById(got.notes!)), checksum(sortById(snap.notes)), "notes identical");
  assert.equal(checksum(sortById(got.cards!)), checksum(sortById(snap.cards)), "cards identical");
  assert.equal(checksum([...got.reviews!].sort((a, b) => a.ts - b.ts)), checksum(snap.reviews), "reviews identical");
  assert.deepEqual(got.tombstones, snap.tombstones); assert.deepEqual(got.settings, snap.settings);
  console.log(`  up ${Math.round(up / 1000)} s, ${res.pushed} files, ${(res.bytes / 1048576).toFixed(1)} MB (gzip where large)`);
});

test("a first upload cut off half-way resumes: the second try sends only what's missing", { timeout: 300_000 }, async () => {
  G = fakeGoogle(); signIn();
  const snap = bigCollection(20_000, 30_000, 5_000);
  let uploads = 0; G.fail = (u, m) => (/\/upload\//.test(u.pathname) && m !== "GET" && ++uploads > 150 ? "network" : null); // the connection dies for good after 150 files
  await assert.rejects(push(new DriveSync({}, "A"), snap), /connection dropped/);
  assert.equal(G.at(PATHS.collection).has("manifest.json"), false, "no manifest: the collection isn't half-published");
  G.fail = null; const before = G.stats.uploads;
  const res = await push(new DriveSync({}, "A"), snap);
  const sent = G.stats.uploads - before;
  assert.ok(sent < 400 - 140, `second try uploaded ${sent} files (would be ~400 from scratch)`);
  assert.equal(res.pushed, sent - 3, "pushed counts only the shards that went up (the other 3: manifest, lock taken, lock released)");
  const B = new DriveSync({}, "B"); const m = await B.pullManifest(); const got = await B.pullChanged(m!, {});
  assert.equal(checksum(sortById(got.cards!)), checksum(sortById(snap.cards)), "nothing lost or doubled");
});

test("dropped connections, 'busy' and 'slow down' answers are ridden out", { timeout: 300_000 }, async () => {
  G = fakeGoogle(); signIn();
  const snap = bigCollection(10_000, 15_000, 2_000);
  let k = 0; G.fail = () => { k++; return k % 7 === 0 ? "network" : k % 11 === 0 ? 503 : k % 13 === 0 ? 403 : null; }; // ~1 in 4 requests fails
  const res = await push(new DriveSync({}, "A"), snap);
  G.fail = null;
  assert.ok(G.stats.dropped > 20 && G.stats.throttled > 20, `dropped ${G.stats.dropped}, throttled ${G.stats.throttled}`);
  const B = new DriveSync({}, "B"); const m = await B.pullManifest(); const got = await B.pullChanged(m!, {});
  assert.equal(checksum(sortById(got.notes!)), checksum(sortById(snap.notes)));
  assert.ok(res.pushed > 0);
});

test("two devices: the lock, the revision check, and duplicate files from a retried create", { timeout: 120_000 }, async () => {
  G = fakeGoogle(); signIn();
  const snap = bigCollection(500, 800, 100);
  await push(new DriveSync({}, "A"), snap, "A");
  // A holds the lock; B is told to wait; A again (same install) is fine, and a case change of the name too
  const A = new DriveSync({}, "A"); const B = new DriveSync({}, "B");
  assert.equal((await A.acquireLock("S25 Ultra", "id-A")).held, true);
  assert.deepEqual(await B.acquireLock("PC", "id-B"), { held: false, by: "S25 Ultra" });
  assert.equal((await new DriveSync({}, "A").acquireLock("S25 ULTRA", "id-A")).held, true, "same install, name in capitals");
  await A.releaseLock(); assert.equal((await B.acquireLock("PC", "id-B")).held, true, "released → B takes it"); await B.releaseLock();
  // B pulls, then A pushes a change: B's push is refused (it must pull and merge first)
  const Bm = await B.pullManifest();
  const snapA = { ...snap, notes: snap.notes.map((n, i) => (i === 0 ? { ...n, fields: ["changed on A", ""], modified: n.modified + 1 } : n)) };
  await push(new DriveSync({}, "A"), snapA, "A");
  const snapB = { ...snap, notes: snap.notes.map((n, i) => (i === 1 ? { ...n, fields: ["changed on B", ""], modified: n.modified + 1 } : n)) };
  const { hashes, make } = await GitHubSync.shard(snapB, new Map());
  await assert.rejects(B.push(hashes, make, Bm, "B"), /Another device synced/);
  // a create retried after its answer was lost leaves two manifest.json files: the newest is read, the extra is removed after the next good sync
  const folder = [...G.files.values()].find((f) => f.name === "collection")!.id;
  const real = [...G.files.values()].find((f) => f.name === "manifest.json" && !f.trashed)!;
  G.seedFile("manifest.json", PATHS.collection, new TextEncoder().encode(JSON.stringify({ version: 1, files: {}, updatedAt: 1, rev: "old" })), "application/json");
  real.t = Date.now() * 1000 + 10_000_000; // the real one stays the newest
  void folder;
  const C = new DriveSync({}, "C"); const cm = await C.pullManifest(); assert.notEqual((cm as any).rev, "old", "newest copy wins");
  const snapC = { ...snapA, notes: snapA.notes.map((n, i) => (i === 2 ? { ...n, fields: ["changed on C", ""], modified: n.modified + 1 } : n)) };
  await C.acquireLock("C", "id-C"); const s = await GitHubSync.shard(snapC, new Map()); await C.push(s.hashes, s.make, cm, "C");
  assert.equal([...G.files.values()].filter((f) => f.name === "manifest.json" && !f.trashed).length, 1, "duplicate removed");
});

test("media folder: a 2,500-file index, the changes feed, uploads without lookups, bytes intact", { timeout: 120_000 }, async () => {
  G = fakeGoogle(); signIn();
  for (let i = 0; i < 2500; i++) G.seedFile(`img${i}.jpg`, PATHS.media, new Uint8Array([i % 256, 1, 2, 3]));
  const cache: Record<string, string> = {}; const dm = new DriveMedia(cache);
  let idx = await dm.ensure(null); idx = await dm.refresh(idx, 60_000);
  assert.equal(idx.complete, true); assert.equal(Object.keys(idx.files).length, 2500, "all 2,500 listed (3 pages)");
  // the feed: one new, one deleted, one moved out of the folder
  const other = [...G.files.values()].find((f) => f.name === "Yuzu")!;
  G.seedFile("new.png", PATHS.media, new Uint8Array([9]));
  const del = [...G.files.values()].find((f) => f.name === "img7.jpg")!; await G.fetchImpl(`https://www.googleapis.com/drive/v3/files/${del.id}`, { method: "DELETE", headers: { Authorization: "Bearer tok1" } });
  const mv = [...G.files.values()].find((f) => f.name === "img8.jpg")!; mv.parents = [other.id];
  await G.fetchImpl(`https://www.googleapis.com/drive/v3/files/${mv.id}`, { method: "PATCH", headers: { Authorization: "Bearer tok1" }, body: JSON.stringify({ name: "img8.jpg" }) }); // a change event for the move
  const reqs = G.stats.requests; idx = await dm.refresh(idx, 60_000);
  assert.ok(G.stats.requests - reqs <= 2, `the feed is one small request (${G.stats.requests - reqs})`);
  assert.ok(idx.files["new.png"] && !idx.files["img7.jpg"] && !idx.files["img8.jpg"], "new in, deleted and moved-away out");
  // upload: no name lookup for a file the complete index doesn't have; bytes come back intact
  const before = G.stats.requests; const id = await dm.upload(idx, "brand-new.webp", new Blob([new Uint8Array([7, 7, 7])]));
  assert.equal(G.stats.requests - before, 1, "one request, no lookup");
  const back = await dm.download(id); assert.deepEqual([...new Uint8Array(await back!.arrayBuffer())], [7, 7, 7]);
});
