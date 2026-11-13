// "Why so many reviews?" — a rules engine over your own data (the Orange 8.13.0 pattern): it ranks the likely causes of a heavy
// workload, shows the evidence for each, and offers one fix per cause. Nothing changes until you tap the fix; every fix has an Undo.
import type { Card, Review } from "./model";

const DAY = 86400000;
export type FixKind = "newPerDay" | "retention" | "suspendLeeches" | "spread" | "tune" | "reminders";
export interface Cause { id: string; title: string; evidence: string; perDay: number; fix?: { kind: FixKind; label: string; value?: number; ids?: string[] } }
export interface WorkloadInput {
  now: number; cards: Iterable<Card>; reviews: Review[]; newPerDay: number; desiredRetention: number; decay: number; leechThreshold: number;
  fitAt: number | null; overdue: number; dueToday: number; remindersOn: boolean; dayOf: (ts: number) => string;
}
export interface Diagnosis { perDay: number; dueToday: number; causes: Cause[]; /** days the pace is averaged over: 30, or fewer when the history is shorter */ days: number }

/** Share of today's reviews that are the extra cost of aiming above 90%: intervals scale with (R^(−1/decay) − 1) under FSRS-6
 *  (scheduler/fsrs.ts nextInterval), reviews with 1/interval, so at 90% the same cards would cost (1 − share) of today's load. */
export function extraShare(target: number, decay: number): number {
  const d = -Math.abs(decay || 0.5); const I = (r: number) => Math.pow(r, 1 / d) - 1;
  return Math.max(0, 1 - I(target) / I(0.9));
}
/** How many more reviews a target recall costs than 90%, as a fraction (1.48 = 148% more): the load ratio I(0.9)/I(target) − 1. */
export function extraMore(target: number, decay: number): number { const x = extraShare(target, decay); return x >= 1 ? Infinity : 1 / (1 - x) - 1; }
const n0 = (n: number) => Math.round(n).toLocaleString();

export function diagnoseWorkload(i: WorkloadInput): Diagnosis {
  const from = i.now - 30 * DAY; const recent = i.reviews.filter((r) => r.ts >= from && r.ts <= i.now);
  // Average over the history there is: 30 days, or the calendar days since the first review when that is shorter.
  let firstTs = Infinity; for (const r of i.reviews) if (r.ts < firstTs) firstTs = r.ts;
  const firstDay = firstTs === Infinity ? i.dayOf(i.now) : i.dayOf(firstTs);
  const isoDays = (a: string, b: string) => Math.round((new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / DAY);
  const win = Math.max(1, Math.min(30, isoDays(firstDay, i.dayOf(i.now)) + 1));
  const perDay = recent.length / win; const causes: Cause[] = [];
  const first = new Map<string, number>(); for (const r of i.reviews) { const f = first.get(r.cid); if (f === undefined || r.ts < f) first.set(r.cid, r.ts); }
  const cards = [...i.cards];
  // 1. A backlog: cards already late. Spread over a week, the most fragile first.
  if (i.overdue >= 50) causes.push({ id: "backlog", title: `${n0(i.overdue)} cards are overdue`, perDay: i.overdue / 7,
    evidence: `They were due before today${perDay >= 10 ? `; at your pace of ${n0(perDay)} reviews a day that's ${n0(Math.max(1, i.overdue / perDay))} days of work on top of what comes due` : ""}. Late cards are also forgotten more, so each brings extra reviews. Spread over a week, that's about ${n0(i.overdue / 7)} extra a day, the most fragile first.`,
    fix: { kind: "spread", label: "Spread them over 7 days" } });
  // 2. New cards: everything started in the last 30 days and still in its busy first weeks.
  const young = recent.filter((r) => (first.get(r.cid) ?? 0) >= from).length; const youngShare = recent.length ? young / recent.length : 0;
  if (i.newPerDay > 0 && recent.length >= 100 && youngShare >= 0.35) { const to = Math.max(5, Math.round(i.newPerDay * 0.6 / 5) * 5); causes.push({ id: "new", title: `New cards make up ${Math.round(youngShare * 100)}% of your reviews`, perDay: young / win,
    evidence: `${n0(young / win)} of your ${n0(perDay)} reviews a day are cards you started in the last ${win} days. Each new card brings about 10 reviews in its first year, so ${i.newPerDay} a day keeps adding load for months.`,
    fix: to < i.newPerDay ? { kind: "newPerDay", label: `New cards: ${i.newPerDay} → ${to} a day`, value: to } : undefined }); }
  // 3. Leeches: a few cards you keep forgetting eat a lot of time.
  const leeches = cards.filter((c) => !c.suspended && c.lapses >= i.leechThreshold); const lset = new Set(leeches.map((c) => c.id));
  const lrev = recent.filter((r) => lset.has(r.cid)).length;
  if (leeches.length >= 5 && (lrev / win >= 2 || (recent.length && lrev / recent.length >= 0.05))) causes.push({ id: "leeches", title: `${n0(leeches.length)} leech cards keep coming back`, perDay: lrev / win,
    evidence: `Cards forgotten ${i.leechThreshold}+ times took ${n0(lrev)} reviews in ${win} days (${Math.round((lrev / Math.max(1, recent.length)) * 100)}% of all). They usually need rewriting, not more repetition.`,
    fix: { kind: "suspendLeeches", label: `Pause the ${n0(leeches.length)} leeches`, ids: leeches.map((c) => c.id) } });
  // 4. A high target recall: each point above 90% costs more reviews than the last.
  if (i.desiredRetention >= 0.92) { const x = extraShare(i.desiredRetention, i.decay); const mature = recent.filter((r) => r.state === "review").length / win; const more = extraMore(i.desiredRetention, i.decay); if (x > 0.08) causes.push({ id: "retention", title: `Target recall is ${Math.round(i.desiredRetention * 100)}%`, perDay: mature * x,
    evidence: `At ${Math.round(i.desiredRetention * 100)}% your cards come back sooner: about ${Math.round(more * 100)}% more reviews than at 90%. Of the ${n0(mature)} learned cards you review a day, roughly ${n0(mature * x)} are that extra.`,
    fix: { kind: "retention", label: "Set target recall to 90%", value: 0.9 } }); }
  // 5. Days off: the 14 whole days before today (from the first review on). A day off doesn't add reviews, it moves them to the next
  // day; the only extra is the lapse penalty of being late (about 10% of the moved reviews), so that is all this cause counts.
  const studied = new Set(recent.map((r) => i.dayOf(r.ts))); const past = new Set<string>();
  for (let k = 1; k <= 14; k++) { const d = i.dayOf(i.now - k * DAY); if (d >= firstDay) past.add(d); }
  const missed = [...past].filter((d) => !studied.has(d)).length;
  if (recent.length >= 50 && missed >= 4) causes.push({ id: "missed", title: `No reviews on ${missed} of the last ${past.size} days`, perDay: (perDay * missed * 0.1) / past.size,
    evidence: "What falls due on a day off waits for the next one: the reviews are moved, not added. The cost is the extra forgetting while they wait (about 1 in 10 comes back as a lapse), and long catch-ups are harder than short daily sessions.",
    fix: i.remindersOn ? undefined : { kind: "reminders", label: "Turn on a daily reminder" } });
  // 6. The scheduler isn't tuned to your memory.
  if (i.reviews.length >= 1000 && (!i.fitAt || i.now - i.fitAt > 60 * DAY)) causes.push({ id: "tune", title: i.fitAt ? "The scheduler hasn't been tuned for 2 months" : "The scheduler isn't tuned to your memory yet", perDay: perDay * 0.05,
    evidence: "Tuning fits the intervals to your own review history; with default settings cards often come back sooner than you need.",
    fix: { kind: "tune", label: "Tune to my history" } });
  causes.sort((a, b) => b.perDay - a.perDay);
  return { perDay, dueToday: i.dueToday, causes, days: win };
}
