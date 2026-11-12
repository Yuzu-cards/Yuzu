// The workload diagnosis on a real collection (profile imported under port 4189): prints the causes and screenshots the sheet.
// Usage: npx tsx tools/probes/diagnose.mts <profileDir> <out.png>
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const server = spawn("python3", ["-m", "http.server", "4189", "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" }); await new Promise((r) => setTimeout(r, 800));
const ctx = await chromium.launchPersistentContext(process.argv[2], { serviceWorkers: "block", viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const page = ctx.pages()[0]; await page.goto("http://127.0.0.1:4189/?do=workload"); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 60000 });
const t0 = Date.now(); const d = await page.evaluate(() => { const x = (window as any).yuzu.diagnose(); return { perDay: x.perDay, due: x.dueToday, causes: x.causes.map((c: any) => ({ id: c.id, t: c.title, perDay: Math.round(c.perDay), fix: c.fix?.label, ev: c.evidence })) }; });
console.log(Date.now() - t0, "ms", JSON.stringify(d, null, 1));
await page.waitForTimeout(800); await page.screenshot({ path: process.argv[3] });
await ctx.close(); server.kill();
