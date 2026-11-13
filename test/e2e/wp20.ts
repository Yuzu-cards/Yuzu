// WP20 — Settings usability and safety, on a touch phone: sliders ignore a scroll gesture and a track tap (only a sideways
// drag on the thumb or − / + change them, with Undo); confirmations for the reverse switch (Languages decks only, the right
// message, Undo), Delete everything (lists what goes, needs DELETE typed), Disconnect, Roll back (8-bit sheet, danger),
// Put Sketchy back and hidden-field chips; impossible dates refused; the jump row in the page's order with no dead chips;
// New day starts at up to 12:00.
import { chromium, type Page, type CDPSession } from "playwright"; import { spawn } from "node:child_process";
const port = 5200 + Number(process.env.PORT_OFFSET ?? 0); /* PORT_OFFSET lets several copies run at once */ const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = []; const dialogs: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`;
const de = { yuzu_pack: 1, id: "de", category: "Languages::German", cards: [{ id: "d1", front: "der Hund", back: "the dog" }, { id: "d2", front: "die Katze", back: "the cat" }] };
const med = { yuzu_pack: 1, id: "med", category: "Medicine::Cardio", cards: [{ id: "m1", front: "IV magnesium sulfate", back: "Drug of choice for torsades?" }, { id: "m2", front: "Urea > 7 mmol/L", back: "CURB-65: what is U?" }] };
const S = (p: Page) => p.evaluate(() => (window as any).yuzu.settings);
/** A real touch swipe through CDP: Chrome decides whether it is a scroll (pointercancel) or a drag, like on a phone. */
async function swipe(cdp: CDPSession, from: [number, number], to: [number, number], steps = 12) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from[0], y: from[1] }] });
  for (let i = 1; i <= steps; i++) { const x = from[0] + ((to[0] - from[0]) * i) / steps, y = from[1] + ((to[1] - from[1]) * i) / steps; await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] }); await new Promise((r) => setTimeout(r, 16)); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function track(p: Page, label: string) { const loc = p.locator(`input[type=range][aria-label="${label}"]`); await loc.scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -120)); await p.waitForTimeout(150); return (await loc.boundingBox())!; }
try {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon|Failed to load resource|googleapis|503/.test(m.text())) errors.push("console: " + m.text()); });
  await page.route(/https:\/\/(www\.googleapis\.com|accounts\.google\.com)\/.*/, (r) => r.fulfill({ status: 503, body: "{}" }));
  await page.goto(URL); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  await page.evaluate(async ([a, b]) => { const y = (window as any).yuzu; await y.importPack(a); await y.importPack(b); }, [de, med]);
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details.section").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.waitForTimeout(300);

  // ---- 05-1 sliders
  const s0 = await S(page);
  let b = await track(page, "New cards per day"); const y0 = b.y + b.height / 2;
  await swipe(cdp, [b.x + b.width * 0.85, y0], [b.x + b.width * 0.85 + 6, y0 - 260]); await page.waitForTimeout(400);
  ok("a vertical swipe starting on the track (a scroll) leaves New cards per day alone", (await S(page)).newPerDay === s0.newPerDay, `${s0.newPerDay} → ${(await S(page)).newPerDay}`);
  b = await track(page, "Daily review goal");
  await page.touchscreen.tap(b.x + b.width * 0.9, b.y + b.height / 2); await page.waitForTimeout(400);
  ok("a tap on the track leaves Daily review goal alone", (await S(page)).dailyGoal === s0.dailyGoal, `${s0.dailyGoal} → ${(await S(page)).dailyGoal}`);
  b = await track(page, "New cards per day");
  const thumb = b.x + 11 + ((s0.newPerDay - 0) / 100) * (b.width - 22);
  await swipe(cdp, [thumb, b.y + b.height / 2], [thumb + 90, b.y + b.height / 2 + 4]); await page.waitForTimeout(400);
  const dragged = (await S(page)).newPerDay;
  ok("dragging the thumb sideways changes it", dragged > s0.newPerDay + 10, `${s0.newPerDay} → ${dragged}`);
  const snack = await page.locator(".kit-snack").innerText().catch(() => "");
  ok("…and a snackbar says the new value with Undo", snack.includes(`New cards per day: ${dragged}`) && /Undo/.test(snack), snack);
  await page.click(".kit-snack >> text=Undo"); await page.waitForTimeout(300);
  ok("…Undo puts it back", (await S(page)).newPerDay === s0.newPerDay);
  await page.locator('button[aria-label="More: New cards per day"]').tap(); await page.locator('button[aria-label="More: New cards per day"]').tap(); await page.waitForTimeout(1300);
  ok("the + button steps it by a deliberate tap (two taps, one commit)", (await S(page)).newPerDay === s0.newPerDay + 2, String((await S(page)).newPerDay));
  const kb = page.locator('input[type=range][aria-label="Daily review goal"]'); await kb.focus(); await page.keyboard.press("ArrowRight"); await kb.blur(); await page.waitForTimeout(300);
  ok("the keyboard still works on the range", (await S(page)).dailyGoal === s0.dailyGoal + 10, String((await S(page)).dailyGoal));

  // ---- 05-12 jump row: page order, no chip without its group
  const jr = await page.evaluate(() => {
    const chips = [...document.querySelectorAll<HTMLElement>(".jump-row .chip[data-to]")].map((c) => c.dataset.to!);
    const page = [...document.querySelectorAll<HTMLElement>("details.section[id]")].map((d) => d.id).filter((id) => chips.includes(id));
    return { chips, page, dead: chips.filter((id) => !document.getElementById(id)), h: Math.round(document.querySelector(".jump-row .chip")!.getBoundingClientRect().height) };
  });
  ok("jump row chips follow the page's order", jr.chips.join() === jr.page.join(), jr.chips.join(" "));
  ok("…every chip has its group on the page, and chips are 44 px", jr.dead.length === 0 && jr.h >= 44, JSON.stringify({ dead: jr.dead, h: jr.h }));

  // ---- 05-3 reverse cards: Languages only, message right, Undo
  await page.locator("#s-lang input[type=checkbox]").first().scrollIntoViewIfNeeded();
  await page.locator("#s-lang input[type=checkbox]").first().click(); await page.waitForTimeout(600);
  const rev = await page.evaluate(() => { const y = (window as any).yuzu; const r = [...y.cards.values()].filter((c: any) => c.ord > 0); return { de: r.filter((c: any) => c.source.startsWith("Languages") && !c.suspended).length, med: r.filter((c: any) => !c.source.startsWith("Languages")).length }; });
  const revMsg = await page.locator("#s-lang p.small.muted").last().innerText();
  ok("reverse switch adds reverse cards to the German cards only (none to Medicine)", rev.de === 2 && rev.med === 0, JSON.stringify(rev));
  ok("…and the message says added", /2 reverse cards added/.test(revMsg), revMsg);
  await page.click(".kit-snack >> text=Undo"); await page.waitForTimeout(500);
  ok("…Undo pauses them again", await page.evaluate(() => [...(window as any).yuzu.cards.values()].filter((c: any) => c.ord > 0 && !c.suspended).length) === 0);

  // ---- 05-10 dates
  const bf = page.locator('[aria-label="Break from"] input[type=text]'), bt = page.locator('[aria-label="Break to"] input[type=text]');
  await bf.fill("20/11/2026"); await bf.press("Enter"); await page.waitForTimeout(200); await bt.fill("10/11/2026"); await bt.press("Enter"); await page.waitForTimeout(200);
  const brk = await S(page); const bmsg = await page.locator('span.kit-date[aria-label="Break to"]').innerText();
  ok("a break ending before it starts is refused, with the reason", brk.breakFrom === "2026-11-20" && brk.breakTo === "" && /Must be on or after 20\/11\/2026/.test(bmsg), `${brk.breakFrom} ${brk.breakTo} · ${bmsg}`);
  await page.fill("#s-exam input[placeholder='Step 1']", "Old exam"); const ed = page.locator('[aria-label="Exam date"] input[type=text]'); await ed.fill("01/01/2020"); await ed.press("Enter"); await page.waitForTimeout(200);
  ok("an exam in the past is refused and Add exam stays off", /Must be on or after/.test(await page.locator('span.kit-date[aria-label="Exam date"]').innerText()) && await page.locator("#s-exam button:has-text('Add exam')").isDisabled());

  // ---- 05-21 rollover up to 12:00
  const opts = await page.locator("select").evaluateAll((els) => { const s = els.find((e) => [...(e as HTMLSelectElement).options].some((o) => o.text === "04:00")) as HTMLSelectElement | undefined; return s ? [...s.options].map((o) => o.value) : []; });
  ok("New day starts at offers 00:00–12:00", opts.length === 13 && opts[12] === "12", opts.join(","));

  // ---- 05-11 Sketchy: chip removal has Undo; Put Sketchy back asks first
  await page.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ hiddenFields: [...y.settings.hiddenFields.filter((f: string) => f !== "Sketchy"), "Sketchy"] }); });
  await page.locator('button[aria-label="Show Sketchy again"]').tap(); await page.waitForTimeout(200);
  ok("removing the Sketchy chip offers Undo", /Sketchy shows again/.test(await page.locator(".kit-snack").innerText().catch(() => "")));
  await page.click(".kit-snack >> text=Undo"); await page.waitForTimeout(300);
  ok("…and Undo hides it again", (await S(page)).hiddenFields.includes("Sketchy"));
  await page.evaluate(async () => { const y = (window as any).yuzu; const nt = { id: "ak", name: "AnKingOverhaul", kind: "cloze", css: "", fields: ["Text", "Extra", "Sketchy"], templates: [{ name: "Cloze", qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}" }] };
    y.notetypes.set("ak", nt); await y._db.putMany("notetypes", [nt]); const n = { id: "nsk", ntid: "ak", guid: "gsk", fields: ["Fact {{c1::x}}", "", "Sketchy story"], tags: ["#AK_Step1_v12::^Resources::Sketchy::Micro"], modified: Date.now() };
    y.notes.set(n.id, n); await y._db.putMany("notes", [n]); await y.stripSketchyOnce(); y.bump?.(); });
  await page.click("nav.tabs >> text=Today"); await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => { (document.getElementById("s-data") as HTMLDetailsElement).open = true; }); await page.waitForTimeout(300);
  await page.locator("button:has-text('Put Sketchy back')").tap(); await page.waitForTimeout(200);
  ok("Put Sketchy back asks in a sheet first", await page.locator('[role=dialog][aria-label="Put Sketchy back?"]').count() === 1);
  await page.locator('[role=dialog] .kit-cancel').tap(); await page.waitForTimeout(200);
  ok("…and Cancel leaves Sketchy off", await page.evaluate(() => (window as any).yuzu.notes.get("nsk").fields[2] === ""));

  // ---- 05-8 / 05-9 / 05-20 Google: Disconnect and Roll back ask in the 8-bit sheet; backups rows have date, time, counts
  await page.evaluate(async () => { localStorage.setItem("yuzu-google", JSON.stringify({ access: "t", expires: Date.now() + 3600e3, email: "a@b", scope: "" }));
    const y = (window as any).yuzu; await y.saveSettings({ sync: { ...y.settings.sync, backend: "drive" } }); y.backups = { ...y.backups, list: [{ name: "2026-11-12", id: "b1", rev: null, at: new Date("2026-11-12T21:05:00").getTime(), counts: { notes: 5, cards: 6, reviews: 7 } }], at: "now" }; });
  await page.click("nav.tabs >> text=Today"); await page.click("nav.tabs >> text=Settings"); await page.waitForTimeout(300);
  await page.evaluate(() => { const y = (window as any).yuzu; y.refreshBackups = async () => y.backups.list; document.querySelectorAll("#s-google details").forEach((d) => { (d as HTMLDetailsElement).open = true; }); }); await page.waitForTimeout(300);
  ok("no 'Use GitHub instead' while GitHub isn't set up", await page.locator("#s-google button:has-text('Use GitHub instead')").count() === 0);
  await page.locator("#s-google button:has-text('Disconnect')").tap(); await page.waitForTimeout(200);
  ok("Disconnect asks first, saying sync stops", await page.locator('[role=dialog][aria-label="Stop syncing through Drive?"]').count() === 1);
  await page.locator('[role=dialog] .kit-cancel').tap(); await page.waitForTimeout(200);
  ok("…Cancel keeps Drive sync", await page.evaluate(() => (window as any).yuzu.syncBackend()) === "drive");
  const row = await page.locator("[data-testid=backup-row]").first().innerText();
  ok("a backup row shows dd/mm/yyyy, the time and the counts", /12\/11\/2026/.test(row) && /21:05/.test(row) && /6 cards/.test(row), row.replace(/\n/g, " | "));
  ok("Roll back is styled as dangerous", await page.locator("[data-testid=backup-row] button:has-text('Roll back')").evaluate((e) => e.classList.contains("danger")));
  await page.locator("[data-testid=backup-row] button:has-text('Roll back')").tap(); await page.waitForSelector('[role=dialog][aria-label^="Roll"]', { timeout: 5000 }).catch(() => {});
  // Roll back first previews the backup from Drive (wp05; covered with a stand-in Drive in wp05.ts), so here only: never a browser dialog
  ok("Roll back never opens a browser dialog", dialogs.length === 0, dialogs.join(" / "));
  if (await page.locator('[role=dialog] .kit-cancel').count()) { await page.locator('[role=dialog] .kit-cancel').tap(); await page.waitForTimeout(200); }
  await page.evaluate(() => localStorage.removeItem("yuzu-google"));

  // ---- 05-7 Delete everything: lists what goes, needs DELETE typed; then everything (settings too) is gone
  await page.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ newPerDay: 33, sync: { ...y.settings.sync, backend: "github" } }); });
  await page.click("nav.tabs >> text=Today"); await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => { (document.getElementById("s-data") as HTMLDetailsElement).open = true; }); await page.waitForTimeout(200);
  await page.locator("button:has-text('Delete everything on this device')").tap(); await page.waitForTimeout(200);
  const list = await page.locator("[data-testid=wipe-list]").innerText();
  ok("the wipe sheet lists cards, media, settings and exam dates", /cards/.test(list) && /images and sounds/.test(list) && /settings/.test(list) && /exam/.test(list), list.replace(/\n/g, " | "));
  const del = page.locator('[role=dialog] .kit-item.danger');
  ok("…the delete button is off until DELETE is typed", await del.isDisabled());
  await page.fill("#wipe-type", "delete"); ok("…and on once it is", !(await del.isDisabled()));
  await Promise.all([page.waitForEvent("load"), del.tap()]); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  const after = await page.evaluate(() => ({ cards: (window as any).yuzu.cards.size, newPerDay: (window as any).yuzu.settings.newPerDay }));
  ok("…after it, cards and settings are gone (no stale settings in memory)", after.cards === 0 && after.newPerDay === 20, JSON.stringify(after));

  ok("no browser confirm/alert anywhere", dialogs.length === 0, dialogs.join(" / "));
  await ctx.close();
} catch (e: any) { fails.push("crashed: " + (e?.stack ?? e)); console.log(e); }
finally {
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "));
  await browser.close(); server.kill();
  console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join("\n- ")}` : "\nall passed"); process.exit(fails.length ? 1 : 0);
}
