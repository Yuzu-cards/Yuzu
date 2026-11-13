// WP05: settings merge field by field (05-2), device-only fields never travel, old devices' settings still merge, absurd values are
// clamped (10-7); status.json in the bin is recreated, not patched forever (06-7).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { fakeGoogle } from "./fake-google.ts";

const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k) };
const G = fakeGoogle();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => { const u = String(url); if (/googleapis\.com/.test(u)) return G.fetchImpl(u, init ?? {}); return realFetch(url, init); }) as any;

const { mergeSettings, stampChanges, sanitizeSettings, shareable, withoutDeviceFields, DEVICE_ONLY } = await import("../src/lib/settingsync.ts");
const { DEFAULT_SETTINGS } = await import("../src/lib/store.ts");
const { writeStatus, readStatus, PATHS } = await import("../src/lib/drive.ts");
const { setRetryScale } = await import("../src/lib/google.ts");
before(() => { setRetryScale(0.002); localStorage.setItem("yuzu-google", JSON.stringify({ access: "tok1", expires: Date.now() + 3600e3, email: "a@example.com", scope: "drive" })); });

type S = typeof DEFAULT_SETTINGS & { updatedAt?: number; stamps?: Record<string, number> };
const base = (over: Partial<S> = {}): S => JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, newPerDay: 31, deviceName: "x", updatedAt: 1000, ...over }));
/** A device: its settings, a save (stamped) and a sync with the "remote" settings file (pull + merge, then push its share). */
function device(name: string, s: S) {
  const d = {
    s: { ...s, deviceName: name } as S,
    save(patch: Partial<S>, t: number) { d.s = stampChanges(d.s, sanitizeSettings({ ...d.s, ...patch } as S, DEFAULT_SETTINGS), t, Object.keys(patch)); },
    sync(remote: { file: any }) { if (remote.file) d.s = mergeSettings(d.s, remote.file).settings; remote.file = JSON.parse(JSON.stringify({ ...shareable(d.s), updatedAt: d.s.updatedAt })); },
  };
  return d;
}

test("05-2: a colour change on B does not undo New cards/day set on A", () => {
  const remote = { file: null as any };
  const A = device("A", base()), B = device("B", base());
  A.sync(remote); B.sync(remote);
  A.save({ newPerDay: 45 }, 2000);         // A: a study setting
  B.save({ theme: "night" }, 3000);        // B, not pulled yet: only its colours
  A.sync(remote); B.sync(remote); A.sync(remote);
  assert.equal(A.s.newPerDay, 45); assert.equal(B.s.newPerDay, 45);
  assert.equal(B.s.theme, "night"); assert.equal(A.s.theme, "yuzu", "theme never travels");
  assert.equal(B.s.updatedAt, 2000, "a device-only change does not move the synced time");
});

test("05-2: two different study settings changed on two devices both survive; the later change of one field wins", () => {
  const remote = { file: null as any };
  const A = device("A", base()), B = device("B", base());
  A.sync(remote); B.sync(remote);
  A.save({ newPerDay: 45, deadlines: [{ id: "s1", name: "Step 1", date: "2027-03-01", view: "decks", path: "" }] as any }, 2000);
  B.save({ dailyGoal: 200, hiddenFields: ["Sketchy"] }, 2500);
  B.save({ newPerDay: 50 }, 2600); // later than A's 45
  A.sync(remote); B.sync(remote); A.sync(remote);
  for (const d of [A, B]) { assert.equal(d.s.newPerDay, 50); assert.equal(d.s.dailyGoal, 200); assert.deepEqual(d.s.hiddenFields, ["Sketchy"]); assert.equal(d.s.deadlines.length, 1); }
});

test("05-2: google fields merge one by one (rota on one device, Drive-is-master on the other)", () => {
  const remote = { file: null as any };
  const A = device("A", base()), B = device("B", base());
  A.sync(remote); B.sync(remote);
  A.save({ google: { ...A.s.google, rota: { "2026-11": { "1": "D2" } } } }, 2000);
  B.save({ google: { ...B.s.google, driveMedia: false } }, 2100);
  A.sync(remote); B.sync(remote); A.sync(remote);
  for (const d of [A, B]) { assert.deepEqual(d.s.google.rota, { "2026-11": { "1": "D2" } }); assert.equal(d.s.google.driveMedia, false); }
});

test("device-only fields never leave the device and never come in", () => {
  const share = shareable(base({ theme: "night", deviceName: "Deck", sync: { owner: "o", repo: "r", token: "secret", auto: true } } as any));
  for (const k of DEVICE_ONLY) assert.equal(k in share, false, k);
  const evil = { ...base(), updatedAt: 9e12, theme: "gameboy", deviceName: "S25 Ultra", sync: { owner: "attacker", repo: "evil", token: "", auto: true, backend: "github" }, swipe: false };
  const m = mergeSettings(base({ theme: "night", deviceName: "Deck" } as any), evil).settings;
  assert.equal(m.theme, "night"); assert.equal(m.deviceName, "Deck"); assert.equal(m.sync.owner, ""); assert.equal(m.swipe, true);
  const fromFile = withoutDeviceFields(evil); assert.equal("sync" in fromFile, false); assert.equal("deviceName" in fromFile, false); assert.equal("updatedAt" in fromFile, false);
});

test("an old device's settings file (one updatedAt, no stamps) still merges sensibly", () => {
  const remote = { file: null as any };
  const A = device("A", base());
  A.sync(remote);
  A.save({ newPerDay: 45 }, 2000);
  A.sync(remote);
  // An old Yuzu pulls (whole object, newer wins), changes the goal later, pushes its whole object with a later updatedAt and A's stamps kept.
  const old = { ...remote.file, dailyGoal: 120, updatedAt: 3000 };
  remote.file = old;
  A.sync(remote);
  assert.equal(A.s.dailyGoal, 120, "the old device's later change arrives"); assert.equal(A.s.newPerDay, 45);
  // A changes something after; the old device's write is older than it
  A.save({ newPerDay: 60 }, 4000); A.sync(remote);
  assert.equal(remote.file.newPerDay, 60); assert.equal(remote.file.dailyGoal, 120);
  assert.ok(remote.file.updatedAt >= 4000, "an old device takes the whole object only when its updatedAt is newer");
  // A legacy file older than our own change to a field does not undo it
  const stale = { ...base(), newPerDay: 10, updatedAt: 3500 };
  const m = mergeSettings(A.s, stale).settings; assert.equal(m.newPerDay, 60);
  // A device upgraded from an old version (no stamps here yet) takes a newer stamped field and keeps the rest
  const legacyHere = base({ updatedAt: 1500, dailyGoal: 77 } as any);
  const m2 = mergeSettings(legacyHere, { ...shareable(A.s), updatedAt: A.s.updatedAt, stamps: { "*": 1000, newPerDay: 4000 } }).settings;
  assert.equal(m2.newPerDay, 60); assert.equal(m2.dailyGoal, 77, "an unstamped field older than this device's whole-object time stays");
});

test("10-7: absurd settings are clamped wherever they come from", () => {
  const s = sanitizeSettings({ ...base(), newPerDay: -5, dailyGoal: 0, maxReviewsPerDay: -1, rollover: 99, scheduler: { ...DEFAULT_SETTINGS.scheduler, desiredRetention: 0, maximumInterval: 1e9 }, easyDays: [1, 2], dueOrder: "nope", hiddenFields: "x" } as any, DEFAULT_SETTINGS);
  assert.equal(s.newPerDay, 0); assert.equal(s.dailyGoal, 1); assert.equal(s.maxReviewsPerDay, 0); assert.equal(s.rollover, 23);
  assert.equal(s.scheduler.desiredRetention, 0.7); assert.equal(s.scheduler.maximumInterval, 36500);
  assert.deepEqual(s.easyDays, DEFAULT_SETTINGS.easyDays); assert.equal(s.dueOrder, DEFAULT_SETTINGS.dueOrder); assert.deepEqual(s.hiddenFields, DEFAULT_SETTINGS.hiddenFields);
  const ok = sanitizeSettings({ ...base(), newPerDay: 33, dailyGoal: 240, scheduler: { ...DEFAULT_SETTINGS.scheduler, desiredRetention: 0.92 } } as any, DEFAULT_SETTINGS);
  assert.equal(ok.newPerDay, 33); assert.equal(ok.dailyGoal, 240); assert.equal(ok.scheduler.desiredRetention, 0.92);
  assert.equal(sanitizeSettings({ ...base(), newPerDay: 1e6 } as any, DEFAULT_SETTINGS).newPerDay, 9999);
});

test("06-7: status.json binned on Drive is recreated, not patched in the bin", async () => {
  const cache: Record<string, string> = {};
  const status = (device: string, n: number) => ({ app: "yuzu", device, updatedAt: new Date().toISOString(), today: { date: "2026-11-13", done: false, items: [] }, extra: { reviewedToday: n } }) as any;
  const id1 = await writeStatus(status("Phone", 9), cache);
  assert.equal(JSON.parse(G.at(PATHS.hub).get("status.json")!).device, "Phone");
  // the user tidies Drive: status.json goes to the bin
  await G.fetchImpl(`https://www.googleapis.com/drive/v3/files/${id1}`, { method: "PATCH", headers: { Authorization: "Bearer tok1" }, body: JSON.stringify({ trashed: true }) });
  assert.equal(G.at(PATHS.hub).has("status.json"), false);
  const id2 = await writeStatus(status("Phone", 10), cache);
  assert.notEqual(id2, id1, "a new file"); assert.equal(JSON.parse(G.at(PATHS.hub).get("status.json")!).extra.reviewedToday, 10, "visible to Citrus again");
  // readStatus (the check before a write) also notices a binned file and forgets its id
  await G.fetchImpl(`https://www.googleapis.com/drive/v3/files/${id2}`, { method: "DELETE", headers: { Authorization: "Bearer tok1" } });
  const cur = await readStatus(cache); assert.equal(cur.id, null); assert.equal(cache.statusId, undefined);
  const id3 = await writeStatus(status("Deck", 3), cache, true); const again = await readStatus(cache);
  assert.equal(again.id, id3); assert.equal(again.status?.device, "Deck");
  const known = await readStatus(cache, again.mark); assert.equal(known.status, null, "the content is read only when the file changed since");
});
