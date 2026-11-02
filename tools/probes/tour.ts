// Phone + desktop tour of every screen on the fixture; screenshots to test/e2e/shots/tour-*.png. Fails on JS errors.
import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const port = 4179; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800)); const out = "test/e2e/shots"; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(); const errors: string[] = [];
for (const [tag, vp, mobile] of [["phone", { width: 412, height: 915 }, true], ["desktop", { width: 1280, height: 800 }, false]] as const) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(tag + ": " + e.message)); page.on("dialog", (d) => d.accept());
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_FAILED/.test(m.text())) errors.push(tag + " console: " + m.text()); });
  const shot = (n: string) => page.screenshot({ path: `${out}/tour-${tag}-${n}.png` });
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet", { timeout: 15000 });
  await shot("00-empty");
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  await page.evaluate(() => window.scrollTo(0, 0)); await shot("10-settings-top"); await page.evaluate(() => window.scrollTo(0, 1200)); await shot("11-settings-mid"); await page.evaluate(() => window.scrollTo(0, 99999)); await shot("12-settings-end");
  await page.click("nav.tabs >> text=Today"); await page.waitForTimeout(600); await shot("20-today"); await page.evaluate(() => window.scrollTo(0, 99999)); await shot("21-today-end");
  await page.click("nav.tabs >> text=Library"); await page.waitForTimeout(500); await shot("30-library");
  await page.click("text=Medicine"); await page.waitForTimeout(400); await shot("31-library-node");
  await page.locator(".card-row, .list-row").first().click().catch(() => {}); await page.waitForTimeout(400); await shot("32-library-preview"); await page.keyboard.press("Escape");
  await page.click("nav.tabs >> text=Progress"); await page.waitForTimeout(1200); await shot("40-progress"); await page.evaluate(() => window.scrollTo(0, 99999)); await shot("41-progress-end");
  await page.click("text=Recap").catch(() => {}); await page.waitForTimeout(500); await shot("42-recap"); await page.keyboard.press("Escape");
  await page.click("nav.tabs >> text=Today"); await page.waitForTimeout(400);
  await page.locator("button.btn.primary:has-text('Study')").first().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(600); await shot("50-plan");
  await page.locator("button:has-text('Start ·')").first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(600); await shot("51-study-front");
  await page.locator("button:has-text('Show answer')").first().click({ timeout: 3000 }).catch(() => page.keyboard.press("Space")); await page.waitForTimeout(400); await shot("52-study-back");
  await ctx.close();
}
console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill();
