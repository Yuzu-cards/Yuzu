// Settings → Google / Sync after connecting (fake Google), phone size; screenshots to test/e2e/shots/gs-*.png.
import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
import { fakeGoogle } from "../../test/fake-google.ts";
const port = 4183; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const G = fakeGoogle(); const today = new Date().toISOString().slice(0, 10);
G.seedFile("plan.json", ["My Apps", "hub", "citrus"], new TextEncoder().encode(JSON.stringify({ days: {}, blocks: [{ app: "yuzu", title: "Yuzu reviews", date: today, start: "19:30", end: "19:55", minutes: 25, status: "accepted" }] })), "application/json");
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const page = await ctx.newPage();
const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
await page.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ status: 200, body: G.gisScript, contentType: "text/javascript" }));
await page.route(/https:\/\/www\.googleapis\.com\/.*/, async (route) => { const req = route.request(); const buf = req.postDataBuffer(); const res = await G.fetchImpl(req.url(), { method: req.method(), headers: await req.allHeaders(), body: buf ? new Blob([buf as BlobPart]) : undefined } as any); await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("Content-Type") ?? "application/octet-stream" }); });
await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet");
await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details.section").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
await page.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
await page.fill('input[placeholder="S25 Ultra"]', "S25 Ultra"); await page.keyboard.press("Tab");
await page.click("button:has-text('Connect Google')"); await page.waitForFunction(() => (window as any).yuzu.syncBackend() === "drive"); await page.waitForTimeout(4000);
fs.mkdirSync("test/e2e/shots", { recursive: true });
await page.locator("summary:has-text('Google')").scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -60)); await page.screenshot({ path: "test/e2e/shots/gs-google.png" });
await page.locator("summary:has-text('Sync between devices')").scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -60)); await page.screenshot({ path: "test/e2e/shots/gs-sync.png" });
// lapsed token → Today's coach offers the tap
await page.evaluate(() => { const t = JSON.parse(localStorage.getItem("yuzu-google")!); t.expires = 1; localStorage.setItem("yuzu-google", JSON.stringify(t)); (window as any).yuzu.googleRefresh("auto"); });
await page.click("nav.tabs >> text=Today"); await page.waitForTimeout(600); await page.locator("text=Worth a few minutes").scrollIntoViewIfNeeded(); await page.screenshot({ path: "test/e2e/shots/gs-today.png" });
console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill();
