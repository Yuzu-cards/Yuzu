// When you study best (1.10.0, after Anki's hourly breakdown): reviews and recall by hour of the day, over the last 60 days,
// and the best two-hour window with enough answers to mean something.
import type { Review } from "./model";

export interface HourStat { hour: number; n: number; recall: number | null }
export function hourStats(reviews: Review[], now = Date.now(), days = 60): { hours: HourStat[]; best: { from: number; to: number; recall: number; n: number } | null } {
  const from = now - days * 86400000; const n = new Array(24).fill(0), ok = new Array(24).fill(0), graded = new Array(24).fill(0);
  for (let i = reviews.length - 1; i >= 0; i--) { const r = reviews[i]; if (r.ts < from) break; const h = new Date(r.ts).getHours(); n[h]++; if (r.state !== "new") { graded[h]++; if (r.rating > 1) ok[h]++; } }
  const hours = n.map((c, h) => ({ hour: h, n: c, recall: graded[h] >= 10 ? Math.round((ok[h] / graded[h]) * 100) : null }));
  let best: { from: number; to: number; recall: number; n: number } | null = null;
  for (let h = 0; h < 24; h++) { const k = (h + 1) % 24; const g = graded[h] + graded[k]; if (g < 30) continue; const rc = Math.round(((ok[h] + ok[k]) / g) * 100); if (!best || rc > best.recall || (rc === best.recall && g > best.n)) best = { from: h, to: (h + 2) % 24, recall: rc, n: g }; }
  return { hours, best };
}
