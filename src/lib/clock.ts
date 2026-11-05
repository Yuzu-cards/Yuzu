// A clock that never goes backwards and never falls behind anything seen from another device.
// Every edit is stamped with it, so a phone whose clock is a few minutes slow still wins with an edit it made later.
let floor = 0;
const DAY = 86400000;
/** Timestamp for a new edit: wall time, but always after anything already stamped or observed. */
export function stamp(): number { const t = Math.max(Date.now(), floor + 1); floor = t; return t; }
/** Tell the clock about a time seen on another device (ignored if implausibly far in the future). */
export function observe(t: number | undefined) { if (t && Number.isFinite(t) && t < Date.now() + DAY && t > floor) floor = t; }
