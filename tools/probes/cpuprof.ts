// Where the time goes on the first visit to each screen after a cold open (real collection in a persistent profile).
// Usage: YUZU_NOMINIFY=1 npm run build && npx tsx tools/probes/cpuprof.ts <profileDir> [Library|Progress|Today|Settings]...
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const dir = process.argv[2]; const tabs = process.argv.slice(3).length ? process.argv.slice(3) : ["Library", "Progress", "Settings", "Today"];
const port = 4191; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" }); await new Promise((r) => setTimeout(r, 800));
const ctx = await chromium.launchPersistentContext(dir, { serviceWorkers: "block", viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
const page = ctx.pages()[0] ?? await ctx.newPage(); const cdp = await ctx.newCDPSession(page); await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
for (const tab of tabs) {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 60000 }); await page.waitForTimeout(2500);
  await cdp.send("Profiler.start"); const t0 = Date.now();
  await page.click(`nav.tabs >> text=${tab}`); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const ms = Date.now() - t0; const { profile } = await cdp.send("Profiler.stop");
  const self = new Map<number, number>(); const dt = profile.timeDeltas; for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + dt[i]);
  const byFn = new Map<string, number>(); for (const n of profile.nodes) { const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`; byFn.set(k, (byFn.get(k) ?? 0) + (self.get(n.id) ?? 0)); }
  console.log(`\n== ${tab}: ${ms} ms`); for (const [k, v] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`${Math.round(v / 1000).toString().padStart(6)} ms  ${k}`);
}
await ctx.close(); server.kill();
