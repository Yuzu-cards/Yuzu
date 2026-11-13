// The exam's real share of the daily new-card budget. store.queue("") hands new cards out in turns across categories (the first
// three levels of the deck path, in the order the categories first appear), restarting at the first category every day, one card
// per note a day when siblings are buried. This replays that round-robin day by day, so the countdown says what will happen.

/** A category in queue order. Categories holding no card of the exam's scope only need a count; the others list every new card in
 *  queue order (oldest first) with its note and whether it belongs to the exam's scope. */
export interface ShareCat { count: number; cards?: { nid: string; scope: boolean }[] }
export interface ShareRun { perDay: number[]; finishDay: number | null }

/** Replays the new-card round-robin: `budgetFor(day)` is that day's new-card budget (day 0 = today). Stops when every scope card is
 *  in (finishDay = the day the last one comes in) or after `maxDays` (finishDay null). perDay[d] = scope cards introduced on day d. */
export function simulateNewShare(cats: ShareCat[], budgetFor: (day: number) => number, maxDays: number, bury: boolean): ShareRun {
  const st = cats.map((c) => ({ left: c.cards ? c.cards.length : c.count, cards: c.cards, done: c.cards ? new Uint8Array(c.cards.length) : null, head: 0, cur: 0 }));
  let scopeLeft = 0; for (const c of cats) if (c.cards) for (const x of c.cards) if (x.scope) scopeLeft++;
  const perDay: number[] = []; if (!scopeLeft) return { perDay, finishDay: 0 };
  const ex = st.filter((s) => s.done) as { done: Uint8Array; head: number }[];
  for (let day = 0; day < maxDays; day++) {
    let budget = Math.max(0, budgetFor(day)), got = 0, idx = 0; const seen = new Set<string>();
    const active = st.filter((s) => s.left > 0); for (const s of active) s.cur = s.head;
    while (budget > 0 && active.length) {
      if (idx >= active.length) idx = 0;
      const s = active[idx];
      if (!s.cards) { s.left--; budget--; if (!s.left) active.splice(idx, 1); else idx++; continue; }
      const done = s.done!; while (s.cur < s.cards.length && done[s.cur]) s.cur++;
      if (s.cur >= s.cards.length) { active.splice(idx, 1); continue; } // nothing left in this category today
      const k = s.cur++; const c = s.cards[k];
      if (bury && seen.has(c.nid)) { idx++; continue; } // a buried sibling: the category loses its turn, the budget is kept
      if (bury) seen.add(c.nid);
      done[k] = 1; s.left--; budget--; if (c.scope) { got++; scopeLeft--; }
      idx++;
    }
    for (const s of ex) while (s.head < s.done.length && s.done[s.head]) s.head++;
    perDay.push(got);
    if (!scopeLeft) return { perDay, finishDay: day };
  }
  return { perDay, finishDay: null };
}

/** "today", "tomorrow", "in 5 days" for an exam this many days away. */
export const examWhen = (n: number) => (n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
