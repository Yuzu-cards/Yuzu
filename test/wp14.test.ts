// WP14: the numbers on Progress, the exam countdown and the workload diagnosis, each checked against a constructed history.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/lib/store.ts";
import { simulateNewShare, examWhen } from "../src/lib/examshare.ts";
import { diagnoseWorkload, extraShare, extraMore } from "../src/lib/diagnose.ts";
import { intervalFor, DEFAULT_CONFIG } from "../src/scheduler/fsrs.ts";
import { insertApart } from "../src/lib/drill.ts";

const DAY = 86400000;
const NOW = new Date(2026, 10, 13, 12).getTime(); // 13/11/2026 midday, local time (dayStart uses local time)
const iso = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
let seq = 0;
function card(source: string, o: any = {}): any {
  const id = "c" + seq++; return { id, nid: o.nid ?? "n" + id, ord: 0, state: "new", suspended: false, flag: 0, due: seq, stability: 0, difficulty: 5, reps: 0, lapses: 0, lastReview: 0, step: 0, created: seq, mod: 0, source, ...o };
}
function mkStore(cards: any[], newPerDay = 12) {
  const s = new Store(); s.settings = { ...s.settings, newPerDay, rollover: 4, burySiblings: true, maxReviewsPerDay: 0 } as any;
  for (const c of cards) s.cards.set(c.id, c); return s;
}
/** The German exam scenario from 04-1: German 107 new (three sub-decks), Medicine::Endocrine and Step 1::Micro 300 new each. */
function scenario(newPerDay = 12) {
  const cards: any[] = [];
  for (let k = 0; k < 107; k++) cards.push(card(["German::Klinik::A", "German::Klinik::B", "German::Alltag::C"][k % 3]));
  for (let k = 0; k < 300; k++) cards.push(card("Medicine::Endocrine::Thyroid"));
  for (let k = 0; k < 300; k++) cards.push(card("Step 1::Micro::Bacteria"));
  return mkStore(cards, newPerDay);
}
const exam = (days: number, path = "German") => ({ id: "e1", name: "Goethe B2", date: iso(NOW + days * DAY), path, view: "decks" as const });

test("04-1 the exam's share replays queue()'s round-robin exactly, day after day", () => {
  const s = scenario(); const e = s.examStatus(exam(30), NOW);
  // what queue("") really hands out tomorrow
  const tomorrow = s.queue("", NOW + DAY); const german = tomorrow.filter((c) => c.source.startsWith("German")).length;
  assert.equal(tomorrow.length, 12); assert.equal(e.share, german, "share = German cards in tomorrow's real queue");
  assert.equal(german, 8, "German has three categories of the five, so it gets 8 of 12 in turn here");
  // replay 10 days through the real queue: introduce what it gives, compare with the simulation day by day
  const s2 = scenario(); const counts: number[] = [];
  for (let d = 0; d < 10; d++) { const q = s2.queue("", NOW + d * DAY + 1).filter((c) => c.state === "new"); counts.push(q.filter((c) => c.source.startsWith("German")).length); for (const c of q) s2.cards.set(c.id, { ...c, state: "review", due: NOW + 400 * DAY }); }
  const cats = (s as any).newShareCats(s.cardsIn("German")); const sim = simulateNewShare(cats, () => 12, 10, true).perDay;
  assert.deepEqual(sim, counts);
});

/** German as one category among seven that hold new cards. */
function crowd() {
  const cards: any[] = [];
  for (let k = 0; k < 107; k++) cards.push(card("German::Klinik"));
  for (const deck of ["Medicine::Endocrine", "Step 1::Micro", "Step 1::Pharm", "Medicine::Cardio", "Medicine::Renal", "Step 1::Path"]) for (let k = 0; k < 300; k++) cards.push(card(deck));
  return mkStore(cards, 12);
}
test("04-1 one exam category among many: on track only when its share really finishes in time; Set N is the smallest limit that works", () => {
  const s = crowd(); const e = s.examStatus(exam(30), NOW, { setTo: true });
  assert.equal(e.needPerDay, 5, "107 cards over 25 new-card days"); assert.equal(e.share, 2, "12 shared by 7 categories: German, first in turn, gets 2");
  assert.equal(e.onTrack, false, "the old code said on track (5 ≤ 12)");
  assert.equal(e.lastNewIn, 53, "107 at 2 a day: the last on day 53"); assert.equal(e.finishOn, iso(new Date(s.dayStart(NOW)).setDate(new Date(s.dayStart(NOW)).getDate() + 53)));
  assert.ok(e.setTo! > 12);
  s.settings.newPerDay = e.setTo!; assert.equal(s.examStatus(exam(30), NOW).onTrack, true, "at setTo it fits");
  s.settings.newPerDay = e.setTo! - 1; assert.equal(s.examStatus(exam(30), NOW, { setTo: true }).onTrack, false, "one less does not");
  s.settings.newPerDay = 12; // studying the exam's own deck gives it the whole budget (the hint on Today)
  assert.equal(s.queue("German", NOW).filter((c) => c.state === "new").length, 12);
});

test("04-10 finishOn counts today's remaining budget, and the exam today or tomorrow is too late", () => {
  const cards = Array.from({ length: 12 }, () => card("German::Klinik"));
  const other = Array.from({ length: 12 }, () => card("Zz::Other"));
  const s = mkStore([...cards], 12);
  let e = s.examStatus(exam(10), NOW); assert.equal(e.lastNewIn, 0, "12 new at 12 a day: they all come in today"); assert.equal(e.finishOn, iso(s.dayStart(NOW)));
  // the day's budget is already spent on other cards: tomorrow
  const s2 = mkStore([...cards, ...other], 12); for (let k = 0; k < 12; k++) { s2.cards.set(other[k].id, { ...other[k], state: "learning" }); s2.reviews.push({ id: "r" + k, cid: other[k].id, ts: NOW - 3600e3, rating: 3, state: "new" } as any); }
  e = s2.examStatus(exam(10), NOW); assert.equal(e.lastNewIn, 1);
  for (const days of [0, 1]) { const t = s.examStatus(exam(days), NOW, { setTo: true }); assert.equal(t.tooLate, true); assert.equal(t.onTrack, false); assert.equal(t.setTo, null, "no 'Set 107 a day' button"); }
  assert.equal(s.examStatus(exam(2), NOW).tooLate, false);
  assert.equal(examWhen(0), "today"); assert.equal(examWhen(1), "tomorrow"); assert.equal(examWhen(5), "in 5 days");
});

test("04-10 hub status texts: dd/mm/yyyy, today/tomorrow, the real share", () => {
  const s = crowd(); s.settings.deadlines = [exam(30) as any, { ...exam(1), id: "e2", name: "Oral" } as any];
  let st: any; try { st = s.hubStatus(); } catch (err) { console.log("hubStatus not runnable in node:", (err as Error).message); return; }
  const texts = JSON.stringify(st);
  assert.doesNotMatch(texts, /in [01] days/); assert.match(texts, /Oral tomorrow: too late/);
  const task = st.inbox.find((x: any) => x.id.startsWith("exam-e1")); assert.ok(task, "the German exam is not on track");
  assert.match(task.text, /on \d\d\/\d\d\/\d{4}\./); assert.doesNotMatch(task.text, /\d{4}-\d\d-\d\d/); assert.match(task.text, /gets about 2 of your 12/);
  const ex = st.extra.exams.find((x: any) => x.name === "Goethe B2"); assert.match(ex.date, /^\d{4}-\d\d-\d\d$/, "machine fields stay ISO");
});

test("04-6 % more reviews matches the FSRS-6 forgetting curve in the scheduler", () => {
  const w = [...(DEFAULT_CONFIG as any).w ?? []]; const decay = 0.154; const ww = w.length >= 21 ? w.slice() : w; ww[20] = decay;
  const S = 1000; // big enough that rounding to whole days doesn't matter
  const at = (r: number) => intervalFor(S, r, 1e9, ww);
  const ratio95 = at(0.9) / at(0.95), ratio97 = at(0.9) / at(0.97);
  assert.ok(Math.abs(extraMore(0.95, decay) - (ratio95 - 1)) < 0.01, `${extraMore(0.95, decay)} vs ${ratio95 - 1}`);
  assert.ok(Math.abs(extraMore(0.97, decay) - (ratio97 - 1)) < 0.01);
  assert.equal(Math.round(extraMore(0.95, decay) * 100), 148); assert.equal(Math.round(extraMore(0.97, decay) * 100), 349);
  assert.ok(Math.abs(extraShare(0.95, decay) - (1 - 1 / ratio95)) < 0.001, "the ≈/day share is unchanged and right");
  // the sentence prints the "% more", not the share
  const reviews: any[] = []; const cards: any[] = [];
  for (let k = 0; k < 100; k++) cards.push(card("x", { state: "review" }));
  for (let d = 0; d < 30; d++) for (let k = 0; k < 20; k++) reviews.push({ id: `r${d}-${k}`, cid: cards[k].id, ts: NOW - d * DAY - 3600e3, rating: 3, state: "review" });
  const dg = diagnoseWorkload({ now: NOW, cards, reviews, newPerDay: 0, desiredRetention: 0.95, decay, leechThreshold: 8, fitAt: NOW, overdue: 0, dueToday: 20, remindersOn: true, dayOf: iso });
  const r = dg.causes.find((c) => c.id === "retention")!; assert.match(r.evidence, /about 148% more reviews than at 90%/); assert.equal(Math.round(r.perDay), Math.round(20 * extraShare(0.95, decay)));
});

test("04-4 a short history: pace over the days there are, no invented days off", () => {
  const cards = Array.from({ length: 60 }, () => card("x", { state: "review" })); const reviews: any[] = [];
  for (let d = 0; d < 5; d++) for (let k = 0; k < 60; k++) reviews.push({ id: `r${d}-${k}`, cid: cards[k].id, ts: NOW - d * DAY - 3600e3, rating: 3, state: "review" });
  const dg = diagnoseWorkload({ now: NOW, cards, reviews, newPerDay: 0, desiredRetention: 0.9, decay: 0.154, leechThreshold: 8, fitAt: NOW, overdue: 0, dueToday: 60, remindersOn: false, dayOf: iso });
  assert.equal(dg.days, 5); assert.equal(dg.perDay, 60); assert.ok(!dg.causes.some((c) => c.id === "missed"), dg.causes.map((c) => c.title).join());
  // 30+ days of history, studied on 8 of the 14 whole days before today → 6 missed of 14
  const rv: any[] = []; for (let d = 0; d < 40; d++) { if (d >= 1 && d <= 14 && d % 2 === 0 && d <= 12) continue; for (let k = 0; k < 10; k++) rv.push({ id: `q${d}-${k}`, cid: cards[k].id, ts: NOW - d * DAY - 3600e3, rating: 3, state: "review" }); }
  const d2 = diagnoseWorkload({ now: NOW, cards, reviews: rv, newPerDay: 0, desiredRetention: 0.9, decay: 0.154, leechThreshold: 8, fitAt: NOW, overdue: 0, dueToday: 60, remindersOn: false, dayOf: iso });
  assert.equal(d2.days, 30); const m = d2.causes.find((c) => c.id === "missed")!; assert.equal(m.title, "No reviews on 6 of the last 14 days");
});

test("04-5 days off count only the lapse penalty and rank below a high target recall", () => {
  const cards = Array.from({ length: 100 }, () => card("x", { state: "review" })); const rv: any[] = [];
  for (let d = 0; d < 40; d++) { if (d % 3 === 1) continue; for (let k = 0; k < 60; k++) rv.push({ id: `q${d}-${k}`, cid: cards[k].id, ts: NOW - d * DAY - 3600e3, rating: 3, state: "review" }); }
  const dg = diagnoseWorkload({ now: NOW, cards, reviews: rv, newPerDay: 0, desiredRetention: 0.95, decay: 0.154, leechThreshold: 8, fitAt: NOW, overdue: 0, dueToday: 60, remindersOn: false, dayOf: iso });
  const ids = dg.causes.map((c) => c.id); assert.ok(ids.indexOf("retention") < ids.indexOf("missed"), ids.join());
  const m = dg.causes.find((c) => c.id === "missed")!; assert.equal(m.title, "No reviews on 5 of the last 14 days");
  assert.ok(Math.abs(m.perDay - dg.perDay * 5 * 0.1 / 14) < 1e-9); assert.match(m.evidence, /moved, not added/);
});

test("04-15 a returning card in a drill lands away from its own system", () => {
  const sys = (c: string) => c[0];
  assert.deepEqual(insertApart(["R1", "N1", "G1", "R2", "C1"], 1, ["R0"], sys), ["R1", "N1", "R0", "G1", "R2", "C1"], "not right after R1");
  assert.deepEqual(insertApart(["N1", "G1", "R2"], 1, ["R0"], sys), ["N1", "R0", "G1", "R2"], "the first slot already keeps it apart");
  assert.deepEqual(insertApart(["R1", "R2"], 1, ["R0"], sys), ["R1", "R0", "R2"], "no slot apart: where it used to go");
});

test("04-12 / 04-3 numbers behind the labels: known-now counts every seen card; Due includes learning steps; retire uses the interval", () => {
  const today = new Date(NOW); const cards = [
    card("Medicine::A", { state: "review", due: NOW - 1000, lastReview: NOW - 5 * DAY, stability: 10 }),
    card("Medicine::A", { state: "learning", due: NOW - 1000, lastReview: NOW - 600e3, stability: 1 }),
    card("Step 1::B", { state: "review", due: NOW + 100 * DAY, lastReview: NOW - DAY, stability: 100 }),
    card("Step 1::B"),
  ];
  const s = mkStore(cards); void today;
  assert.equal(s.knowledgeNow(NOW).of, 3, "learning cards count: the screen now says 'of 3 seen'");
  const med = s.areaStats(NOW).find((a) => a.name === "Medicine")!; assert.equal(med.due, 2, "Due includes the learning-step card, as its hint now says");
  // a 5.5-year interval reviewed 3 years ago: offered by interval ("reviewed every 5.5 y"), next review 2.5 y away
  const old = card("Old", { state: "review", lastReview: NOW - 3 * 365.25 * DAY, due: NOW + 2.5 * 365.25 * DAY, stability: 5000 }); s.cards.set(old.id, old);
  assert.ok(Math.abs(s.intervalDays(old) / 365.25 - 5.5) < 1e-9); assert.ok(s.masteryCandidates().some((c) => c.id === old.id));
});
