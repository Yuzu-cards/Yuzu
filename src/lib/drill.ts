// Mixed drills keep systems in turns (store.drillQueue). A card answered wrong comes back minutes later; put it where neither
// neighbour is from its own system, so the drill still never shows two of one system in a row when it can be avoided.

/** Insert `add` into `q` at or after `at`, each at the first slot whose neighbours are from other systems (fallback: `at`). */
export function insertApart<T>(q: T[], at: number, add: T[], sysOf: (c: T) => string): T[] {
  const out = q.slice();
  for (const c of add) {
    const s = sysOf(c); let pos = -1;
    for (let p = Math.max(0, at); p <= Math.min(out.length, at + 6); p++) { // a few cards later at most: it is due now
      const prev = p > 0 ? out[p - 1] : undefined, next = p < out.length ? out[p] : undefined;
      // the slot right after the current card (p === at) still has the current card as its left neighbour
      if ((prev === undefined || sysOf(prev) !== s) && (next === undefined || sysOf(next) !== s)) { pos = p; break; }
    }
    out.splice(pos < 0 ? Math.min(out.length, Math.max(0, at)) : pos, 0, c); at = (pos < 0 ? at : pos) + 1;
  }
  return out;
}
