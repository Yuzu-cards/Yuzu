// WP18: render and recompute performance — data vs display versions, cached Today pieces, incremental mastery, the queue's
// single pass, memoised note fingerprints, chunked backup JSON, object URLs let go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store, RevMap, jsonBlob, interleaveBySystem } from "../src/lib/store.ts";
import type { Card, Note, Review } from "../src/lib/model.ts";
import { retrievability } from "../src/scheduler/fsrs.ts";

const DAY = 86400000;
function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }; }

/** A store with a random collection in memory (no database: saves fail quietly, which these tests don't need). */
function seeded(seed = 1, n = 600) {
  const s = new Store(); const r = rng(seed); const now = Date.now();
  (s as any).touch = () => {}; (s as any).persist = async (_w: string, p: Promise<unknown>) => p.catch(() => undefined);
  s.notetypes.set("t", { id: "t", name: "Basic", kind: "standard", fields: ["Front", "Back"], templates: [], css: "" } as any);
  const systems = ["Cardio", "Renal", "Neuro", "GI"]; const decks = ["Med::A::x", "Med::B::y::z", "German::Words", "Med::A::w"];
  for (let i = 0; i < n; i++) {
    const nid = "n" + i; const sys = systems[Math.floor(r() * systems.length)];
    s.notes.set(nid, { id: nid, ntid: "t", guid: nid, fields: ["front " + i, "back " + i], tags: r() < 0.9 ? ["auto::System::" + sys] : [], created: i, modified: i } as Note);
    const cards = 1 + Math.floor(r() * 2);
    for (let k = 0; k < cards; k++) {
      const st = r(); const state = st < 0.5 ? "new" : st < 0.6 ? "learning" : st < 0.65 ? "relearning" : "review";
      const id = `c${i}-${k}`; const due = state === "new" ? Math.floor(r() * 50) : now + (r() - 0.6) * 10 * DAY;
      s.cards.set(id, { id, nid, ord: k, state, suspended: r() < 0.05, flag: 0, due, stability: state === "new" ? 0 : 1 + r() * 200, difficulty: 5, reps: state === "new" ? 0 : 1 + Math.floor(r() * 6), lapses: 0, lastReview: state === "new" ? 0 : now - r() * 30 * DAY, step: 0, created: Math.floor(r() * 5), mod: 0, source: decks[Math.floor(r() * decks.length)] } as Card);
    }
  }
  s.loaded = true; return s;
}

/** Store.queue as it was before WP18 (copy of the old code), to prove the single-pass version returns the same session. */
function oldQueue(s: Store, path: string, now: number, view: any = "decks", only: "all" | "due" | "new" = "all"): Card[] {
  const st = s as any;
  const cards = s.cardsIn(path, view).filter((c) => !c.suspended);
  const learning = only === "new" ? [] : cards.filter((c) => (c.state === "learning" || c.state === "relearning") && c.due <= now).sort((a, b) => a.due - b.due);
  let review = only === "new" ? [] : cards.filter((c) => c.state === "review" && c.due <= now);
  const order = s.settings.dueOrder;
  if (order === "forgotten") review.sort((a, b) => retrievability((now - a.lastReview) / DAY, a.stability) - retrievability((now - b.lastReview) / DAY, b.stability));
  else if (order === "rescue") review.sort((a, b) => retrievability((now - b.lastReview) / DAY, b.stability) - retrievability((now - a.lastReview) / DAY, a.stability));
  else review.sort((a, b) => a.due - b.due);
  if (s.settings.maxReviewsPerDay > 0) review = review.slice(0, Math.max(0, s.settings.maxReviewsPerDay - s.reviewedToday(now).reviews));
  review = interleaveBySystem(review, (c) => s.notes.get(c.nid)?.tags.find((t) => t.startsWith("auto::System::")) ?? c.source.split("::").slice(0, 3).join("::"));
  const budget = only === "due" ? 0 : Math.max(0, s.settings.newPerDay - s.reviewedToday(now).newCards);
  const byCat = new Map<string, Card[]>();
  for (const c of cards) if (c.state === "new") { const k = c.source.split("::").slice(0, 3).join("::"); (byCat.get(k) ?? byCat.set(k, []).get(k)!).push(c); }
  for (const list of byCat.values()) list.sort((a, b) => a.due - b.due || a.created - b.created);
  const seenNotes = new Set<string>(); const bury = s.settings.burySiblings;
  if (bury) {
    const start = s.dayStart(now);
    for (let i = s.reviews.length - 1; i >= 0 && s.reviews[i].ts >= start; i--) { const c = s.cards.get(s.reviews[i].cid); if (c) seenNotes.add(c.nid); }
    for (const c of learning) seenNotes.add(c.nid);
    review = review.filter((c) => { if (seenNotes.has(c.nid)) return false; seenNotes.add(c.nid); return true; });
  }
  const fresh: Card[] = []; const lists = [...byCat.values()];
  for (let i = 0; fresh.length < budget && lists.some((l) => l.length); i++) {
    const l = lists[i % lists.length]; if (!l.length) continue;
    const c = l.shift()!; if (bury) { if (seenNotes.has(c.nid)) continue; seenNotes.add(c.nid); } fresh.push(c);
  }
  const out: Card[] = [...learning];
  const step = fresh.length ? Math.max(1, Math.floor((review.length + fresh.length) / fresh.length)) : Infinity;
  let fi = 0;
  for (let i = 0; i < review.length; i++) { out.push(review[i]); if ((i + 1) % step === 0 && fi < fresh.length) out.push(fresh[fi++]); }
  while (fi < fresh.length) out.push(fresh[fi++]);
  void st; return out;
}

test("wp18: orderedTaker hands items out exactly as a stable sort would", () => {
  const r = rng(7);
  for (let t = 0; t < 400; t++) {
    const l = Array.from({ length: Math.floor(r() * 150) }, (_, i) => ({ v: Math.floor(r() * 8), i }));
    const cmp = (a: { v: number }, b: { v: number }) => a.v - b.v; const want = [...l].sort(cmp);
    const tk = Store.orderedTaker(l, cmp, 1 + (t % 40)); const got: typeof l = []; while (tk.left()) got.push(tk.take());
    assert.deepEqual(got, want);
  }
});

test("wp18: the single-pass queue returns the same session as before (orders, budgets, burying, scopes)", () => {
  for (const seed of [1, 2]) {
    const s = seeded(seed); const now = Date.now();
    for (const dueOrder of ["due", "forgotten", "rescue"] as const) for (const bury of [true, false]) for (const newPerDay of [0, 7, 500]) {
      s.settings = { ...s.settings, dueOrder, burySiblings: bury, newPerDay, maxReviewsPerDay: newPerDay === 7 ? 15 : 0 };
      for (const only of ["all", "due", "new"] as const) for (const [path, view] of [["", "decks"], ["Med", "decks"], ["Med::A", "decks"], ["Cardio", "systems"]] as const) {
        assert.deepEqual(s.queue(path, now, view as any, only).map((c) => c.id), oldQueue(s, path, now, view, only).map((c) => c.id), `${seed} ${dueOrder} ${bury} ${newPerDay} ${only} ${path}`);
      }
    }
  }
});

test("wp18: display-only changes keep the derived numbers; data changes drop them", () => {
  const s = seeded(4); let calls = 0; s.subscribe(() => calls++);
  const v0 = s.getVersion(), d0 = s.getDataVersion(); const tree = s.tree(); const mastery = s.masteryBySystem();
  s.uiBump(); s.openOnToday("workload"); (s as any).setSync("syncing", "Sending");
  assert.equal(calls, 3, "screens still redraw"); assert.ok(s.getVersion() > v0); assert.equal(s.getDataVersion(), d0);
  assert.equal(s.tree(), tree, "tree kept"); assert.equal(s.masteryBySystem(), mastery, "mastery kept");
  assert.equal(s.takePendingOpen("workload"), true);
  (s as any).bump(); assert.equal(s.getDataVersion(), d0 + 1); assert.notEqual(s.tree(), tree, "tree rebuilt after a data change");
});

test("wp18: an answer moves one card between mastery buckets instead of a full recount (and matches one)", async () => {
  const s = seeded(5, 300); const now = Date.now();
  s.masteryBySystem(now); const before = (s as any).mbsCache;
  const ids = [...s.cards.values()].filter((c) => !c.suspended && s.notes.get(c.nid)!.tags.length).slice(0, 25).map((c) => c.id);
  let t = now; for (const [i, id] of ids.entries()) { t += 1000; await s.answer(id, ((i % 4) + 1) as any, 4000 + i * 100, t); }
  const inc = s.masteryBySystem(t); assert.equal((s as any).mbsCache.at, before.at, "no recount happened");
  (s as any).mbsCache = null; const full = s.masteryBySystem(t);
  for (const [k, e] of full) { const m = inc.get(k)!; for (const f of ["unseen", "learning", "developing", "mastered", "durable", "total"] as const) assert.equal(m[f], e[f], `${k}.${f}`); }
});

test("wp18: the day turning over redraws without a mastery recount", () => {
  const s = seeded(6, 100); const m = s.masteryBySystem(); s.dayTurned(); assert.equal(s.masteryBySystem(), m);
});

test("wp18: note fingerprints are walked only after a note changed", () => {
  const s = seeded(8, 200); assert.ok(s.notes instanceof RevMap);
  const k1 = s.refsKey(); const raw = (s as any).refsKeyRaw.bind(s); let walks = 0; (s as any).refsKeyRaw = () => { walks++; return raw(); };
  assert.equal(s.refsKey(), k1); assert.equal(walks, 0);
  const n = s.notes.get("n1")!; s.notes.set("n1", { ...n, modified: n.modified + 5 });
  assert.notEqual(s.refsKey(), k1); assert.equal(walks, 1);
  const l1 = s.improveList(); assert.equal(s.improveList(), l1, "improve list cached");
  s.notes.set("n2", { ...s.notes.get("n2")!, tags: ["ask-claude"] }); assert.equal(s.improveList().length, l1.length + 1);
  const c1 = s.sketchyCount(); assert.equal(s.sketchyCount(), c1);
  s.notes.set("n3", { ...s.notes.get("n3")!, tags: ["Sketchy::Micro"] }); assert.equal(s.sketchyCount().notes, c1.notes + 1);
});

test("wp18: the chunked backup file is byte for byte JSON.stringify", async () => {
  const s = seeded(9, 900); s.reviews = Array.from({ length: 5000 }, (_, i) => ({ id: "r" + i, cid: "c1-0", ts: i, rating: 3, state: "review", elapsedDays: 1, scheduledDays: 2, durationMs: 1000 } as unknown as Review));
  const o = { ...s.backup(), skip: undefined, nested: { a: [1, undefined, 2] } } as any; let last = 0;
  const b = await jsonBlob(o, (f) => { assert.ok(f >= last); last = f; }, 250);
  assert.equal(await b.text(), JSON.stringify(o)); assert.equal(last, 1);
  assert.equal(await (await s.backupBlob(true)).text().then((t) => JSON.parse(t).quick), true);
});

test("wp18: media object URLs are let go (cleared or least recently used)", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const made: string[] = [], revoked: string[] = []; const C = URL.createObjectURL, R = URL.revokeObjectURL;
  (URL as any).createObjectURL = () => { const u = "blob:x" + made.length; made.push(u); return u; }; (URL as any).revokeObjectURL = (u: string) => revoked.push(u);
  try {
    const s = new Store(); (s as any).mediaLoaded = true;
    for (let i = 0; i < 405; i++) s.media.set(`f${i}.png`, new Blob(["x"]));
    for (let i = 0; i < 405; i++) s.mediaUrl(`f${i}.png`);
    assert.equal(s.mediaUrl("f404.png"), made[404], "cached");
    t.mock.timers.tick(31000); assert.equal(revoked.length, 5, "the oldest beyond 400 are revoked");
    (s as any).dropMediaUrls(); assert.equal(revoked.length, 5, "not at once: a picture on screen keeps working");
    t.mock.timers.tick(31000); assert.equal(revoked.length, 405);
  } finally { (URL as any).createObjectURL = C; (URL as any).revokeObjectURL = R; }
});
