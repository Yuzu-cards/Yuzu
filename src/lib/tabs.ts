// One tab (or installed window) writes at a time. Two copies of Yuzu open on one device would each keep their own picture of the
// collection and overwrite each other's bookkeeping (what still has to sync, what was deleted). The first copy holds a Web Lock;
// a second one shows "Yuzu is open elsewhere — use it here", and taking over hands the lock across before anything is read.
const NAME = "yuzu-writer"; const CHANNEL = "yuzu-tabs";
let release: (() => void) | null = null; let chan: BroadcastChannel | null = null;
const locks = (): any => (typeof navigator !== "undefined" ? (navigator as any).locks : null);

function hold(lost: () => void) {
  try { chan = new BroadcastChannel(CHANNEL); chan.onmessage = (e) => { if (e.data?.type === "take" && release) { const r = release; release = null; r(); lost(); } }; } catch { /* no channel: only the lock guards */ }
}
/** Try to become the tab that writes. "mine" when this tab holds it (or the browser has no Web Locks), "busy" when another has it. */
export async function claimTab(lost: () => void): Promise<"mine" | "busy"> {
  const L = locks(); if (!L) return "mine";
  const got = await new Promise<boolean>((resolve) => {
    L.request(NAME, { ifAvailable: true }, (lock: unknown) => { if (!lock) { resolve(false); return; } resolve(true); return new Promise<void>((r) => { release = r; }); }).catch(() => resolve(true));
  });
  if (got) hold(lost); return got ? "mine" : "busy";
}
/** Take over from the other tab: queue for the lock first, then ask the holder to let go; resolves once this tab holds it. */
export async function takeTab(lost: () => void): Promise<void> {
  const L = locks(); if (!L) return;
  const got = new Promise<void>((resolve) => { L.request(NAME, (_lock: unknown) => { resolve(); return new Promise<void>((r) => { release = r; }); }); });
  try { const c = new BroadcastChannel(CHANNEL); c.postMessage({ type: "take" }); c.close(); } catch { /* the holder only lets go when closed */ }
  await got; hold(lost);
}
