// Progress → "Last 12 weeks": reviews per study day laid out as week columns, with a legend in exact review counts.
import { DAY } from "../scheduler/fsrs";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 12 week-columns of study days (Sunday first; the day rollover from Settings), with reviews and minutes per day. Days after today are null. */
export function heatWeeks(dayStart: number, reviews: { ts: number; durationMs?: number }[]) {
  const dow = new Date(dayStart + 12 * 3600e3).getDay(); const first = dayStart - (77 + dow) * DAY; const today = 77 + dow;
  const n = new Array(84).fill(0), ms = new Array(84).fill(0);
  for (const r of reviews) { const i = Math.floor((r.ts - first) / DAY); if (i >= 0 && i <= today) { n[i]++; ms[i] += Math.min(r.durationMs || 0, 120000); } }
  const max = Math.max(1, ...n);
  const days = n.map((k, i) => (i > today ? null : { at: first + i * DAY, n: k, mins: Math.round(ms[i] / 60000), level: k === 0 ? 0 : k / max > 0.66 ? 3 : k / max > 0.33 ? 2 : 1 }));
  // the legend in exact review counts: level 1 is 1…a, level 2 a+1…b, level 3 b+1…max
  const a = Math.floor(max * 0.33), b = Math.floor(max * 0.66);
  const span = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo}–${hi}`);
  const legend: [number, string][] = [[0, "0"]]; if (a >= 1) legend.push([1, span(1, a)]); if (b > a) legend.push([2, span(a + 1, b)]); legend.push([3, span(b + 1, max)]);
  return { days, max, legend, months: Array.from({ length: 12 }, (_, w) => { const d = new Date(first + w * 7 * DAY + 12 * 3600e3), prev = new Date(first + (w - 1) * 7 * DAY + 12 * 3600e3); return w === 0 || d.getMonth() !== prev.getMonth() ? MON[d.getMonth()] : ""; }) };
}
