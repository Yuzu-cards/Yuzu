// Beta pass on the user's real collection (Finalcollex.colpkg + the curation pack) against an in-memory Google with a
// flaky connection: import, the main screens' speed, studying, the first Drive sync, media to Drive (stand-in files for
// 5,000 of the images the cards reference), and a second device pulling everything back. Prints a report.
import { chromium, type Page } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
import { fakeGoogle } from "../../test/fake-google.ts";
const port = 4187; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const G = fakeGoogle(); const browser = await chromium.launch(); const errors: string[] = []; const report: Record<string, unknown> = {};
const t = () => Date.now(); const secs = (t0: number) => Math.round((Date.now() - t0) / 100) / 10;
async function device(name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "Asia/Riyadh" }); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + ": " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_FAILED|ERR_CONNECTION_RESET|favicon/.test(m.text())) errors.push(name + " console: " + m.text()); });
  await page.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ status: 200, body: G.gisScript, contentType: "text/javascript" }));
  await page.route(/https:\/\/www\.googleapis\.com\/.*/, async (route) => {
    const req = route.request(); const buf = req.postDataBuffer(); let res: Response;
    try { res = await G.fetchImpl(req.url(), { method: req.method(), headers: await req.allHeaders(), body: buf ? new Blob([buf as BlobPart]) : undefined } as any); } catch { await route.abort("connectionreset"); return; }
    await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("Content-Type") ?? "application/octet-stream" });
  });
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet", { timeout: 20000 });
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details.section").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.fill('input[placeholder="S25 Ultra"]', name); await page.keyboard.press("Tab");
  return page;
}
const waitSync = (p: Page, max = 900) => p.evaluate(async (max: number) => { const y = (window as any).yuzu; for (let i = 0; i < 50 && y.syncStatus.state !== "syncing"; i++) await new Promise((r) => setTimeout(r, 100)); for (let i = 0; i < max * 10 && y.syncStatus.state === "syncing"; i++) await new Promise((r) => setTimeout(r, 100)); return y.syncStatus.message; }, max);
const FP = "(() => { const y = window.yuzu; const cs = [...y.cards.values()].sort((a, b) => (a.id < b.id ? -1 : 1)); let h = 2166136261; for (const c of cs) { const s = c.id + '|' + c.due + '|' + c.stability + '|' + c.difficulty + '|' + c.reps + '|' + c.state + '|' + c.suspended; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); } return { notes: y.notes.size, cards: y.cards.size, reviews: y.reviews.length, fp: (h >>> 0).toString(16) }; })()";
const fingerprint = (p: Page) => p.evaluate(FP) as Promise<any>;
try {
  const A = await device("S25 Ultra");
  // ---- import the real collection, then the curation pack (merged duplicates)
  let t0 = t(); await A.locator("input[type=file]").first().setInputFiles("/home/claude/final/Finalcollex.colpkg");
  await A.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 900000 }); report.importColpkg_s = secs(t0);
  if (fs.existsSync("/home/claude/final/curation.yuzu.json")) { t0 = t(); await A.locator("input[type=file]").first().setInputFiles("/home/claude/final/curation.yuzu.json"); await A.waitForFunction(() => /merged|cards added|Nothing new/i.test(document.body.innerText), null, { timeout: 600000 }).catch(() => {}); report.curation_s = secs(t0); }
  report.collection = await fingerprint(A);
  // ---- speed of the everyday things on the real collection
  report.speed_ms = await A.evaluate(`(() => { const y = window.yuzu; const m = (f) => { const t0 = performance.now(); f(); return Math.round(performance.now() - t0); };
    return { queue: m(() => y.queue("", Date.now())), queueSystems: m(() => y.queue("Cardiovascular", Date.now(), "systems")), stats: m(() => y.stats()), tree: m(() => y.tree("decks")), knowledgeNow: m(() => y.knowledgeNow()), mediaRefs: m(() => y.mediaRefs()), overfilled: m(() => y.overfilled()), hubStatus: m(() => y.hubStatus()) }; })()`);
  for (const tab of ["Today", "Library", "Progress", "Settings"]) { const t1 = t(); await A.click(`nav.tabs >> text=${tab}`); await A.waitForTimeout(50); await A.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); (report.tabs_ms ??= {} as any)[tab] = t() - t1; }
  // ---- study 25 cards through the real UI
  await A.click("nav.tabs >> text=Today"); await A.waitForTimeout(400); t0 = t();
  await A.locator("button.btn.primary:has-text('Study')").first().click(); await A.waitForTimeout(500);
  await A.locator("button:has-text('Start ·')").first().click().catch(() => {}); await A.waitForTimeout(400);
  let answered = 0; for (let i = 0; i < 25; i++) { if (!(await A.locator("text=Show answer").count())) break; await A.click("text=Show answer"); await A.click(".answer-bar .good"); answered++; await A.waitForTimeout(60); }
  report.study = { answered, avgPerCard_ms: Math.round((t() - t0) / Math.max(1, answered)) };
  await A.click('[aria-label="Close"]').catch(() => {}); await A.waitForTimeout(300);
  // ---- stand-in media for 5,000 referenced images (the export carries no image files)
  report.mediaReferenced = await A.evaluate(() => (window as any).yuzu.mediaRefs().size);
  report.mediaSeeded = await A.evaluate(`(async () => {
    const y = window.yuzu; const names = [...y.mediaRefs()].filter((n) => /\\.(png|jpe?g|webp|gif)$/i.test(n)).slice(0, 5000); const rows = [];
    for (const [i, n] of names.entries()) { const blob = new Blob([new Uint8Array(1500 + (i % 900)).fill(i % 251)], { type: "image/webp" }); y.media.set(n, blob); rows.push({ name: n, blob }); }
    await y._db.putMany("media", rows); return rows.length; })()`);
  // ---- Google: connect, first Drive sync and the media upload through a flaky connection (1 upload in 8 drops)
  let k = 0; G.fail = (u, m) => (m !== "GET" && /\/upload\//.test(u.pathname) && ++k % 8 === 0 ? "network" : null);
  await A.click("nav.tabs >> text=Settings"); await A.evaluate(() => document.querySelectorAll("details.section").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  t0 = t(); await A.click("button:has-text('Connect Google')"); await A.waitForFunction(() => (window as any).yuzu.syncBackend() === "drive", null, { timeout: 60000 });
  report.firstDriveSync = { message: await waitSync(A), s: secs(t0) };
  const coll = G.at(["My Apps", "Yuzu", "collection"]); let bytes = 0; for (const f of G.files.values()) if (!f.trashed && f.parents.some((p) => G.files.get(p)?.name === "collection")) bytes += f.bytes.length;
  report.onDrive = { collectionFiles: coll.size, collectionMB: Math.round(bytes / 1048576 * 10) / 10 };
  t0 = t(); let st: any = null;
  for (let i = 0; i < 600; i++) { st = await A.evaluate(() => (window as any).yuzu.driveState()); if (st && st.complete && st.toUpload === 0) break; await A.waitForTimeout(1000); }
  report.mediaUpload = { ...st, s: secs(t0), dropsRetried: G.stats.dropped, filesPerSec: st ? Math.round((report.mediaSeeded as number) / Math.max(1, secs(t0))) : 0 };
  G.fail = null;
  // ---- status for Citrus
  const sj = G.at(["My Apps", "hub", "yuzu"]).get("status.json"); report.status = sj ? JSON.parse(sj).summary : null;
  // ---- device B pulls everything
  const B = await device("PC"); t0 = t();
  await B.click("button:has-text('Connect Google')"); await B.waitForFunction(() => (window as any).yuzu.syncBackend() === "drive", null, { timeout: 60000 });
  report.devicePull = { message: await waitSync(B), s: secs(t0) };
  const fa = await fingerprint(A), fb = await fingerprint(B); report.identical = JSON.stringify(fa) === JSON.stringify(fb) ? "yes" : { A: fa, B: fb };
  t0 = t(); let first = -1, have = 0;
  for (let i = 0; i < 120; i++) { have = await B.evaluate(() => (window as any).yuzu.media.size); if (have > 0 && first < 0) first = secs(t0); if (have >= 5000) break; await B.waitForTimeout(1000); }
  report.deviceBMedia = { firstFileAfter_s: first, filesAfter: have, s: secs(t0), status: await B.evaluate(() => (window as any).yuzu.googleStatus.message) };
} catch (e: any) { report.crash = e?.message?.slice(0, 400); }
finally { report.errors = errors.length ? errors.slice(0, 8) : "none"; console.log(JSON.stringify(report, null, 1)); await browser.close(); server.kill(); }
