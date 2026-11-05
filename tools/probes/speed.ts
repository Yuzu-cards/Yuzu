// Speed probe on the real collection with a phone-like connection (every Google request takes LAT ms):
// cold open, a no-change sync, a sync after a few reviews, a Google refresh, media to Drive, a second device's pull and media.
// Usage: npx tsx tools/probes/speed.ts [mediaFiles=3000] [latencyMs=150]
import { chromium, type Page, type BrowserContext } from "playwright"; import { spawn } from "node:child_process";
import { fakeGoogle } from "../../test/fake-google.ts";
const MEDIA = Number(process.argv[2] ?? 3000), LAT = Number(process.argv[3] ?? 150);
const port = 4188; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const G = fakeGoogle(); const browser = await chromium.launch(); const errors: string[] = []; const R: Record<string, unknown> = {};
const secs = (t0: number) => Math.round((Date.now() - t0) / 100) / 10;
const reqs = () => G.stats.requests;
async function device(name: string): Promise<{ page: Page; ctx: BrowserContext }> {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, timezoneId: "Asia/Riyadh" }); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + ": " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_FAILED|ERR_CONNECTION_RESET|favicon/.test(m.text())) errors.push(name + " console: " + m.text()); });
  await ctx.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ status: 200, body: G.gisScript, contentType: "text/javascript" }));
  await ctx.route(/https:\/\/www\.googleapis\.com\/.*/, async (route) => {
    const req = route.request(); const buf = req.postDataBuffer(); let res: Response;
    await new Promise((r) => setTimeout(r, LAT + (buf ? buf.length / 2000 : 0))); // RTT + ~2 MB/s up
    try { res = await G.fetchImpl(req.url(), { method: req.method(), headers: await req.allHeaders(), body: buf ? new Blob([buf as BlobPart]) : undefined } as any); } catch { await route.abort("connectionreset"); return; }
    const body = Buffer.from(await res.arrayBuffer()); await new Promise((r) => setTimeout(r, body.length / 8000)); // ~8 MB/s down
    const headers: Record<string, string> = {}; res.headers.forEach((v, k) => { headers[k] = v; });
    await route.fulfill({ status: res.status, body, headers });
  });
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 30000 });
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details.section").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.fill('input[placeholder="S25 Ultra"]', name); await page.keyboard.press("Tab");
  return { page, ctx };
}
const waitSync = (p: Page, max = 900) => p.evaluate(async (max: number) => { const y = (window as any).yuzu; for (let i = 0; i < 50 && y.syncStatus.state !== "syncing"; i++) await new Promise((r) => setTimeout(r, 50)); for (let i = 0; i < max * 20 && y.syncStatus.state === "syncing"; i++) await new Promise((r) => setTimeout(r, 50)); return y.syncStatus.message; }, max);
const waitGoogle = (p: Page, max = 600) => p.evaluate(async (max: number) => { const y = (window as any).yuzu; for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 50)); } for (let i = 0; i < max * 20 && (y.googleStatus.state === "working" || y.driveBusy); i++) await new Promise((r) => setTimeout(r, 50)); return y.googleStatus.message; }, max);
async function timed<T>(label: string, f: () => Promise<T>) { const r0 = reqs(), t0 = Date.now(); const out = await f(); R[label] = { s: secs(t0), requests: reqs() - r0, result: out }; return out; }
try {
  const { page: A } = await device("S25 Ultra");
  await A.locator("input[type=file]").first().setInputFiles("/home/claude/final/Finalcollex.colpkg");
  await A.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 900000 });
  await A.evaluate(`(async () => { const y = window.yuzu; const names = [...y.mediaRefs()].filter((n) => /\\.(png|jpe?g|webp|gif)$/i.test(n)).slice(0, ${MEDIA}); const rows = [];
    for (const [i, n] of names.entries()) { const blob = new Blob([new Uint8Array(20000 + (i % 30000)).fill(i % 251)], { type: "image/webp" }); y.media.set(n, blob); rows.push({ name: n, blob }); }
    await y._db.putMany("media", rows); return rows.length; })()`);
  await A.click("button:has-text('Connect Google')"); await A.waitForFunction(() => (window as any).yuzu.syncBackend() === "drive", null, { timeout: 60000 });
  await timed("firstSync", () => waitSync(A));
  // media: until Drive has everything
  await timed("mediaUpload", async () => { let st: any; for (let i = 0; i < 3000; i++) { st = await A.evaluate(() => (window as any).yuzu.driveState()); if (st && st.complete && st.toUpload === 0) break; await A.waitForTimeout(500); } return { ...st, perSec: 0 }; });
  (R.mediaUpload as any).result.perSec = Math.round(MEDIA / (R.mediaUpload as any).s);
  await waitGoogle(A);
  await timed("syncNoChange", async () => { await A.evaluate(() => (window as any).yuzu.sync("manual")); return A.evaluate(() => (window as any).yuzu.syncStatus.message); });
  await timed("syncAfterReviews", async () => {
    await A.evaluate(async () => { const y = (window as any).yuzu; const q = y.queue("", Date.now()); for (const c of q.slice(0, 5)) await y.answer(c.id ?? c, 3); await y.flushWrites?.(); });
    await A.evaluate(() => (window as any).yuzu.sync("manual")); return A.evaluate(() => (window as any).yuzu.syncStatus.message);
  });
  await timed("googleRefresh", async () => { await A.evaluate(() => (window as any).yuzu.googleRefresh("poll")); return A.evaluate(() => (window as any).yuzu.googleStatus.message); });
  // cold open: reload and time to data loaded / Today drawn
  R.coldOpen = await (async () => { const runs: any[] = []; for (let i = 0; i < 3; i++) { const t0 = Date.now(); await A.reload(); await A.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 60000 }); const loaded = Date.now() - t0; await A.waitForSelector("nav.tabs", { timeout: 60000 }); await A.waitForFunction(() => /Study|Nothing|due/i.test(document.querySelector("main")?.textContent ?? document.body.innerText)); runs.push({ loaded_ms: loaded, today_ms: Date.now() - t0 }); } return runs; })();
  R.startupRequests = await (async () => { const r0 = reqs(); await A.waitForTimeout(9000); return reqs() - r0; })();
  const { page: B } = await device("PC");
  await timed("deviceBPull", async () => { await B.click("button:has-text('Connect Google')"); await B.waitForFunction(() => (window as any).yuzu.syncBackend() === "drive", null, { timeout: 60000 }); return waitSync(B); });
  await timed("deviceBMedia", async () => { let have = 0; for (let i = 0; i < 3000; i++) { have = await B.evaluate(() => (window as any).yuzu.media.size); if (have >= MEDIA) break; await B.waitForTimeout(500); } return have; });
} catch (e: any) { R.crash = e?.message?.slice(0, 500); }
finally { R.errors = errors.length ? errors.slice(0, 8) : "none"; console.log(JSON.stringify(R, null, 1)); await browser.close(); server.kill(); }
