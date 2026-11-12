import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
const port = 4173;
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const shots = "test/e2e/shots"; fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_FAILED/.test(m.text())) errors.push("console: " + m.text()); });
const fixture = process.argv[2] ?? "test/fixtures/medicine-legacy.apkg";
try {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector("text=Nothing to study yet", { timeout: 15000 });
  console.log("zstd native:", await page.evaluate(() => { try { new DecompressionStream("zstd" as any); return true; } catch { return false; } }));
  await page.screenshot({ path: `${shots}/01-empty.png` });
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.setInputFiles('input[type=file]', fixture);
  await page.waitForFunction(() => document.body.innerText.includes("Imported "), null, { timeout: 180000 });
  const summary = await page.locator("text=/Imported .*/").first().innerText();
  console.log(summary);
  await page.screenshot({ path: `${shots}/02-imported.png` });
  // Reload: data must persist in IndexedDB.
  await page.reload();
  await page.waitForSelector("text=cards ready", { timeout: 20000 });
  const ready = await page.locator(".hero .lead b").first().innerText();
  console.log("ready now:", ready);
  await page.screenshot({ path: `${shots}/03-today.png` });
  await page.click("nav.tabs >> text=Library");
  await page.waitForSelector("text=Categories");
  await page.screenshot({ path: `${shots}/04-library.png` });
  await page.click(".seg >> text=Systems");
  await page.waitForSelector("text=Cardiovascular");
  await page.screenshot({ path: `${shots}/04b-systems.png` });
  await page.click("text=Cardiovascular");
  await page.waitForSelector(".crumbs >> text=Cardiovascular");
  console.log("cardio:", (await page.locator(".card-box .small.muted").first().innerText()));
  await page.click(".seg >> text=Specialties"); await page.waitForTimeout(200);
  await page.screenshot({ path: `${shots}/04c-specialties.png` });
  // Smart deck: Cardiovascular + new
  await page.click(".seg >> text=Smart"); await page.click("text=New smart deck");
  await page.fill(".sheet input", "Cardio new");
  await page.click(".sheet >> text=Cardiovascular"); await page.click(".sheet >> .chip >> text=new");
  const matchTxt = await page.locator(".sheet p.small").innerText(); console.log("smart:", matchTxt.match(/[\d,]+ cards match/)?.[0]);
  await page.click(".sheet >> text=Save"); await page.waitForTimeout(200);
  await page.click("text=Cardio new"); await page.waitForSelector(".card-box");
  await page.click('[aria-label="Pin"]'); await page.waitForTimeout(200);
  // Bulk: show cards, select all, suspend
  await page.click("text=Show cards in Cardio new"); await page.click("text=Select"); await page.getByRole("button", { name: /^All \d/ }).first().click();
  await page.waitForTimeout(200); console.log("bulk bar:", await page.locator(".bulk-bar").innerText().catch(() => "none"));
  await page.click(".bulk-bar >> text=Suspend"); await page.waitForTimeout(400);
  console.log("after bulk suspend:", await page.locator(".card-box .small.muted").first().innerText());
  await page.click("button.chip >> text=Select"); await page.waitForTimeout(200);
  await page.getByRole("button", { name: /^All \d/ }).first().click(); await page.click(".bulk-bar >> text=Unsuspend"); await page.waitForTimeout(400);
  await page.waitForSelector(".card-box >> text=/ 0 suspended/"); await page.waitForSelector(".bulk-bar", { state: "detached" });
  for (let i = 0; i < 3 && !(await page.locator("text=Preview").count()); i++) { await page.locator(".list-row").first().click(); await page.waitForTimeout(400); }
  await page.waitForSelector("text=Preview"); await page.screenshot({ path: `${shots}/04d-preview.png` });
  await page.click('[aria-label="Close preview"]');
  // Card pack import with an image, then study it
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.setInputFiles('input[type=file] >> nth=0', "test/fixtures/hyperkalemia.yuzu.json");
  await page.waitForFunction(() => document.body.innerText.includes("cards added"), null, { timeout: 30000 });
  console.log("pack:", await page.locator("text=/cards added/").first().innerText());
  await page.click("nav.tabs >> text=Library"); await page.click(".seg >> text=Decks");
  await page.fill("input[placeholder^=Search]", "peaked (tented) t waves, best seen"); await page.waitForTimeout(300);
  await page.locator(".list-row").first().click(); await page.waitForSelector("text=Preview");
  const imgOk = await page.locator(".sheet .paper .card-host").evaluate((el) => { const img = el.shadowRoot!.querySelector("img") as HTMLImageElement | null; return img ? img.src.startsWith("blob:") : false; });
  console.log("pack image renders:", imgOk);
  await page.screenshot({ path: `${shots}/09-pack-preview.png` });
  await page.click('[aria-label="Close preview"]');
  // Backup download
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("text=Full backup")]);
  const bpath = await dl.path(); const bsize = bpath ? fs.statSync(bpath).size : 0; console.log("backup bytes:", bsize);
  await page.evaluate(() => (window as any).yuzu.saveSettings({ planScreen: true })); // the "how long?" screen is off by default since 12/11/2026
  await page.click("nav.tabs >> text=Today");
  await page.click(".hero >> text=Study");
  await page.waitForSelector("text=cards ready");
  await page.screenshot({ path: `${shots}/05a-plan.png` });
  console.log("plan options:", (await page.locator(".done .btn").allInnerTexts()).join(" / "));
  await page.click(".done .btn >> text=/^25 cards/");
  await page.waitForSelector(".study .card-host", { timeout: 15000 });
  await page.screenshot({ path: `${shots}/05-study-front.png` });
  await page.click("text=Show answer");
  await page.waitForSelector(".answer-bar");
  await page.screenshot({ path: `${shots}/06-study-back.png` });
  const before = await page.locator(".study-top span.small").innerText();
  await page.click(".answer-bar .good");
  await page.waitForTimeout(300);
  await page.click("text=Show answer"); await page.click(".answer-bar .again");
  await page.waitForTimeout(300);
  await page.click("text=Show answer"); await page.click(".answer-bar .easy");
  await page.waitForTimeout(300);
  const after = await page.locator(".study-top span.small").innerText();
  console.log("progress", before, "→", after);
  await page.click('[aria-label="More"]'); await page.click("text=Card info and edit"); await page.waitForSelector("text=stability");
  await page.screenshot({ path: `${shots}/06b-info.png` });
  await page.click("text=Edit this card"); await page.waitForSelector("textarea");
  await page.fill("textarea >> nth=0", "Edited front {{c1::answer}}");
  await page.click("text=Save"); await page.waitForTimeout(300);
  await page.click('[aria-label="Close info"]'); await page.waitForTimeout(200);
  console.log("edited:", await page.locator(".study .card-host").evaluate((el) => el.shadowRoot!.querySelector(".card")!.textContent!.trim().slice(0, 40)));
  await page.click('[aria-label="Undo"]'); await page.waitForTimeout(300);
  const afterUndo = await page.locator(".study-top span.small").innerText();
  console.log("after undo", afterUndo);
  await page.click('[aria-label="Close"]');
  await page.click("nav.tabs >> text=Progress");
  await page.waitForSelector("text=retention, 30 days");
  await page.screenshot({ path: `${shots}/07-progress.png` });
  // Persisted after reload?
  await page.reload(); await page.waitForSelector("text=cards ready");
  const stats = await page.locator(".stat-grid").innerText();
  console.log("stats after reload:", stats.replace(/\n/g, " | "));
  // Desktop view
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${shots}/08-desktop.png` });
  console.log("errors:", errors.length ? errors : "none");
} finally {
  await browser.close(); server.kill();
}
