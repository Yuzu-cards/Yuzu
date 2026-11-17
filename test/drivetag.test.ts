// Citrus's Drive layout (claude/drive-layout.md, 17/11/2026): Yuzu finds its Drive folders by their citrusApp tag, falls back
// to the old My Apps paths only while nothing is tagged, makes a missing old path tagged at once, and keeps working (creating
// no "My Apps" again) after Citrus has moved everything into Citrus/… and archived My Apps.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { fakeGoogle } from "./fake-google.ts";

const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k) };
let G = fakeGoogle();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => { const u = String(url); if (/googleapis\.com/.test(u)) return G.fetchImpl(u, init ?? {}); return realFetch(url, init); }) as any;
const { setRetryScale, forgetTags, forgetVerified, findFolders } = await import("../src/lib/google.ts");
const { DriveSync, PATHS, writeStatus, readPlan, newRotaFiles } = await import("../src/lib/drive.ts");
const { GitHubSync } = await import("../src/lib/sync.ts");
before(() => { setRetryScale(0.002); localStorage.setItem("yuzu-google", JSON.stringify({ access: "tok1", expires: Date.now() + 3600e3, email: "amro@example.com", scope: "drive" })); });

const newSession = () => { forgetTags(); forgetVerified(); };
const folders = () => [...G.files.values()].filter((f) => f.mime.endsWith("folder") && !f.trashed);
const rootFolders = (name: string) => folders().filter((f) => f.name === name && f.parents.includes("root"));
const byPath = (path: string[]) => { let parent = "root"; let f: any; for (const n of path) { f = folders().find((x) => x.name === n && x.parents.includes(parent)); if (!f) return null; parent = f.id; } return f; };
const snap = () => ({ notetypes: [{ id: "basic", name: "Basic", fields: ["Front", "Back"], templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Back}}" }], css: "" }] as any,
  notes: [{ id: "n1", ntid: "basic", guid: "g1", fields: ["Q", "A"], tags: [], mod: 1, created: 1, modified: 1 }] as any, cards: [{ id: "c1", nid: "n1", ord: 0, state: "new", suspended: false, flag: 0, due: 0, stability: 0, difficulty: 0, reps: 0, lapses: 0, mod: 1 }] as any, reviews: [] as any, settings: { newPerDay: 20 }, tombstones: {} });
async function push(cache: Record<string, string>, device: string) {
  const sync = new DriveSync(cache, device); const s = snap(); const { hashes, make } = await GitHubSync.shard(s, new Map());
  const remote = await sync.pullManifest(); const lock = await sync.acquireLock(device, device + "-id"); assert.equal(lock.held, true);
  await sync.push(hashes, make, remote, device, undefined, { notes: 1, cards: 1, reviews: 0 }); await sync.releaseLock(device + "-id").catch(() => {});
}
const status = (device: string) => ({ app: "yuzu", title: "Yuzu", icon: "🍋", color: "#f2d34b", url: "", version: "t", device, updatedAt: new Date().toISOString(), drive: { byTag: true } }) as any;

test("fresh Drive, nothing tagged: the old paths are made, and Yuzu's own folders are tagged at once", async () => {
  G = fakeGoogle(); newSession(); const cache: Record<string, string> = {};
  await push(cache, "A"); await writeStatus(status("A"), cache);
  assert.equal(byPath(["My Apps", "Yuzu"])?.props?.citrusApp, "yuzu-data");
  assert.equal(byPath(["My Apps", "hub", "yuzu"])?.props?.citrusApp, "yuzu");
  assert.equal(byPath(["My Apps", "Yuzu", "collection"])?.props?.citrusApp, undefined, "only the app folder carries the tag");
  assert.equal(rootFolders("My Apps").length, 1);
});

test("an untagged old folder is still found by its path (Citrus hasn't tagged it yet), and no second one is made", async () => {
  G = fakeGoogle(); newSession();
  G.seedFile("plan.json", ["My Apps", "hub", "citrus"], new TextEncoder().encode(JSON.stringify({ app: "citrus", days: {} })), "application/json");
  G.seedFile("Nov.xlsx", ["My Apps", "Rotas"], new Uint8Array([1]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const cache: Record<string, string> = {};
  assert.equal((await readPlan(cache))?.app, "citrus");
  assert.equal((await newRotaFiles({}, cache)).files.length, 1);
  assert.equal(folders().filter((f) => f.name === "Rotas").length, 1);
});

test("after Citrus moves and renames everything into Citrus/… and archives My Apps, both an old device and a new one follow the tags", async () => {
  G = fakeGoogle(); newSession(); const cacheA: Record<string, string> = {};
  G.seedFile("plan.json", ["My Apps", "hub", "citrus"], new TextEncoder().encode(JSON.stringify({ app: "citrus", v: 2 })), "application/json");
  G.seedFile("Dec.xlsx", ["My Apps", "Rotas"], new Uint8Array([2]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await push(cacheA, "A"); await writeStatus(status("A"), cacheA);
  // Citrus: tag its own folders and the rotas, build the new tree, move and rename, archive My Apps
  byPath(["My Apps", "hub", "citrus"])!.props = { citrusApp: "citrus" }; byPath(["My Apps", "Rotas"])!.props = { citrusApp: "rotas" };
  G.seedFile("x", ["Citrus", "Learning", "Flashcards - Yuzu"], new Uint8Array()); G.seedFile("x", ["Citrus", "00 Hub"], new Uint8Array()); G.seedFile("x", ["Citrus", "Work"], new Uint8Array()); G.seedFile("x", ["Citrus", "Archive"], new Uint8Array());
  const move = (path: string[], to: string[], name: string) => { const f = byPath(path)!; f.parents = [byPath(to)!.id]; f.name = name; };
  move(["My Apps", "Yuzu"], ["Citrus", "Learning", "Flashcards - Yuzu"], "collection & media");
  move(["My Apps", "hub", "yuzu"], ["Citrus", "Learning"], "Flashcards - Yuzu (status)");
  move(["My Apps", "hub", "citrus"], ["Citrus", "00 Hub"], "Citrus");
  move(["My Apps", "Rotas"], ["Citrus", "Work"], "Rotas");
  move(["My Apps"], ["Citrus", "Archive"], "My Apps (old layout)");
  assert.equal(rootFolders("My Apps").length, 0);
  const before = folders().length;
  // the old device, next session: cached ids still point at the moved folders
  newSession(); await push(cacheA, "A"); await writeStatus(status("A2"), cacheA);
  assert.equal((await readPlan(cacheA) as any)?.v, 2); assert.equal((await newRotaFiles({}, cacheA)).files.length, 1);
  // a new device with an empty cache
  newSession(); const cacheB: Record<string, string> = {};
  const B = new DriveSync(cacheB, "B"); const m = await B.pullManifest(); assert.equal(m?.device, "A", "B finds A's collection in its new place");
  await push(cacheB, "B"); await writeStatus(status("B"), cacheB);
  assert.equal((await readPlan(cacheB) as any)?.v, 2); assert.equal((await newRotaFiles({}, cacheB)).files.length, 1);
  assert.equal(rootFolders("My Apps").length, 0, "no My Apps again at the top of My Drive");
  assert.equal(folders().length, before, "no new folders anywhere");
  const statusFiles = [...G.files.values()].filter((f) => f.name === "status.json" && !f.trashed);
  assert.equal(statusFiles.length, 1); assert.equal(statusFiles[0].parents[0], byPath(["Citrus", "Learning", "Flashcards - Yuzu (status)"])!.id);
});

test("two folders carry the tag: the oldest is used, and the path is never used once a tag exists", async () => {
  G = fakeGoogle(); newSession();
  G.seedFile("old.xlsx", ["Citrus", "Work", "Rotas"], new Uint8Array([1]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const first = byPath(["Citrus", "Work", "Rotas"])!; first.props = { citrusApp: "rotas" };
  G.seedFile("new.xlsx", ["Elsewhere", "Rotas"], new Uint8Array([2]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const second = byPath(["Elsewhere", "Rotas"])!; second.props = { citrusApp: "rotas" }; second.c = (first.c ?? first.t ?? 0) + 60_000; second.t = second.c;
  const cache: Record<string, string> = {};
  assert.equal(await findFolders(PATHS.rotas, cache, true), first.id);
  assert.deepEqual((await newRotaFiles({}, cache)).files.map((f) => f.name), ["old.xlsx"]);
  assert.equal(rootFolders("My Apps").length, 0, "no My Apps/Rotas made beside the tagged one");
});

test("a failed tag lookup is an error, never read as \"nothing tagged\" (that would make a twin by path)", async () => {
  G = fakeGoogle(); newSession();
  G.fail = (u) => (u.pathname === "/drive/v3/files" && /citrusApp/.test(u.searchParams.get("q") ?? "") ? 500 : null);
  await assert.rejects(findFolders(PATHS.collection, {}, true));
  G.fail = null; assert.equal(rootFolders("My Apps").length, 0);
});
