// Cold-open profile on the real collection, kept in a persistent browser profile (imported once):
// where the time goes between navigation and Today drawn. Usage: npx tsx tools/probes/startup.ts [profileDir] [mediaFiles=20000] [cpuSlowdown=1]
import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const dir = process.argv[2] ?? "/tmp/yuzu-startup-profile"; const MEDIA = Number(process.argv[3] ?? 20000); const SLOW = Number(process.argv[4] ?? 1);
const port = 4189; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const fresh = !fs.existsSync(dir);
const ctx = await chromium.launchPersistentContext(dir, { serviceWorkers: "block", viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, timezoneId: "Asia/Riyadh" });
const page = ctx.pages()[0] ?? (await ctx.newPage()); const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
const out: any = {};
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 60000 });
  if (fresh || (await page.evaluate(() => (window as any).yuzu.cards.size)) === 0) {
    await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details.section").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
    await page.locator("input[type=file]").first().setInputFiles("/home/claude/final/Finalcollex.colpkg");
    await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 900000 });
    await page.evaluate(`(async () => { const y = window.yuzu; const names = [...y.mediaRefs()].slice(0, ${MEDIA}); const rows = [];
      for (const [i, n] of names.entries()) rows.push({ name: n, blob: new Blob([new Uint8Array(20000 + (i % 30000)).fill(i % 251)], { type: "image/webp" }) });
      for (let i = 0; i < rows.length; i += 2000) await y._db.putMany("media", rows.slice(i, i + 2000)); })()`);
    out.imported = true;
  }
  const cdp = await ctx.newCDPSession(page); if (SLOW > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: SLOW });
  const runs: any[] = [];
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now(); await page.reload();
    await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 120000 }); const loaded = Date.now() - t0;
    await page.waitForFunction(() => /Study|Nothing to study|due/i.test(document.body.innerText), null, { timeout: 120000 }); const today = Date.now() - t0;
    const marks = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType("mark").map((m) => [m.name, Math.round(m.startTime)])));
    runs.push({ loaded, today, marks });
  }
  out.runs = runs; out.cards = await page.evaluate(() => (window as any).yuzu.cards.size); out.media = await page.evaluate(() => (window as any).yuzu.media.size);
} catch (e: any) { out.crash = e?.message?.slice(0, 400); }
finally { out.errors = errors.slice(0, 5); console.log(JSON.stringify(out, null, 1)); await ctx.close(); server.kill(); }
