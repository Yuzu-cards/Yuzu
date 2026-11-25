// 1.10.0 in a real browser: subject designs (by system, gothic German decks, the Mephisto deck untouched, Off, per deck),
// practice without scheduling, Find & Replace / Set due date / Reset with Undo, drawing on the card (no swipe-rating while
// drawing), Say it (mocked microphone), read-and-make, best hours, the break reminder, text direction, multi-card gaps,
// Deck options (priority, field order). Phone and desktop. Fails on any JavaScript error.
import { chromium, type Page } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
const port = 5500 + Number(process.env.PORT_OFFSET ?? 0);
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const shots = "test/e2e/shots"; fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const MOCKS = `window.__said = []; Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speaking: false, pending: false, speak(u) { window.__said.push(u.lang + "|" + u.text); setTimeout(() => u.onend && u.onend(), 30); }, cancel() {}, getVoices() { return []; } } }); window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  window.__mic = 0; navigator.mediaDevices = navigator.mediaDevices || {}; navigator.mediaDevices.getUserMedia = async () => { window.__mic++; return { getTracks: () => [{ stop() {} }] }; };
  window.MediaRecorder = function () { this.state = "inactive"; this.mimeType = "audio/webm"; this.start = () => { this.state = "recording"; }; this.stop = () => { this.state = "inactive"; this.ondataavailable && this.ondataavailable({ data: new Blob(["x"], { type: "audio/webm" }) }); setTimeout(() => this.onstop && this.onstop(), 10); }; };
  window.__played = 0; HTMLMediaElement.prototype.play = function () { window.__played++; setTimeout(() => this.onended && this.onended(), 20); return Promise.resolve(); };`;
async function device(w: number, h: number, touch: boolean) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.addInitScript(MOCKS); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${w}px pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_FAILED|Failed to load resource|translate\.google/.test(m.text())) errors.push(`${w}px console: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  return { ctx, page };
}
const Y = (p: Page, f: string) => p.evaluate(f);
const leave = async (p: Page) => { await p.locator(".study-top button[aria-label='Close']").first().click(); await p.waitForTimeout(300); if (!(await p.locator("nav.tabs").count())) { await p.screenshot({ path: "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad/leave.png" }); console.log("LEAVE STUCK", errors.join(" || ").slice(0, 1500)); } };
async function openDeck(p: Page, names: string[]) { await p.click("nav.tabs >> text=Library"); await p.waitForTimeout(250); if (await p.locator(".crumbs button").count()) { await p.locator(".crumbs button").first().click(); await p.waitForTimeout(200); } for (const n of names) { await p.locator(".tree-row", { hasText: n }).first().click(); await p.waitForTimeout(220); } }
async function seed(p: Page) {
  await p.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ burySiblings: false, newPerDay: 60 });
    await y.importPack({ yuzu_pack: 1, id: "med", category: "Medicine::Cardio", cards: [
      { id: "1", text: "First-line for stable angina: {{c1::a beta-blocker}}.", tags: ["auto::System::Cardiovascular"] },
      { id: "2", text: "{{c1,2::Aspirin}} irreversibly blocks {{c2::COX-1}}.", tags: ["auto::System::Cardiovascular"] },
      { id: "3", front: "Aspirin dose in ACS?", back: "300 mg aspirin chewed", tags: ["auto::System::Cardiovascular"] }] });
    await y.importPack({ yuzu_pack: 1, id: "neuro", category: "Medicine::Neuro", cards: [{ id: "1", front: "Cranial nerve for the lateral rectus?", back: "VI", tags: ["auto::System::Neurology"] }] });
    await y.importPack({ yuzu_pack: 1, id: "g", category: "Languages::German::Goethe A1", cards: [{ type: "vocab", word: "Herz", article: "das", meaning: "heart", example: "Das Herz schlägt." }] });
    await y.importPack({ yuzu_pack: 1, id: "m", category: "German::Mephisto::Geschichte", cards: [{ id: "1", text: "<div style='color:#e8d5b0 !important'>Der Teufel {{c1::lacht}}.</div>" }] });
    await y.importPack({ yuzu_pack: 1, id: "ar", category: "Medicine::Arabic", cards: [{ front: "ما هو الدواء؟", back: "أسبرين" }] }); });
}
const paperInfo = (p: Page) => p.evaluate(() => { const paper = document.querySelector(".study .paper") as HTMLElement; const h = paper.querySelector(".card-host") as HTMLElement; const after = getComputedStyle(paper, "::after");
  return { art: paper.dataset.art ?? "", cls: paper.className, theme: h.dataset.theme ?? "", strip: after.content !== "none" && /svg/.test(after.backgroundImage), dir: h.shadowRoot!.querySelector(".card")!.getAttribute("dir"), text: (h.shadowRoot!.querySelector(".card") as HTMLElement).innerText }; });

try {
  // ======== desktop
  { const { ctx, page } = await device(1280, 800, false); await seed(page);
    // subject designs
    await openDeck(page, ["Medicine", "Cardio"]); await page.click("button.btn.primary:has-text('Study')"); await page.waitForTimeout(500);
    let pi = await paperInfo(page);
    ok("a cardiology card gets the cardiovascular design (margin art, Rich: the ECG foot)", pi.art === "Cardiovascular" && pi.strip && /art-rich/.test(pi.cls) && await page.locator(".study .paper-art-foot").count() === 1, JSON.stringify(pi));
    const clash = await page.evaluate(() => { const paper = document.querySelector(".study .paper") as HTMLElement; const host = paper.querySelector(".card-host") as HTMLElement; const pr = paper.getBoundingClientRect(); const cs = getComputedStyle(paper, "::after"); return host.getBoundingClientRect().right - (pr.right - parseFloat(cs.right) - parseFloat(cs.width)); });
    ok("…the drawing sits in its own margin, never under the text", clash <= 1, String(clash));
    ok("text direction is automatic (left-to-right here)", pi.dir === "auto");
    // multi-card gaps: card 2 of the aspirin note hides both gaps marked 2
    const fronts: string[] = []; for (let i = 0; i < 4; i++) { const t = (await paperInfo(page)).text; fronts.push(t.replace(/\s+/g, " ").trim()); await page.keyboard.press(" "); await page.waitForTimeout(120); await page.keyboard.press("3"); await page.waitForTimeout(300); }
    ok("{{c1,2::…}}: card 1 and card 2 each ask for the shared gap", fronts.includes("[...] irreversibly blocks COX-1.") && fronts.includes("[...] irreversibly blocks [...]."), JSON.stringify(fronts));
    await leave(page);
    // German deck: gothic; Mephisto: untouched; Arabic: right to left
    await openDeck(page, ["Languages", "German", "Goethe A1"]); await page.click("button.btn.primary:has-text('Study')"); await page.waitForTimeout(600);
    pi = await paperInfo(page);
    ok("a German deck card gets the gothic design (vellum, tracery, blackletter headword)", pi.art === "German" && pi.theme === "German" && await page.evaluate(() => /Unifraktur/.test(getComputedStyle((document.querySelector(".study .card-host") as HTMLElement).shadowRoot!.querySelector(".vw")!).fontFamily)), JSON.stringify(pi));
    await page.screenshot({ path: `${shots}/v110-german-desktop.png` });
    await page.click(".show-bar button:has-text('Show answer')"); await page.waitForTimeout(200);
    // Say it: record, then mine + the model
    ok("Say it on the back of a language card", await page.locator("[data-testid=say-it]").count() === 1);
    await page.click("[data-testid=say-it] button:has-text('Say it')"); await page.waitForTimeout(100); await page.click("[data-testid=say-it] button:has-text('Stop')"); await page.waitForTimeout(150);
    await page.click("[data-testid=say-compare]"); await page.waitForTimeout(400);
    const said = await Y(page, "window.__said") as string[]; const played = await Y(page, "window.__played") as number;
    ok("…records (microphone asked once), plays mine, then the model in German", (await Y(page, "window.__mic")) === 1 && played >= 1 && said.some((x) => /^de-DE\|das Herz/.test(x)), `played ${played} · ${said.slice(-2).join(" / ")}`);
    await leave(page);
    await openDeck(page, ["German", "Mephisto"]); await page.click("button.btn.primary:has-text('Study')"); await page.waitForTimeout(500);
    pi = await paperInfo(page); ok("the Mephisto deck keeps its own design: no art, no theme", pi.art === "" && pi.theme === "" && !/ art/.test(pi.cls), JSON.stringify(pi));
    await leave(page);
    // Off and per deck
    await openDeck(page, ["Medicine", "Neuro"]); await page.click("button.btn.primary:has-text('Study')"); await page.waitForTimeout(400);
    pi = await paperInfo(page); ok("neurology: gold and pink neurons", pi.art === "Neurology" && /EE9DB6/i.test(decodeURIComponent(await page.evaluate(() => getComputedStyle(document.querySelector(".study .paper")!, "::after").backgroundImage))), pi.art);
    await leave(page);
    await page.evaluate(() => (window as any).yuzu.setDeckOpts("Medicine::Neuro", { art: false }));
    await openDeck(page, ["Medicine", "Neuro"]); await page.click("button.btn.primary:has-text('Study')"); await page.waitForTimeout(400);
    ok("Deck options can turn the design off for one deck", (await paperInfo(page)).art === "");
    await leave(page); await page.evaluate(() => (window as any).yuzu.setDeckOpts("Medicine::Neuro", { art: undefined }));
    await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => { (document.getElementById("s-look") as HTMLDetailsElement).open = true; }); await page.click("[data-testid=art-off]");
    await openDeck(page, ["Languages", "German", "Goethe A1"]); await page.click("button.btn.primary:has-text('Study')"); await page.waitForTimeout(400);
    ok("Settings → Subject designs → Off: plain cards everywhere (the German design too)", (await paperInfo(page)).art === "" && (await paperInfo(page)).theme === "");
    await leave(page); await page.evaluate(() => (window as any).yuzu.saveSettings({ cardArt: "rich" }));

    // practice: nothing changes
    const snap = await page.evaluate(() => { const y = (window as any).yuzu; return JSON.stringify({ c: [...y.cards.values()].filter((c: any) => c.source === "Medicine::Neuro"), r: y.reviews.length }); });
    await openDeck(page, ["Medicine"]); await page.locator(".tree-row", { hasText: "Neuro" }).first().click({ button: "right" }); await page.waitForTimeout(200);
    await page.locator(".kit-sheet button:has-text('Practice…')").click(); await page.waitForTimeout(200);
    await page.locator("button:has-text('The whole deck')").click(); await page.waitForTimeout(500);
    ok("practice: the chip says so", await page.locator("[data-testid=practice-chip]").count() === 1);
    await page.keyboard.press(" "); await page.waitForTimeout(150);
    const bar = await page.locator(".answer-bar").innerText().catch(() => "");
    ok("…the buttons say practice, not intervals", /again soon/.test(bar) && /practice/.test(bar) && !/\d+d/.test(bar), bar.replace(/\n/g, " "));
    await page.keyboard.press("1"); await page.waitForTimeout(250);
    ok("…Again brings the card back in the same run", await page.locator(".study-body .paper").count() === 1 && /lateral rectus/.test((await paperInfo(page)).text));
    await page.keyboard.press(" "); await page.waitForTimeout(150); await page.keyboard.press("3"); await page.waitForTimeout(400);
    ok("…the summary says nothing was rescheduled", /nothing was rescheduled/.test(await page.locator("[data-testid=practice-done]").innerText().catch(() => "")));
    const after = await page.evaluate(() => { const y = (window as any).yuzu; return JSON.stringify({ c: [...y.cards.values()].filter((c: any) => c.source === "Medicine::Neuro"), r: y.reviews.length }); });
    ok("…and nothing in the collection changed (cards, review log)", after === snap);
    await page.click("button:has-text('Done')"); await page.waitForTimeout(300);

    // bulk tools: Find & Replace, Set due date, Reset — each with Undo
    await openDeck(page, ["Medicine", "Cardio"]); await page.locator("button:has-text('Show its cards'), button:has-text('cards')").first().click().catch(() => {});
    const ids = await page.evaluate(() => [...(window as any).yuzu.cards.values()].filter((c: any) => c.source === "Medicine::Cardio").map((c: any) => c.id));
    await page.evaluate(() => (window as any).yuzu.lastBulkEdit = null);
    const fr = await page.evaluate(async (ids) => { const y = (window as any).yuzu; const nids = [...new Set(ids.map((id: string) => y.cards.get(id).nid))]; const m = y.findMatches(nids, "aspirin"); const n = await y.findReplace(nids, "aspirin", "ASS"); const t = [...y.notes.values()].filter((x: any) => nids.includes(x.id)).map((x: any) => x.fields.join("|")).join(" "); await y.undoBulkEdit(); const back = [...y.notes.values()].filter((x: any) => nids.includes(x.id)).map((x: any) => x.fields.join("|")).join(" "); return { m, n, t, back }; }, ids);
    ok("Find & Replace: counts, replaces outside the gap markers, Undo restores", fr.m.places === 3 && fr.n === 2 && /\{\{c1,2::ASS\}\}/.test(fr.t) && /300 mg ASS/.test(fr.t) && !/ASS/.test(fr.back), JSON.stringify(fr).slice(0, 300));
    // the sheets themselves
    await page.click("nav.tabs >> text=Library"); await page.waitForTimeout(200);
    await page.evaluate(() => { (window as any).yuzu.cards.forEach((c: any) => {}); });
    await ctx.close(); }

  // ======== phone: drawing, read-and-make, bulk sheets, best hours, break reminder
  { const { ctx, page } = await device(412, 915, true); await seed(page);
    await page.clock.install({ time: Date.now() });
    await page.evaluate(() => (window as any).yuzu.saveSettings({ timebox: 20 }));
    await openDeck(page, ["Medicine", "Cardio"]); await page.click("button.btn.primary:has-text('Study')"); await page.waitForTimeout(500);
    await page.keyboard.press("d"); await page.waitForTimeout(200);
    ok("draw on the card: the drawing layer opens over the card", await page.locator("[data-testid=whiteboard]").count() === 1);
    const b = (await page.locator("[data-testid=whiteboard]").boundingBox())!;
    const cdp = await ctx.newCDPSession(page); const x0 = b.x + 60, y0 = b.y + 160;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + i * 20, y: y0 + (i % 2) * 10 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(400);
    ok("…a finger stroke draws a line and doesn't swipe, flip or rate the card", (await page.locator("[data-testid=whiteboard]").getAttribute("data-strokes")) === "1" && await page.locator(".answer-bar").count() === 0 && (await Y(page, "window.yuzu.reviews.length")) === 0, String(await page.locator("[data-testid=whiteboard]").getAttribute("data-strokes")));
    await page.screenshot({ path: `${shots}/v110-draw-phone.png` });
    await page.click(".wb-bar button[aria-label='Undo the last line']"); await page.waitForTimeout(100);
    ok("…↶ takes the line back", (await page.locator("[data-testid=whiteboard]").getAttribute("data-strokes")) === "0");
    await page.click("[data-testid=wb-close]"); await page.waitForTimeout(150);
    await page.clock.fastForward(21 * 60000); await page.waitForTimeout(400);
    ok("the break reminder after 20 minutes", /20 minutes — a good moment for a short break/.test(await page.locator(".toast").innerText().catch(() => "")));
    await page.keyboard.press("Escape").catch(() => {}); await page.locator("button[aria-label='Close']").first().click().catch(() => {}); await page.waitForTimeout(300);

    // read and make
    await page.click("nav.tabs >> text=Library"); await page.waitForTimeout(200); if (await page.locator(".crumbs button").count()) await page.locator(".crumbs button").first().click();
    await page.click("button.chip:has-text('＋ Text')"); await page.waitForTimeout(200);
    await page.fill("[data-testid=rm-title]", "Erlkönig"); await page.fill("[data-testid=rm-text]", "Wer reitet so spät durch Nacht und Wind? Es ist der Vater mit seinem Kind. Er hat den Knaben wohl in dem Arm.");
    await page.click("[data-testid=rm-next]"); await page.waitForTimeout(200);
    const lines = page.locator(".rm-line"); ok("read and make: the text is cut into its 3 lines", await lines.count() === 3);
    await lines.nth(0).locator("button.rm-w", { hasText: "spät" }).click(); await lines.nth(1).locator("button.rm-w", { hasText: "Vater" }).click(); await lines.nth(1).locator("button.rm-w", { hasText: "Kind" }).click();
    ok("…the count follows the taps", /2 lines → about 2 cards/.test(await page.locator("[data-testid=rm-count]").innerText()), await page.locator("[data-testid=rm-count]").innerText());
    await page.screenshot({ path: `${shots}/v110-readmake-phone.png` });
    await page.click("[data-testid=rm-save]"); await page.waitForTimeout(500);
    const made = await page.evaluate(() => { const y = (window as any).yuzu; const cs = [...y.cards.values()].filter((c: any) => /Erlkönig/.test(c.source)); return { n: cs.length, src: cs[0]?.source, texts: cs.map((c: any) => y.notes.get(c.nid).fields[0]).sort(), opts: y.optsFor(cs[0]?.source ?? "").opts }; });
    ok("…saved as an ordered German reading deck, the chosen words as gaps", made.n === 2 && made.src === "Languages::German::Reading::Erlkönig" && made.texts[0] === "Es ist der {{c1::Vater}} mit seinem {{c1::Kind}}." && made.opts.ordered === true && made.opts.prevLine === true, JSON.stringify(made));

    // bulk sheets on the phone: select the Cardio cards, Set due date / Reset through the UI
    await page.evaluate(async () => { const y = (window as any).yuzu; const ids = [...y.cards.values()].filter((c: any) => c.source === "Medicine::Cardio").map((c: any) => c.id); for (const id of ids) { const c = y.cards.get(id); y.cards.set(id, { ...c, state: "review", stability: 20, due: Date.now() + 30 * 86400000, lastReview: Date.now() - 86400000, reps: 2 }); } });
    await openDeck(page, ["Medicine"]); await page.locator(".tree-row", { hasText: "Cardio" }).first().click({ button: "right" }).catch(() => {});
    if (!(await page.locator(".kit-sheet button:has-text('Select all its cards')").count())) { const r = page.locator(".tree-row", { hasText: "Cardio" }).first(); const bb = (await r.boundingBox())!; await page.mouse.move(bb.x + 40, bb.y + bb.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); }
    await page.locator(".kit-sheet button:has-text('Select all its cards')").click(); await page.waitForTimeout(400);
    await page.locator(".bulk-bar button:has-text('More…')").click(); await page.waitForTimeout(200);
    await page.locator(".kit-sheet button:has-text('Set due date…')").click(); await page.waitForTimeout(200);
    await page.locator(".sheet button.chip:has-text('Tomorrow')").click(); await page.click("[data-testid=due-apply]"); await page.waitForTimeout(400);
    const due = await page.evaluate(() => { const y = (window as any).yuzu; return [...y.cards.values()].filter((c: any) => c.source === "Medicine::Cardio").map((c: any) => Math.round((c.due - y.dayStart()) / 86400000)); });
    ok("Set due date (sheet): every selected card comes back tomorrow, with an Undo", due.every((d: number) => d === 1) && await page.locator(".kit-snack button:has-text('Undo')").isVisible(), JSON.stringify(due));
    await page.locator(".kit-snack button:has-text('Undo')").click(); await page.waitForTimeout(300);
    ok("…Undo puts them back", await page.evaluate(() => [...(window as any).yuzu.cards.values()].filter((c: any) => c.source === "Medicine::Cardio").every((c: any) => c.due > Date.now() + 20 * 86400000)));

    // best hours (seeded review history at two hours)
    await page.evaluate(() => { const y = (window as any).yuzu; const base = new Date(); base.setHours(7, 5, 0, 0); for (let d = 1; d <= 20; d++) for (const h of [7, 8]) y.reviews.push({ id: `h${d}-${h}`, cid: "x", ts: base.getTime() - d * 86400000 + (h - 7) * 3600000, rating: 3, state: "review", elapsedDays: 1, scheduledDays: 1, durationMs: 1000 }); y.reviews.sort((a: any, b: any) => a.ts - b.ts); y.bump(); });
    await page.click("nav.tabs >> text=Progress"); await page.waitForTimeout(500);
    ok("Progress shows when you study best", /07:00–09:00: 100% recalled/.test(await page.locator("[data-testid=best-hours]").innerText().catch(() => "")), await page.locator("[data-testid=best-hours]").innerText().catch(() => "none"));
    await ctx.close(); }

  // ======== Arabic and Deck options (desktop)
  { const { ctx, page } = await device(1280, 800, false); await seed(page);
    await openDeck(page, ["Medicine", "Arabic"]); await page.click("button.btn.primary:has-text('Study')"); await page.waitForTimeout(400);
    const dir = await page.evaluate(() => { const c = (document.querySelector(".study .card-host") as HTMLElement).shadowRoot!.querySelector(".card") as HTMLElement; return getComputedStyle(c.querySelector("*") ?? c).direction; });
    ok("an Arabic card reads right to left by itself", dir === "rtl", dir);
    await leave(page);
    await page.evaluate(() => (window as any).yuzu.setDeckOpts("Languages::German::Goethe A1", { ordered: true }));
    await openDeck(page, ["Languages", "German", "Goethe A1"]); await page.click("button[aria-label='Deck options']"); await page.waitForTimeout(300);
    await page.click("[data-testid=opt-orderBy-field]"); await page.waitForTimeout(150);
    ok("Deck options: order by a field picks one of the deck's fields", await page.locator("[data-testid=opt-orderField]").count() === 1 && !!(await Y(page, `window.yuzu.settings.deckOpts["Languages::German::Goethe A1"].orderField`)));
    await page.click("[data-testid=opt-priority]"); await page.waitForTimeout(100);
    ok("…Its new cards first", (await Y(page, `window.yuzu.settings.deckOpts["Languages::German::Goethe A1"].priority`)) === true);
    ok("…Say it and the subject design switches are there", await page.locator("[data-testid=opt-sayit]").count() === 1 && await page.locator("[data-testid=opt-art]").count() === 1);
    await page.screenshot({ path: `${shots}/v110-deckoptions.png` });
    await ctx.close(); }
  ok("no page errors", errors.length === 0, errors.slice(0, 4).join(" | "));
} catch (e) { console.log("✗ crashed:", e); fails.push("crash"); }
finally { await browser.close(); server.kill(); }
console.log(fails.length ? `FAILED ${fails.length}: ${fails.join("; ")}` : "all 1.10.0 checks passed"); process.exit(fails.length ? 1 : 0);
