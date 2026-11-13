// WP17: occlusion editor (boxes drawn over the picture, by mouse and by touch; move, resize, delete; picture stays put),
// editing an existing card in the full editor, card editor hints, rename-merge warning with Undo, smart decks, card-menu delete.
import { chromium, type Page, type BrowserContext } from "playwright"; import { spawn } from "node:child_process";
const port = 5170 + Number(process.env.PORT_OFFSET ?? 0); /* PORT_OFFSET lets several copies run at once */ const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`;
const SHOTS = process.env.SHOTS ?? "";
async function open(ctx: BrowserContext, label: string, ui?: string): Promise<Page> {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(label + ": " + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon|save failed/.test(m.text())) errors.push(label + " console: " + m.text()); });
  if (ui) await p.addInitScript((u) => { try { localStorage.setItem("yuzu-ui", u); } catch { /* */ } }, ui);
  await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 }); return p;
}
const shot = async (p: Page, name: string) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const pngOf = (p: Page) => p.evaluate(() => { const c = document.createElement("canvas"); c.width = 600; c.height = 400; const g = c.getContext("2d")!; g.fillStyle = "#cfe"; g.fillRect(0, 0, 600, 400); g.fillStyle = "#c33"; g.fillRect(60, 60, 160, 100); g.fillStyle = "#33c"; g.fillRect(360, 200, 160, 120); return c.toDataURL("image/png").split(",")[1]; });
const sheetItem = (p: Page, label: string) => p.locator(`.kit-sheet .kit-item:has-text("${label}")`).last();
const masksIn = (p: Page) => p.$$eval(".io-ed .io-box.io-hide", (els) => els.map((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return { x: r.x, y: r.y, w: r.width, h: r.height, pos: s.position, bg: s.backgroundColor }; }));

try {
  for (const mode of ["mouse", "touch"] as const) {
    // ---- Occlusion editor: boxes visible over the picture, picture stays put, move / resize / delete
    const ctx = await browser.newContext(mode === "mouse" ? { viewport: { width: 1440, height: 900 } } : { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    const P = await open(ctx, mode, mode === "mouse" ? "clean" : undefined);
    const cdp = mode === "touch" ? await ctx.newCDPSession(P) : null;
    const drag = async (x1: number, y1: number, x2: number, y2: number) => {
      if (cdp) { await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y: y1 }] }); for (let i = 1; i <= 5; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x1 + ((x2 - x1) * i) / 5, y: y1 + ((y2 - y1) * i) / 5 }] }); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
      else { await P.mouse.move(x1, y1); await P.mouse.down(); await P.mouse.move(x2, y2, { steps: 5 }); await P.mouse.up(); }
      await P.waitForTimeout(60);
    };
    const tap = async (x: number, y: number) => { if (cdp) await P.touchscreen.tap(x, y); else await P.mouse.click(x, y); await P.waitForTimeout(60); };
    await P.evaluate(() => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "seed", category: "Medicine::Seed", cards: [{ id: "s", front: "Seed", back: "card" }] })); // (an empty Library is a different screen)
    await P.click("nav.tabs >> text=Library"); await P.click("text=＋ Image");
    ok(`${mode}: the empty editor offers a real button, not a bare file input`, await P.locator("button.btn:has-text('Choose a picture')").isVisible());
    await P.setInputFiles('input[aria-label="Picture"]', { name: "heart_anterior.png", mimeType: "image/png", buffer: Buffer.from(await pngOf(P), "base64") });
    await P.waitForSelector('[data-testid="io-canvas"]'); await P.waitForTimeout(150);
    const bb0 = (await P.locator('[data-testid="io-canvas"]').boundingBox())!;
    const at = (fx: number, fy: number) => [bb0.x + bb0.width * fx, bb0.y + bb0.height * fy] as const;
    ok(`${mode}: the title defaults to the file name`, (await P.inputValue('input[placeholder="Heart: anterior view"]')) === "heart anterior");
    // box 1, while dragging the live box shows
    { const [x1, y1] = at(0.1, 0.15), [x2, y2] = at(0.37, 0.4);
      if (!cdp) { await P.mouse.move(x1, y1); await P.mouse.down(); await P.mouse.move(x2, y2, { steps: 4 }); const live = await P.$eval(".io-ed .io-open", (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, pos: getComputedStyle(e).position }; }).catch(() => null); ok("mouse: the box shows over the picture while dragging", !!live && live.pos === "absolute" && live.w > 50 && live.h > 50, JSON.stringify(live)); await P.mouse.up(); await P.waitForTimeout(60); }
      else await drag(x1, y1, x2, y2); }
    const m1 = await masksIn(P);
    ok(`${mode}: box 1 is drawn over the picture where it was dragged`, m1.length === 1 && m1[0].pos === "absolute" && Math.abs(m1[0].x - (bb0.x + bb0.width * 0.1)) < 4 && Math.abs(m1[0].w - bb0.width * 0.27) < 5 && m1[0].bg !== "rgba(0, 0, 0, 0)", JSON.stringify(m1));
    const bb1 = (await P.locator('[data-testid="io-canvas"]').boundingBox())!;
    ok(`${mode}: the picture does not move after a box is added`, Math.abs(bb1.y - bb0.y) < 1 && Math.abs(bb1.height - bb0.height) < 1, `${bb0.y} → ${bb1.y}`);
    await drag(...at(0.6, 0.5), ...at(0.87, 0.8));
    const s2 = await P.evaluate(() => [...document.querySelectorAll(".io-ed .io-box.io-hide")].map((e) => (e as HTMLElement).style.cssText));
    ok(`${mode}: box 2 lands where it was dragged (60/50 %)`, /left: 60%/.test(s2[1] ?? "") && /top: 50%/.test(s2[1] ?? ""), s2[1]);
    await drag(...at(0.5, 0.05), ...at(0.505, 0.06));
    ok(`${mode}: a box too small is not kept, and says so`, (await masksIn(P)).length === 2 && /Box too small/.test(await P.locator(".io-tip").innerText()));
    await shot(P, `${mode}-io-drawn`);
    // move box 1 by dragging inside it
    await tap(...at(0.2, 0.25)); // select
    const before = await P.evaluate(() => (document.querySelector('.io-ed [data-box="0"]') as HTMLElement).style.cssText);
    await drag(...at(0.2, 0.25), ...at(0.3, 0.35));
    const moved = await P.evaluate(() => (document.querySelector('.io-ed [data-box="0"]') as HTMLElement).style.cssText);
    ok(`${mode}: dragging a box moves it (10 % right and down)`, /left: 20%/.test(moved) && /top: 25%/.test(moved) && /width: 27%/.test(moved), `${before} → ${moved}`);
    const h = (await P.locator(".io-ed .io-handle").boundingBox())!;
    await drag(h.x + h.width / 2, h.y + h.height / 2, h.x + h.width / 2 + bb0.width * 0.1, h.y + h.height / 2 + bb0.height * 0.05);
    const resized = await P.evaluate(() => (document.querySelector('.io-ed [data-box="0"]') as HTMLElement).style.cssText);
    ok(`${mode}: the corner handle resizes it`, /width: 3[67](\.\d)?%/.test(resized) && /left: 20%/.test(resized), resized);
    ok(`${mode}: still 2 boxes after moving and resizing`, (await masksIn(P)).length === 2);
    // delete box 2 with its ✕
    await tap(...at(0.7, 0.6)); await P.locator('.io-ed .io-del').click();
    ok(`${mode}: ✕ on a box removes it`, (await masksIn(P)).length === 1 && (await P.locator('input[aria-label^="Name of box"]').count()) === 1);
    await drag(...at(0.6, 0.5), ...at(0.87, 0.8));
    if (!cdp) { // keyboard: arrows move the focused box
      await P.locator('.io-ed [data-box="1"]').focus(); await P.keyboard.press("ArrowLeft"); await P.keyboard.press("Shift+ArrowDown");
      const k = await P.evaluate(() => (document.querySelector('.io-ed [data-box="1"]') as HTMLElement).style.cssText);
      ok("keyboard: arrows move the box, Shift+arrows resize it", /left: 58%/.test(k) && /height: 32%/.test(k), k);
    }
    await P.fill('input[aria-label="Name of box 1"]', "Red room"); await P.fill('input[aria-label="Name of box 2"]', "Blue room");
    await shot(P, `${mode}-io-named`);
    await P.click("button:has-text('Make 2 cards')"); await P.waitForSelector("text=/cards?\\)? added/", { timeout: 10000 });
    const msg = await P.evaluate(() => [...document.querySelectorAll(".io-sheet > p.small")].map((e) => e.textContent).join(" || "));
    ok(`${mode}: the message counts cards, not notes`, /\(2 cards\) added — heart anterior/.test(msg), msg);
    const saved = await P.evaluate(() => { const y = (window as any).yuzu; const n = [...y.notes.values()].find((n: any) => n.ntid === "yuzu-io"); return n ? { masks: n.fields[1], cards: y.cardsOfNote(n.id).length } : null; });
    ok(`${mode}: the saved boxes are the edited ones`, !!saved && saved.cards === 2 && /^20,25,3[67](\.\d)?,(29|30|31)(\.\d)?,Red room/.test(saved.masks), JSON.stringify(saved));
    if (!cdp) { await P.keyboard.press("Escape"); await P.waitForTimeout(150); ok("Esc closes the occlusion editor", (await P.locator(".io-sheet").count()) === 0); }
    await ctx.close();
  }

  // ---- Editing an existing card; tags in preview filter the Library; delete from the card menu asks first
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const E = await open(c2, "edit");
  await E.evaluate(() => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "e", category: "Medicine::Renal", tags: ["step1"], cards: [{ id: "k", type: "cloze", text: "Hyperkalaemia: give {{c1::calcium gluconate}} first, then insulin and dextrose" }, { id: "k2", front: "Other card", back: "B" }] }));
  await E.evaluate(async () => { const y = (window as any).yuzu; const c = [...y.cards.values()].find((c: any) => c.ord === 0 && /calcium/.test(y.noteFor(c).fields[0])); await y.answer(c.id, 3, 2000); });
  await E.click("nav.tabs >> text=Library"); await E.fill('input[placeholder="Search cards and tags here"]', "hyperkalaemia"); await E.waitForTimeout(400);
  await E.locator(".list-row").first().click(); await E.click(".sheet >> button:has-text('Edit')");
  await E.waitForSelector('[role="dialog"][aria-label="Edit card"]');
  ok("Preview → Edit opens the full editor, pre-filled", /calcium gluconate/.test(await E.inputValue('[aria-label="Edit card"] textarea[aria-label="Text"]')));
  await E.evaluate(() => { const t = document.querySelector('[aria-label="Edit card"] textarea[aria-label="Text"]') as HTMLTextAreaElement; t.focus(); t.setSelectionRange(t.value.length, t.value.length); });
  await E.click('[aria-label="Edit card"] button:has-text("Make gap")');
  ok("…Make gap with nothing selected says to select words first and adds nothing", /Select the words/.test(await E.locator('[aria-label="Edit card"]').innerText()) && !/c2::/.test(await E.inputValue('[aria-label="Edit card"] textarea[aria-label="Text"]')));
  await E.evaluate(() => { const t = document.querySelector('[aria-label="Edit card"] textarea[aria-label="Text"]') as HTMLTextAreaElement; const i = t.value.indexOf("insulin and dextrose"); t.focus(); t.setSelectionRange(i, i + "insulin and dextrose".length); });
  await E.click('[aria-label="Edit card"] button:has-text("Make gap")'); await E.waitForTimeout(200);
  ok("…the preview shows both cards", (await E.locator('[aria-label="Edit card"] .editor-preview .chip:has-text("Card 2")').count()) === 1);
  await shot(E, "edit-card");
  await E.click('[aria-label="Edit card"] button:has-text("Save changes")'); await E.waitForTimeout(400);
  const ed = await E.evaluate(() => { const y = (window as any).yuzu; const n = [...y.notes.values()].find((n: any) => /calcium/.test(n.fields[0])); const cs = y.cardsOfNote(n.id); return { text: n.fields[0], cards: cs.length, reps: cs.find((c: any) => c.ord === 0).reps, tags: n.tags }; });
  ok("…saving updates the same note, keeps its history and adds a card for the new gap", /\{\{c2::insulin and dextrose\}\}/.test(ed.text) && ed.cards === 2 && ed.reps === 1 && ed.tags.includes("step1"), JSON.stringify(ed));
  ok("…and goes back to the preview, showing the edit", (await E.locator('button[aria-label="Close preview"]').count()) === 1);
  await E.click('.sheet .chip:has-text("step1")'); await E.waitForTimeout(300);
  const lib = await E.locator(".screen").innerText();
  ok("a tag chip in the preview shows the cards with that tag", /step1/.test(lib) && (await E.locator(".seg button.on").first().innerText()) === "Tags" && (await E.locator(".list-row").count()) >= 2, lib.slice(0, 200).replace(/\n/g, " | "));
  // card menu (right-click) → Delete asks first
  const before = await E.evaluate(() => (window as any).yuzu.notes.size);
  { const r = (await E.locator(".list-row").first().boundingBox())!; await E.mouse.move(r.x + 40, r.y + r.height / 2); await E.mouse.down(); await E.waitForTimeout(700); await E.mouse.up(); } // hold for the card menu
  await sheetItem(E, "Delete").click(); await E.waitForTimeout(300);
  ok("Delete from the card menu asks for confirmation", (await E.locator('.kit-sheet .kit-item.danger:has-text("Delete")').count()) === 1 && (await E.evaluate(() => (window as any).yuzu.notes.size)) === before);
  await E.locator(".kit-sheet .kit-cancel").click(); await E.waitForTimeout(200);
  ok("…and Cancel keeps the card", (await E.evaluate(() => (window as any).yuzu.notes.size)) === before);
  await c2.close();

  // ---- Card editor: kept tags are said; switching to Vocab clears them; a near copy is offered for review
  const c3 = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const W = await open(c3, "write");
  await W.evaluate(() => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "base", category: "Medicine::ED", cards: [{ id: "a", type: "cloze", text: "Hyperkalaemia with ECG changes: give {{c1::calcium gluconate}} first, then {{c2::insulin and dextrose}} IV." }] }));
  await W.click("nav.tabs >> text=Library"); await W.click("button:has-text('＋ Card')"); await W.click('[aria-label="Card type"] >> text=Cloze');
  await W.fill('textarea[aria-label="Cloze text"]', "Peaked T waves");
  await W.evaluate(() => { const t = document.querySelector('textarea[aria-label="Cloze text"]') as HTMLTextAreaElement; t.focus(); t.setSelectionRange(0, 0); });
  await W.click("button:has-text('Make gap')");
  ok("Make gap with no selection: a hint, no gap at the start", (await W.inputValue('textarea[aria-label="Cloze text"]')) === "Peaked T waves" && /Select the words to hide first/.test(await W.locator('[aria-label="Card editor"]').innerText()));
  await W.fill('textarea[aria-label="Cloze text"]', "Hyperkalaemia with ECG changes: give {{c1::calcium gluconate}} first, then {{c2::insulin and dextrose}} IV now.");
  await W.fill('input[aria-label="Tags (space or comma)"]', "cardio::arrhythmia high-yield"); await W.fill('input[aria-label="Source"]', "ERC 2025");
  await W.click("button:has-text('Save card')"); await W.waitForTimeout(500);
  ok("kept tags and source are said, with a way to clear them", /stay for the next card/.test(await W.locator('[aria-label="Card editor"]').innerText()));
  ok("a near copy says it looks like an existing card", /looks like a card you already have/.test(await W.locator('[aria-label="Card editor"]').innerText()));
  await shot(W, "editor-similar");
  await W.click('[aria-label="Card type"] >> text=Vocab');
  ok("switching to Vocab clears the medical tags and source", (await W.inputValue('input[aria-label="Tags (space or comma)"]')) === "" && (await W.inputValue('input[aria-label="Source"]')) === "");
  await W.click("button:has-text('Review the pair')"); await W.waitForSelector("text=Similar cards");
  ok("…Review the pair opens it side by side with the original", /Pair 1 of 1/.test(await W.locator(".screen").innerText()));
  await c3.close();

  // ---- Rename onto an existing category warns, merges, and Undo takes it apart again; references follow
  const c4 = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }); const R = await open(c4, "rename");
  await R.evaluate(async () => { const y = (window as any).yuzu;
    await y.importPack({ yuzu_pack: 1, id: "em", category: "Emergency Medicine::Trauma", cards: Array.from({ length: 3 }, (_, i) => ({ id: "t" + i, front: `Trauma q ${i}`, back: "a" })) });
    await y.importPack({ yuzu_pack: 1, id: "de", category: "Languages::German", cards: [{ id: "g", front: "die Lunge", back: "lung" }] });
    await y.saveSettings({ smart: [{ id: "s1", name: "ED", systems: [], specialties: [], decks: ["Emergency Medicine"], tags: [], states: [] }], deadlines: [{ id: "d1", name: "Exam", date: "2027-01-01", view: "decks", path: "Emergency Medicine::Trauma" }], pins: [{ view: "decks", path: "Emergency Medicine" }] });
    localStorage.setItem("yuzu-edit-deck", "Emergency Medicine::Trauma"); });
  await R.click("nav.tabs >> text=Library"); await R.click(".tree-row:has-text('Emergency Medicine')"); await R.click('button[aria-label="Rename or move"]');
  await R.fill('.sheet input[list="deckpaths"]', "Languages"); await R.click(".sheet >> button:has-text('Apply')"); await R.waitForTimeout(200);
  const warn = await R.locator(".kit-sheet").innerText().catch(() => "");
  ok("renaming onto an existing category asks before merging", /already exists — merge 3 cards into it/.test(warn), warn.replace(/\n/g, " | "));
  await shot(R, "rename-merge");
  await sheetItem(R, "Merge").click(); await R.waitForTimeout(400);
  const after = await R.evaluate(() => { const y = (window as any).yuzu; return { srcs: [...y.cards.values()].map((c: any) => c.source).sort(), smart: y.settings.smart[0].decks, dl: y.settings.deadlines[0].path, pin: y.settings.pins[0].path, ed: localStorage.getItem("yuzu-edit-deck") }; });
  ok("…merging moves the cards and re-points smart decks, deadlines, pins and the editor's deck", after.srcs.filter((s: string) => s === "Languages::Trauma").length === 3 && after.smart[0] === "Languages" && after.dl === "Languages::Trauma" && after.pin === "Languages" && after.ed === "Languages::Trauma", JSON.stringify(after));
  ok("…with an Undo", await R.locator(".kit-snack button:has-text('Undo')").isVisible());
  await R.click(".kit-snack button:has-text('Undo')"); await R.waitForTimeout(400);
  const undone = await R.evaluate(() => { const y = (window as any).yuzu; return { srcs: [...y.cards.values()].map((c: any) => c.source).sort(), smart: y.settings.smart[0].decks, dl: y.settings.deadlines[0].path, ed: localStorage.getItem("yuzu-edit-deck") }; });
  ok("Undo takes the merge apart again (the German card stays put)", JSON.stringify(undone.srcs) === JSON.stringify(["Emergency Medicine::Trauma", "Emergency Medicine::Trauma", "Emergency Medicine::Trauma", "Languages::German"]) && undone.smart[0] === "Emergency Medicine" && undone.dl === "Emergency Medicine::Trauma" && undone.ed === "Emergency Medicine::Trauma", JSON.stringify(undone));
  // a plain rename (no clash) goes straight through
  await R.waitForTimeout(200); await R.click('button[aria-label="Rename or move"]'); await R.fill('.sheet input[list="deckpaths"]', "Emergency Med"); await R.click(".sheet >> button:has-text('Apply')"); await R.waitForTimeout(400);
  ok("a rename onto a new name asks nothing and updates the smart deck", (await R.locator(".kit-sheet").count()) === 0 && (await R.evaluate(() => (window as any).yuzu.settings.smart[0].decks[0])) === "Emergency Med");
  // ---- Smart decks: breadcrumb back, Tags group, delete asks
  await R.click(".seg >> text=Smart"); await R.click(".tree-row:has-text('ED')"); await R.waitForTimeout(150);
  ok("inside a smart deck there is a way back (Smart › name)", (await R.locator(".crumbs button:has-text('Smart')").count()) === 1);
  await shot(R, "smart-open");
  await R.click(".card-box >> button:has-text('Edit')");
  ok("the smart-deck editor has a Tags group", (await R.locator(".sheet h2:has-text('Tags')").count()) === 1);
  await R.click(".sheet >> button.danger:has-text('Delete')"); await R.waitForTimeout(150);
  ok("deleting a smart deck asks first", /Delete the smart deck “ED”/.test(await R.locator(".kit-sheet").innerText().catch(() => "")) && (await R.evaluate(() => (window as any).yuzu.settings.smart.length)) === 1);
  await sheetItem(R, "Delete").click(); await R.waitForTimeout(300);
  ok("…and can be undone", (await R.evaluate(() => (window as any).yuzu.settings.smart.length)) === 0 && await R.locator(".kit-snack button:has-text('Undo')").isVisible());
  await R.click(".kit-snack button:has-text('Undo')"); await R.waitForTimeout(300);
  ok("…Undo brings it back", (await R.evaluate(() => (window as any).yuzu.settings.smart.length)) === 1);
  await R.click(".crumbs button:has-text('Smart')").catch(() => {});
  await c4.close();
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails); process.exitCode = 1; }
  await browser.close(); server.kill();
}
