// Study 30 cards of the real collection through the UI and record what the screen shows when "Show answer" is missing.
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 4189; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "Asia/Riyadh" })).newPage();
const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details.section").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
await page.locator("input[type=file]").first().setInputFiles("/home/claude/final/Finalcollex.colpkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 900000 });
if (process.argv[2] === "curated") { await page.locator("input[type=file]").first().setInputFiles("/home/claude/final/curation.yuzu.json"); await page.waitForFunction(() => /merged|cards added|Nothing new/i.test(document.body.innerText), null, { timeout: 600000 }).catch(() => {}); console.log("curation:", (await page.evaluate(() => document.body.innerText)).match(/[^\n]*(merged|cards added)[^\n]*/i)?.[0]); }
await page.click("nav.tabs >> text=Today"); await page.waitForTimeout(800);
for (const tab of ["Library", "Progress", "Today", "Library", "Progress", "Today"]) { const t0 = Date.now(); await page.click(`nav.tabs >> text=${tab}`); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); console.log("tab", tab, Date.now() - t0, "ms"); }
console.log("queue dupes:", await page.evaluate(`(() => { const q = window.yuzu.queue("", Date.now()); const ids = q.map((c) => c.id); const dup = ids.filter((x, i) => ids.indexOf(x) !== i); return { len: q.length, dupes: dup.length, sample: dup.slice(0, 3), steps: window.yuzu.settings.scheduler.learningSteps }; })()`));
await page.locator("button.btn.primary:has-text('Study')").first().click(); await page.waitForTimeout(600);
await page.locator("button:has-text('Start ·')").first().click().catch(() => {}); await page.waitForTimeout(500);
// in-page timing: tap Good → the next card's front is on screen (two animation frames after "Show answer" appears)
const lat = await page.evaluate(`(async () => { const out = []; const frame = () => new Promise((r) => requestAnimationFrame(() => r())); 
  for (let i = 0; i < 20; i++) { const show = [...document.querySelectorAll("button")].find((b) => /Show answer/.test(b.textContent)); if (!show) break; show.click(); await frame(); await frame();
    const good = document.querySelector(".answer-bar .good"); if (!good) break; const t0 = performance.now(); good.click();
    for (let k = 0; k < 400; k++) { await frame(); if ([...document.querySelectorAll("button")].some((b) => /Show answer/.test(b.textContent))) break; } await frame(); out.push(Math.round(performance.now() - t0)); }
  out.sort((a, b) => a - b); return { n: out.length, median: out[Math.floor(out.length / 2)], worst: out[out.length - 1] }; })()`);
console.log("tap Good → next card on screen (ms):", JSON.stringify(lat));
let answered = 0; const t0 = Date.now();
for (let i = 0; i < 30; i++) {
  if (!(await page.locator("text=Show answer").count())) { await page.screenshot({ path: `test/e2e/shots/real-study-stuck-${i}.png` }); console.log("no Show answer at", i, "—", (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 300)); break; }
  const id0 = await page.evaluate(`document.querySelector(".study") && window.__lastId`); void id0;
  await page.click("text=Show answer"); await page.click(".answer-bar .good"); answered++; await page.waitForTimeout(80);
}
console.log({ answered, msPerCard: Math.round((Date.now() - t0) / Math.max(1, answered)), errors });
await browser.close(); server.kill();
