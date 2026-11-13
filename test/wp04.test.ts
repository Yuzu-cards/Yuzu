// WP04: the Google Drive sync engine and its hand-offs (beta report 06).
//  06-1  settings.json carries no per-device fields, so two devices upload the same file
//  06-3/06-11  a short lease renewed while syncing; a lock taken over stops the push before the manifest; a lock left behind is cleared
//  06-9  one "My Apps" when two callers make it at once; twins merged into the oldest
//  06-12 a create whose answer was lost is not made twice; duplicates tidied without a push
//  06-16 outbox captures carry a few words every device can list
//  06-18 a missing hub/citrus is looked up once a day, not on every pull
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { fakeGoogle } from "./fake-google.ts";

const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k) };
let G = fakeGoogle();
globalThis.fetch = (async (url: any, init?: any) => G.fetchImpl(String(url), init ?? {})) as any;
const signIn = () => localStorage.setItem("yuzu-google", JSON.stringify({ access: "tok1", expires: Date.now() + 3600e3, email: "amro@example.com", scope: "drive" }));
const { setRetryScale, ensureFolders, findFolders, putFile, createFolder, forgetVerified, folderAppeared, listFiles } = await import("../src/lib/google.ts");
const { DriveSync, PATHS, readPlan } = await import("../src/lib/drive.ts");
const { GitHubSync } = await import("../src/lib/sync.ts");
const { syncedSettings, DEFAULT_SETTINGS, captureProps } = await import("../src/lib/store.ts");
before(() => { setRetryScale(0.002); signIn(); });
const fresh = () => { G = fakeGoogle(); signIn(); forgetVerified(); };
const live = (name: string) => [...G.files.values()].filter((f) => f.name === name && !f.trashed);
const snap = (settings: Record<string, unknown>) => ({ notetypes: [], notes: [{ id: "n1", ntid: "b", guid: "g", fields: ["a", "b"], tags: [], created: 1, modified: 1 }], cards: [], reviews: [], tombstones: {}, settings }) as any;

test("06-1: settings.json is the same file on two devices whose only differences are per-device", async () => {
  const phone = { ...DEFAULT_SETTINGS, deviceName: "Phone", theme: "night", sfx: false, swipe: true, cardStyle: "deck", updatedAt: 5 } as any;
  const deck = { ...DEFAULT_SETTINGS, deviceName: "Deck", theme: "yuzu", sfx: true, swipe: false, cardStyle: "yuzu", nightCards: false, typeAnswers: false, autoplay: false, mediaDownload: false, updatedAt: 5 } as any;
  const a = await GitHubSync.shard(snap(syncedSettings(phone)), new Map()); const b = await GitHubSync.shard(snap(syncedSettings(deck)), new Map());
  assert.equal(a.hashes["settings.json"], b.hashes["settings.json"], "same hash: nothing to push after the other device synced");
  const up = JSON.parse(a.make("settings.json"));
  for (const k of ["sync", "deviceName", "theme", "sfx", "swipe", "cardStyle", "nightCards", "typeAnswers", "autoplay", "mediaDownload"]) assert.ok(!(k in up), `${k} not uploaded`);
  assert.equal(up.newPerDay, DEFAULT_SETTINGS.newPerDay); assert.equal(up.updatedAt, 5);
  const c = await GitHubSync.shard(snap(syncedSettings({ ...phone, newPerDay: 99 })), new Map());
  assert.notEqual(c.hashes["settings.json"], a.hashes["settings.json"], "a synced setting still changes it");
});

test("06-9: two callers making My Apps at once share one create; twins are merged into the oldest", async () => {
  fresh(); const cache: Record<string, string> = {};
  await Promise.all([ensureFolders(PATHS.collection, cache), ensureFolders(PATHS.hub, cache), ensureFolders(PATHS.rotas, cache), ensureFolders(PATHS.media, cache)]);
  assert.equal(live("My Apps").length, 1, "one My Apps"); assert.equal(live("Yuzu").length, 1, "one Yuzu");
  // a Drive that already has two (made by an older build): the oldest is kept, the other's files move in, the empty twin is binned
  fresh(); const old = G.seedFile("status.json", ["My Apps", "hub", "yuzu"], new TextEncoder().encode("{}"), "application/json");
  const twin = (await createFolder("My Apps", null)); const r = await createFolder("Rotas", twin); G.files.get(r)!.parents = [twin];
  const rotaFile = G.seedFile("x.xlsx", [], new Uint8Array([1])); G.files.get(rotaFile)!.parents = [r];
  const c2: Record<string, string> = {}; const keep = await findFolders(["My Apps"], c2);
  assert.equal(live("My Apps").length, 1, "one My Apps left"); assert.equal(keep, live("My Apps")[0].id);
  assert.ok(G.files.get(old)!.parents.length && live("hub")[0].parents.includes(keep!), "the older folder kept its files");
  assert.ok(live("Rotas")[0].parents.includes(keep!), "the twin's Rotas moved into the kept one");
  assert.ok(await findFolders(PATHS.rotas, c2), "Rotas found under the kept My Apps");
});

test("06-12: a create whose answer was lost is not made twice (files and folders)", async () => {
  fresh(); const parent = await ensureFolders(PATHS.outbox, {});
  let lose = 1; G.afterCreate = () => lose-- > 0;
  const id = await putFile({ parent, name: "capture-x.json", body: "{}", isNew: true });
  assert.equal(live("capture-x.json").length, 1, "one capture file, not two"); assert.equal(live("capture-x.json")[0].id, id);
  lose = 1; const f = await createFolder("Fresh", parent); assert.equal(live("Fresh").length, 1); assert.equal(live("Fresh")[0].id, f);
  // the whole collection pushed through a connection that loses one create answer in four: no duplicates at all
  let k = 0; G.afterCreate = (u) => /upload/.test(u.pathname) && ++k % 4 === 0;
  const s = new DriveSync({}, "A"); const sh = await GitHubSync.shard({ ...snap({ a: 1 }), notes: Array.from({ length: 3000 }, (_, i) => ({ id: "n" + i, ntid: "b", guid: "g" + i, fields: ["q" + i, "a"], tags: [], created: 1, modified: 1 })) }, new Map());
  await s.pullManifest(); assert.equal((await s.acquireLock("A", "a")).held, true); await s.push(sh.hashes, sh.make, null, "A"); await s.releaseLock(); G.afterCreate = null;
  assert.ok(k > 4, `${k} creates, some answers lost`);
  const names = [...G.at(PATHS.collection).keys()]; const all = [...G.files.values()].filter((x) => !x.trashed && x.parents.includes(live("collection")[0].id) && !x.mime.endsWith("folder"));
  assert.equal(all.length, names.length, `no file name twice (${all.length} files, ${names.length} names)`);
});

test("06-12: duplicates are tidied by a sync that has nothing to push", async () => {
  fresh(); const s = new DriveSync({}, "A"); const sh = await GitHubSync.shard(snap({ a: 1 }), new Map());
  await s.pullManifest(); await s.acquireLock("A", "a"); await s.push(sh.hashes, sh.make, null, "A"); await s.releaseLock();
  const shard = [...G.at(PATHS.collection).keys()].find((n) => n.startsWith("notes__"))!; const realId = live(shard)[0].id;
  for (let i = 0; i < 2; i++) { const id = G.seedFile(shard, PATHS.collection, new TextEncoder().encode("[]"), "application/json"); G.files.get(id)!.t = 1; } // older copies, as a retried create leaves them
  const b = new DriveSync({}, "B"); await b.pullManifest(); assert.equal(await b.tidyDupes("B", "b"), 2, "both extra copies removed");
  assert.deepEqual(live(shard).map((f) => f.id), [realId], "the newest copy stays");
  assert.equal(JSON.parse(G.at(PATHS.collection).get("lock.json")!).until, 0, "lock released after tidying");
});

test("06-3/06-11: short lease, renewed while held; a lock taken over stops the push before the manifest; a lock left behind is cleared", async () => {
  fresh(); assert.ok(DriveSync.LOCK_MS <= 120000, "lease is short");
  const sh = await GitHubSync.shard(snap({ a: 1 }), new Map());
  const A = new DriveSync({}, "Phone"); await A.pullManifest(); assert.equal((await A.acquireLock("Phone", "p")).held, true);
  const B = new DriveSync({}, "Deck"); const busy = await B.acquireLock("Deck", "d");
  assert.equal(busy.held, false); assert.equal(busy.by, "Phone"); assert.ok(busy.at && busy.until && busy.until - busy.at <= DriveSync.LOCK_MS, "who and since when");
  // heartbeat: with a quick beat the lease moves forward
  const beat0 = DriveSync.BEAT_MS; (DriveSync as any).BEAT_MS = 50;
  const A2 = new DriveSync({}, "Phone"); await A2.pullManifest(); await A.releaseLock(); await A2.acquireLock("Phone", "p");
  const u0 = JSON.parse(G.at(PATHS.collection).get("lock.json")!).until; await new Promise((r) => setTimeout(r, 200));
  const u1 = JSON.parse(G.at(PATHS.collection).get("lock.json")!).until; assert.ok(u1 > u0, "lease renewed while held");
  (DriveSync as any).BEAT_MS = beat0;
  // another device writes its own lock (the lease ran out on a sleeping phone): the push stops before the manifest
  const lf = live("lock.json")[0]; lf.bytes = new TextEncoder().encode(JSON.stringify({ device: "Deck", id: "d", until: Date.now() + 60000, n: "other" }));
  await assert.rejects(A2.push(sh.hashes, sh.make, null, "Phone"), /Deck took over/);
  assert.equal(G.at(PATHS.collection).has("manifest.json"), false, "no manifest written");
  await A2.releaseLock(); assert.equal(JSON.parse(G.at(PATHS.collection).get("lock.json")!).device, "Deck", "the other device's lock is left alone");
  // a token rejected mid-sync: the release can't reach Drive; the next good token clears it before anything else
  lf.bytes = new TextEncoder().encode(JSON.stringify({ device: "x", until: 0 }));
  const P = new DriveSync({}, "Phone"); await P.pullManifest(); await P.acquireLock("Phone", "p");
  const good = localStorage.getItem("yuzu-google")!; localStorage.setItem("yuzu-google", JSON.stringify({ access: "dead", expires: Date.now() + 3600e3, scope: "drive" }));
  await P.releaseLock(); assert.equal(P.lockLeft(), true, "the release didn't reach Drive"); localStorage.setItem("yuzu-google", good);
  assert.equal((await new DriveSync({}, "Deck").acquireLock("Deck", "d")).held, false, "still held for the Deck");
  assert.equal(await new DriveSync({}, "Phone").releaseOwnLock("Phone", "p"), true);
  assert.equal((await new DriveSync({}, "Deck").acquireLock("Deck", "d")).held, true, "free for the Deck at once");
  assert.equal(await new DriveSync({}, "Phone").releaseOwnLock("Phone", "p"), false, "someone else's lock is never released");
});

test("06-18: a missing Citrus plan folder is looked up once, until the changes feed shows it made", async () => {
  fresh(); const cache: Record<string, string> = {}; await ensureFolders(PATHS.hub, cache);
  assert.equal(await readPlan(cache), null); const r0 = G.stats.requests;
  assert.equal(await readPlan(cache), null); assert.equal(G.stats.requests - r0, 0, "the second pull spends no request on folders that aren't there");
  G.seedFile("plan.json", PATHS.planCitrus, new TextEncoder().encode(JSON.stringify({ app: "citrus" })), "application/json");
  const citrus = live("citrus")[0]; assert.equal(folderAppeared(cache, citrus.parents[0], "citrus"), true, "the feed's row for the new folder clears the 'not there'");
  assert.deepEqual(await readPlan(cache), { app: "citrus" });
  // create always looks, whatever was remembered
  const c2: Record<string, string> = {}; assert.equal(await findFolders(["Nope", "x"], c2), null); assert.ok(await ensureFolders(["Nope", "x"], c2)); assert.ok(!Object.keys(c2).some((k) => k.startsWith("?")));
});

test("06-16: outbox captures carry who, where and the start of the text in a listing", async () => {
  fresh(); const props = captureProps({ id: "cap1", at: 123, text: "Digoxin toxicity: " + "é".repeat(200), source: "orange", sent: false, image: "data:image/png;base64,AA" }, "Deck");
  for (const [k, v] of Object.entries(props)) assert.ok(new TextEncoder().encode(k + v).length <= 124, `${k} fits Drive's 124 bytes`);
  const d = new DriveSync({}, "Deck"); await d.putOutbox("capture-cap1.json", "{}", undefined, props);
  const [f] = await d.listOutbox(); assert.equal(f.props?.dev, "Deck"); assert.equal(f.props?.src, "orange"); assert.equal(f.props?.img, "1"); assert.ok(f.props?.t.startsWith("Digoxin"));
  assert.equal((await listFiles({ parent: (await ensureFolders(PATHS.outbox, {})) })).length, 1);
});
