// Yuzu's FSRS-6 against the reference implementation (ts-fsrs, open-spaced-repetition, MIT): 600 random review histories
// (5,163 reviews; default and tuned weights; same-day reviews, long gaps, lapses) generated with its FSRS6Algorithm and
// kept in test/fixtures/fsrs6-reference.json. Plus the scheduling rules around it: button order, learning and relearning.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEFAULT_W, DEFAULT_CONFIG, DAY, updateMemory, intervalFor, rate, previewIntervals } from "../src/scheduler/fsrs.ts";
import type { Card, Rating } from "../src/lib/model.ts";

const V = JSON.parse(fs.readFileSync(new URL("./fixtures/fsrs6-reference.json", import.meta.url), "utf8"));

test("memory state and intervals match the FSRS-6 reference on 5,163 reviews", () => {
  let n = 0, worstS = 0, worstD = 0, ivl = 0;
  for (const c of V.cases) {
    const w = c.w === "default" ? DEFAULT_W : V.tuned; let card = { stability: 0, difficulty: 0, reps: 0 };
    for (const st of c.steps) {
      const m = updateMemory(w, card, st.g, st.t); card = { ...m, reps: card.reps + 1 }; n++;
      worstS = Math.max(worstS, Math.abs(m.stability - st.s) / Math.max(1e-3, st.s)); worstD = Math.max(worstD, Math.abs(m.difficulty - st.d));
      if (intervalFor(m.stability, 0.9, 36500, w) !== st.i90 || intervalFor(m.stability, 0.85, 36500, w) !== st.i85) ivl++;
    }
  }
  assert.ok(n > 5000, `${n} reviews`);
  assert.ok(worstS < 1e-6, `stability off by ${worstS} (relative)`);
  assert.ok(worstD < 1e-6, `difficulty off by ${worstD}`);
  assert.equal(ivl, 0, "every interval identical at 90% and 85%");
});

const T0 = Date.UTC(2026, 10, 1, 9);
const fresh = (): Card => ({ id: "c1", nid: "n1", ord: 0, state: "new", suspended: false, flag: 0, due: 0, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: 0, step: 0, created: 0, mod: 0, source: "Medicine" } as Card);
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

test("review buttons never show the same interval: Hard < Good < Easy (random cards, any retention)", () => {
  let checked = 0;
  for (let k = 0; k < 3000; k++) {
    const s = 0.2 + rnd() * (rnd() < 0.5 ? 5 : 400); const d = 1 + rnd() * 9; const elapsed = Math.floor(rnd() * s * 2);
    const card: Card = { ...fresh(), state: "review", stability: s, difficulty: d, reps: 5, lastReview: T0 - elapsed * DAY, due: T0 };
    const cfg = { ...DEFAULT_CONFIG, desiredRetention: 0.8 + rnd() * 0.17 };
    const iv = ([2, 3, 4] as Rating[]).map((g) => rate(card, g, T0, cfg).intervalDays);
    assert.ok(iv[0] >= 1 && iv[0] < iv[1] && iv[1] < iv[2], `S=${s.toFixed(2)} → ${iv.join("/")}`); checked++;
    assert.equal(rate(card, 1, T0, cfg).card.state, "relearning", "Again on a review card → relearning");
  }
  assert.equal(checked, 3000);
  // the preview the buttons show agrees with what pressing them does
  const card: Card = { ...fresh(), state: "review", stability: 1.4, difficulty: 6, reps: 4, lastReview: T0 - DAY, due: T0 };
  const p = previewIntervals(card, T0);
  assert.notEqual(p[2], p[3]); assert.notEqual(p[3], p[4]);
});

test("the maximum interval caps every button", () => {
  const card: Card = { ...fresh(), state: "review", stability: 30000, difficulty: 2, reps: 30, lastReview: T0 - 20000 * DAY, due: T0 };
  const cfg = { ...DEFAULT_CONFIG, maximumInterval: 365 };
  for (const g of [2, 3, 4] as Rating[]) assert.ok(rate(card, g, T0, cfg).intervalDays <= 365);
});

test("learning steps: new → 1 min → 10 min → graduates; Again restarts; Easy graduates at once (≥ 4 days)", () => {
  const cfg = DEFAULT_CONFIG; // steps [1, 10] minutes
  let c = fresh(); let r = rate(c, 3, T0, cfg); c = r.card;
  assert.equal(c.state, "learning"); assert.equal(c.due - T0, 10 * 60000, "Good on a new card → the second step (10 min)");
  r = rate(c, 1, T0 + 10 * 60000, cfg); c = r.card; assert.equal(c.state, "learning"); assert.equal(c.step, 0); assert.equal(c.due - (T0 + 10 * 60000), 60000, "Again → back to 1 min");
  r = rate(c, 3, T0 + 11 * 60000, cfg); c = r.card; assert.equal(c.step, 1);
  r = rate(c, 3, T0 + 21 * 60000, cfg); c = r.card; assert.equal(c.state, "review", "Good on the last step graduates"); assert.ok(r.intervalDays >= 1);
  const e = rate(fresh(), 4, T0, cfg); assert.equal(e.card.state, "review"); assert.ok(e.intervalDays >= 4, `Easy on a new card: ${e.intervalDays} d`);
  const h = rate(fresh(), 2, T0, cfg); assert.equal(h.card.state, "learning"); assert.equal(h.card.step, 0, "Hard stays on the step");
});

test("relearning: a lapse counts once, goes through 10 min, then back to review with a shorter interval", () => {
  const cfg = DEFAULT_CONFIG;
  let c: Card = { ...fresh(), state: "review", stability: 40, difficulty: 5, reps: 8, lastReview: T0 - 40 * DAY, due: T0 };
  const before = rate(c, 3, T0, cfg).intervalDays;
  let r = rate(c, 1, T0, cfg); c = r.card;
  assert.equal(c.state, "relearning"); assert.equal(c.lapses, 1); assert.equal(c.due - T0, 10 * 60000);
  r = rate(c, 1, T0 + 10 * 60000, cfg); c = r.card; assert.equal(c.lapses, 1, "Again again in relearning isn't a second lapse");
  r = rate(c, 3, T0 + 20 * 60000, cfg); c = r.card; assert.equal(c.state, "review");
  assert.ok(r.intervalDays < before, `after a lapse ${r.intervalDays} d < ${before} d`);
  assert.ok(c.stability < 40, "stability fell");
});

test("a review record is written for every rating with the state before it", () => {
  const c: Card = { ...fresh(), state: "review", stability: 10, difficulty: 5, reps: 3, lastReview: T0 - 9 * DAY, due: T0 };
  const r = rate(c, 3, T0, DEFAULT_CONFIG, 4200);
  assert.equal(r.review.state, "review"); assert.equal(r.review.rating, 3); assert.equal(r.review.durationMs, 4200); assert.equal(r.review.elapsedDays, 9); assert.equal(r.review.scheduledDays, r.intervalDays);
});
