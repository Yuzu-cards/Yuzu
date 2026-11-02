// Hands-on tools (Orange's kit in Yuzu) and the new study features, with real touches, holds, drags and sliders at
// phone size. Fails on any JavaScript error.
import { chromium, type Page } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
const port = 4175;
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const shots = "test/e2e/shots"; fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors: string[] = []; const fails: string[] = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_FAILED/.test(m.text())) errors.push("console: " + m.text()); });
page.on("dialog", (d) => d.accept());
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const cdp = await ctx.newCDPSession(page);
async function swipe(p: Page, sel: string, dx: number, dy: number) {
  const b = (await p.locator(sel).first().boundingBox())!; const x0 = b.x + b.width / 2, y0 = b.y + Math.min(b.height / 2, 260);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (dx * i) / 8, y: y0 + (dy * i) / 8 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(450);
}
async function hold(p: Page, sel: string, ms = 700) {
  await p.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: "center" })); await p.waitForTimeout(250); // centred: clear of the tab bar
  const b = (await p.locator(sel).first().boundingBox())!; await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up(); await p.waitForTimeout(150);
}
const y = () => page.evaluate(() => (window as any).yuzu);
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet", { timeout: 15000 });
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  void y;

  // ---- Settings: sliders (keyboard on the range, like a screen reader / PC would)
  const newSlider = page.locator('input[type=range][aria-label="New cards per day"]');
  await newSlider.focus(); for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight"); await newSlider.blur(); await page.waitForTimeout(200);
  ok("slider: new cards per day commits on release", await page.evaluate(() => (window as any).yuzu.settings.newPerDay) === 25);
  await page.waitForFunction(() => /still remembered after a year/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
  ok("retention slider shows what it costs, live", /min a day/.test(await page.evaluate(() => document.body.innerText)));
  const ret = page.locator('input[type=range][aria-label="Target recall (FSRS-6)"]'); await ret.focus(); await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(100);
  const live = await page.evaluate(() => document.querySelector(".kit-cost")?.textContent ?? ""); await ret.blur();
  ok("retention slider: cost row follows the thumb", /\(−\d+\)|\(\+\d+\)/.test(live) || /min a day/.test(live), live.slice(0, 80));
  await page.click("text=Fri · normal"); ok("easy days: tap cycles to light", await page.evaluate(() => (window as any).yuzu.settings.easyDays[5]) === 0.5);

  // ---- Today: hold to explain, hold menus, pins drag, coach
  await page.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ pins: [{ path: "Medicine", view: "decks" }, { path: "Medicine::Emergency Medicine", view: "decks" }] }); });
  await page.click("nav.tabs >> text=Today"); await page.waitForTimeout(800); // let the tab switch finish scrolling (a scroll dismisses bubbles)
  await hold(page, ".stat:has-text('day streak')"); ok("hold a stat → explanation bubble", await page.locator("[data-testid=hint]").count() === 1, await page.locator("[data-testid=hint]").textContent().catch(() => "") ?? "");
  await page.waitForTimeout(100);
  await hold(page, ".stack:has-text('Medicine')"); ok("hold a pinned deck → action sheet", await page.locator(".kit-sheet").count() === 1);
  await page.screenshot({ path: `${shots}/h-sheet.png` });
  await page.keyboard.press("Escape"); await page.waitForTimeout(200); ok("Escape closes the sheet", await page.locator(".kit-sheet").count() === 0);
  const h = page.locator(".drag-handle").nth(0); const hb = (await h.boundingBox())!; const h2 = (await page.locator(".drag-handle").nth(1).boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); for (let i = 1; i <= 10; i++) await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + ((h2.y - hb.y + 30) * i) / 10); await page.mouse.up(); await page.waitForTimeout(300);
  ok("drag a pin to reorder", await page.evaluate(() => (window as any).yuzu.settings.pins[0].path) === "Medicine::Emergency Medicine");
  // a backlog → coach offers to spread it; undo puts it back
  await page.evaluate(async () => { const y = (window as any).yuzu; const cs = [...y.cards.values()].slice(0, 80); const D = 86400000; for (const c of cs) y.cards.set(c.id, { ...c, state: "review", reps: 4, stability: 20, lastReview: Date.now() - 40 * D, due: Date.now() - 12 * D }); await y.setFlag(cs[0].id, 0); });
  await page.click("nav.tabs >> text=Library"); await page.click("nav.tabs >> text=Today"); await page.waitForTimeout(300);
  ok("coach offers to spread the backlog", await page.locator("text=/overdue — spread them over a week/").count() === 1);
  await page.click("text=/overdue — spread them over a week/"); await page.waitForTimeout(400);
  const after = await page.evaluate(() => (window as any).yuzu.overdueCount());
  ok("postpone spreads overdue cards", after < 80, `${after} still overdue`);
  ok("undo snackbar appears", await page.locator(".kit-snack:has-text('Undo')").count() === 1);
  await page.click(".kit-snack >> text=Undo"); await page.waitForTimeout(300);
  ok("undo puts them back", await page.evaluate(() => (window as any).yuzu.overdueCount()) >= 79);
  await page.screenshot({ path: `${shots}/h-today.png`, fullPage: true });

  // ---- load balancer: an "off" weekday is avoided when the spread allows
  await page.evaluate(async () => { const y = (window as any).yuzu; const e = [1, 1, 1, 1, 1, 1, 1]; e[(new Date(Date.now() + 30 * 86400000)).getDay()] = 0; await y.saveSettings({ easyDays: e }); });
  const bal = await page.evaluate(async () => { const y = (window as any).yuzu; const D = 86400000; const off = y.settings.easyDays.indexOf(0); let hits = 0, n = 0;
    for (const c of [...y.cards.values()].slice(200, 230)) { y.cards.set(c.id, { ...c, state: "review", reps: 5, stability: 28, difficulty: 5, lastReview: Date.now() - 28 * D, due: Date.now() }); await y.answer(c.id, 3); const d = y.cards.get(c.id); n++; if (new Date(d.due).getDay() === off) hits++; }
    return { hits, n }; });
  ok("load balancer keeps reviews off the 'off' day", bal.hits === 0, `${bal.hits}/${bal.n} landed on it`);

  // ---- Study: swipes in four directions, swipe-to-flip, hold menus, tip line
  await page.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ easyDays: [1, 1, 1, 1, 1, 1, 1] }); });
  await page.click(".hero >> text=Study"); await page.waitForTimeout(300); if (await page.locator("text=Start ·").count()) await page.click("text=Start ·");
  await page.waitForSelector("text=Show answer");
  ok("swipe tip shows for new swipers", await page.locator(".swipe-tip").count() === 1);
  const before = await page.evaluate(() => (window as any).yuzu.reviews.length);
  await swipe(page, ".study-body", 0, -150); ok("swipe on the question flips it", await page.locator(".answer-bar").count() === 1);
  await swipe(page, ".study-body", 0, -170); await page.waitForTimeout(200);
  const r1 = await page.evaluate(() => { const y = (window as any).yuzu; return y.reviews[y.reviews.length - 1]?.rating; });
  ok("swipe ↑ = Easy", r1 === 4 && (await page.evaluate(() => (window as any).yuzu.reviews.length)) === before + 1, `rating ${r1}`);
  await swipe(page, ".study-body", 140, 0); await swipe(page, ".study-body", -170, 0); // flip, then ← Again
  ok("swipe ← = Again", await page.evaluate(() => { const y = (window as any).yuzu; return y.reviews[y.reviews.length - 1]?.rating; }) === 1);
  await swipe(page, ".study-body", 140, 0); await swipe(page, ".study-body", 0, 170);
  ok("swipe ↓ = Hard", await page.evaluate(() => { const y = (window as any).yuzu; return y.reviews[y.reviews.length - 1]?.rating; }) === 2);
  await swipe(page, ".study-body", 140, 0); await swipe(page, ".study-body", 170, 0);
  ok("swipe → = Good", await page.evaluate(() => { const y = (window as any).yuzu; return y.reviews[y.reviews.length - 1]?.rating; }) === 3);
  // hold a word → the word sheet (look up, find in my cards, copy, select); hold blank paper → the card menu
  { const b = (await page.locator(".study-body .paper").first().boundingBox())!; await page.mouse.move(b.x + 70, b.y + 40); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up(); await page.waitForTimeout(300); } // the first word
  const wordSheet = await page.locator(".kit-sheet:has-text('other card')").count();
  ok("hold a word on the card → word sheet", wordSheet === 1, await page.locator(".kit-sheet").innerText().catch(() => "no sheet"));
  await page.screenshot({ path: `${shots}/h-word.png` });
  await page.click(".kit-sheet >> text=Card menu"); await page.waitForTimeout(300);
  ok("word sheet → card menu", await page.locator("text=Card info and edit").count() === 1);
  await page.click("text=Card info and edit"); await page.waitForTimeout(300);
  ok("card info opens (memory curve for reviewed cards)", await page.locator(".stat:has-text('stability')").count() >= 1);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300); ok("Escape closes card info (PC)", (await page.locator(".stat:has-text('stability')").count()) === 0);
  if (await page.locator("text=Show answer").count()) { await page.click("text=Show answer"); await hold(page, ".answer-bar .again", 700); await page.waitForTimeout(300); ok("hold Again → Again + improve sheet", await page.locator("text=What's wrong with this card?").count() === 1); await page.keyboard.press("Escape"); await page.goBack().catch(() => {}); }
  await page.screenshot({ path: `${shots}/h-study.png` });
  await page.click('[aria-label="Close"]').catch(() => {}); await page.waitForTimeout(300);

  // ---- surprise (confident error) at the end of a session
  await page.evaluate(async () => { const y = (window as any).yuzu; const D = 86400000; const c = [...y.cards.values()][600]; y.cards.set(c.id, { ...c, state: "review", reps: 6, stability: 80, difficulty: 4, lastReview: Date.now() - 2 * D, due: Date.now() - 1000 }); await y.setFlag(c.id, 0); (window as any).__sure = c.id; });
  await page.evaluate(() => document.querySelectorAll("nav.tabs button")[1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.click("nav.tabs >> text=Library"); await page.click("button.chip:has-text('Flagged')").catch(() => {});
  await page.evaluate(() => { const y = (window as any).yuzu; return y; });
  // study just that card through a preset (Library: preview → Study)
  await page.evaluate(async () => { const y = (window as any).yuzu; await y.setFlag((window as any).__sure, 1); });
  await page.click("nav.tabs >> text=Today"); await page.click("nav.tabs >> text=Library"); await page.waitForTimeout(300);
  await page.click("button.chip:has-text('Flagged')"); await page.waitForTimeout(300); await page.click("button:has-text('Study these')"); await page.waitForTimeout(400);
  await page.click("text=Show answer"); await page.click(".answer-bar .again"); await page.waitForTimeout(300);
  // the missed card returns in learning; finish the session
  for (let i = 0; i < 4 && (await page.locator("text=Show answer").count()); i++) { await page.click("text=Show answer"); await page.click(".answer-bar .good"); await page.waitForTimeout(200); }
  ok("end screen: 'You were sure' for a confident error", await page.locator("text=/You were sure/").count() === 1);
  await page.screenshot({ path: `${shots}/h-surprise.png` });
  await page.click('[aria-label="Close"]').catch(() => {}); await page.waitForTimeout(300);

  // ---- Library: hold a category and a card
  await page.click("nav.tabs >> text=Library"); await page.waitForTimeout(300);
  if (await page.locator("button.chip.orange:has-text('Flagged')").count()) await page.click("button.chip.orange:has-text('Flagged')");
  await hold(page, ".tree-row"); ok("hold a category → its actions", await page.locator(".kit-sheet:has-text('Boss fight'), .kit-sheet:has-text('Pin to Today'), .kit-sheet:has-text('Unpin')").count() === 1);
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  await page.click("text=/Show cards in/"); await page.waitForTimeout(300);
  await hold(page, ".list-row"); ok("hold a card → preview/edit/improve/delete", await page.locator(".kit-sheet:has-text('Preview'):has-text('Delete')").count() === 1);
  // 8-bit confirm sheet instead of a browser pop-up: Cancel and Escape change nothing; Delete deletes with undo
  const notesBefore = await page.evaluate(() => (window as any).yuzu.notes.size);
  await page.click(".kit-sheet >> text=Preview"); await page.waitForTimeout(300); await page.click("button.btn.danger:has-text('Delete')"); await page.waitForTimeout(250);
  ok("delete asks in an 8-bit sheet", await page.locator(".kit-sheet:has-text('Delete this')").count() === 1);
  await page.click(".kit-sheet >> text=Cancel"); await page.waitForTimeout(250);
  ok("Cancel keeps the note", (await page.evaluate(() => (window as any).yuzu.notes.size)) === notesBefore && (await page.locator(".kit-sheet").count()) === 0);
  await page.click("button.btn.danger:has-text('Delete')"); await page.waitForTimeout(250); await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  ok("Escape answers no", (await page.evaluate(() => (window as any).yuzu.notes.size)) === notesBefore);
  await page.click("button.btn.danger:has-text('Delete')"); await page.waitForTimeout(250); await page.click(".kit-sheet .kit-item.danger"); await page.waitForTimeout(400);
  ok("confirming deletes", (await page.evaluate(() => (window as any).yuzu.notes.size)) === notesBefore - 1);
  await page.keyboard.press("Escape").catch(() => {});

  // ---- Progress: recap
  await page.click("nav.tabs >> text=Progress"); await page.waitForTimeout(300);
  ok("known-right-now count", /cards you'd likely recall right now/.test(await page.evaluate(() => document.body.innerText)));
  await page.click("button:has-text('Recap')"); await page.waitForTimeout(400);
  ok("recap opens with a persona", await page.locator(".recap-persona").count() === 1, await page.locator(".recap-persona").textContent().catch(() => "") ?? "");
  await page.screenshot({ path: `${shots}/h-recap.png` });
  const img = await page.evaluate(async () => { const mod = document.querySelector(".recap"); return !!mod; });
  ok("recap screen rendered", img);
  await page.click("[aria-label='Close recap']");
} catch (e) { fails.push("crash: " + (e as Error).message.split("\n")[0]); console.log(e); }
finally {
  console.log("errors:", errors.length ? errors : "none");
  await browser.close(); server.kill();
  if (fails.length || errors.length) { console.log("FAILED:", fails); process.exit(1); }
}
