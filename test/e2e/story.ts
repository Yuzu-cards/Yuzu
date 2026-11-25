// 1.9.0, decks built in sequence, in a real browser: a story pack imported in two parts out of order, studied line by
// line; the line's place and the line before; reading the line aloud (and slower on a second tap); tapping a word for its
// meaning from your own vocab cards; Deck options (strict order, a cap, the deck's own look with its font); a rename
// keeps the options. Phone and desktop. Fails on any JavaScript error.
import { chromium, type Page } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
const port = 5400 + Number(process.env.PORT_OFFSET ?? 0);
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const shots = "test/e2e/shots"; fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const SPEECH = `window.__said = []; Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speaking: false, pending: false, speak(u) { window.__said.push(u.lang + "|" + u.rate + "|" + u.text); this.speaking = true; setTimeout(() => { this.speaking = false; u.onend && u.onend(); }, 400); }, cancel() { this.speaking = false; }, getVoices() { return [{ lang: "de-DE", name: "Anna" }]; } } }); window.SpeechSynthesisUtterance = function (t) { this.text = t; };`;
const FONT = "data:font/woff2;base64," + Buffer.from("not-really-a-font").toString("base64");
const part = (seqStart: number, lines: string[]) => ({ yuzu_pack: 1, id: "faust-" + seqStart, name: "Faust", category: "Mephisto::Faust", seqStart, prevLine: true, lang: "de-DE",
  style: { css: "@font-face{font-family:Story;src:url('story.woff2')} .card{font-family:Story,serif;letter-spacing:.01em}", fonts: { "story.woff2": FONT } },
  cards: lines.map((t, i) => ({ id: String(seqStart + i), text: t })) });
const VOCAB = { yuzu_pack: 1, id: "goethe", category: "Languages::German::Goethe A1", cards: [{ type: "vocab", word: "Hund", article: "der", meaning: "dog", plural: "Hunde" }, { type: "vocab", word: "gehen", meaning: "to go" }] };

async function device(w: number, h: number, touch: boolean) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.addInitScript(SPEECH); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${w}px pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_FAILED|Failed to load resource|OTS parsing|downloadable font/.test(m.text())) errors.push(`${w}px console: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  return { ctx, page };
}
const Y = (p: Page, f: string) => p.evaluate(f);
/** The middle of a word inside the card (its shadow root), in page coordinates. */
const wordPoint = (p: Page, word: string) => p.evaluate((w) => {
  const host = document.querySelector(".study .paper .card-host") as HTMLElement; const root = host.shadowRoot!;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n: Node | null;
  while ((n = walk.nextNode())) { const i = (n.textContent ?? "").indexOf(w); if (i < 0) continue; const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }
  return null;
}, word);
async function openDeck(p: Page, names: string[]) { await p.click("nav.tabs >> text=Library"); await p.waitForTimeout(300); if (await p.locator(".crumbs button").count()) { await p.locator(".crumbs button").first().click(); await p.waitForTimeout(250); } for (const n of names) { await p.locator(".tree-row", { hasText: n }).first().click(); await p.waitForTimeout(250); } }

try {
  // ======== desktop (mouse and keys: the Steam Deck on its monitor)
  { const { ctx, page } = await device(1280, 800, false);
    const m1 = await page.evaluate(async ([v, a, b]) => { const y = (window as any).yuzu; await y.importPack(v); const x = await y.importPack(a); const z = await y.importPack(b); return [x, z]; },
      [VOCAB, part(101, ["Da steht er nun, der {{c1::Hund}}.", "Der Pudel {{c1::geht}} hinaus."]), part(1, ["Habe nun, ach! {{c1::Philosophie}},", "Juristerei und {{c1::Medizin}},", "Und leider auch {{c1::Theologie}}"])] as const);
    ok("a story pack suggests strict order and says it has a look of its own", /new cards now come in the pack's order/.test(m1[0]) && /has its own look/.test(m1[0]), m1[0]);
    const opts = await Y(page, `JSON.stringify(window.yuzu.settings.deckOpts["Mephisto::Faust"])`);
    ok("…the suggestions are taken for the deck (nothing was set there)", opts === JSON.stringify({ ordered: true, prevLine: true, lang: "de-DE" }), String(opts));
    const order = await page.evaluate(() => (window as any).yuzu.queue("Mephisto").map((c: any) => (window as any).yuzu.notes.get(c.nid).fields[0].slice(0, 12)));
    ok("part 2 imported first, part 1 after: new cards still come in line order", JSON.stringify(order) === JSON.stringify(["Habe nun, ac", "Juristerei u", "Und leider a", "Da steht er ", "Der Pudel {{"]), JSON.stringify(order));

    await openDeck(page, ["Mephisto", "Faust"]); await page.click("button.btn.primary:has-text('Study')"); await page.waitForTimeout(500);
    ok("the line's place shows above the card", (await page.locator("[data-testid=line-no]").innerText()) === "line 1 of 5");
    ok("the first line has no line before it", await page.locator("[data-testid=prev-line]").count() === 0);
    ok("no Read button on the question (it would give the gap away)", await page.locator("button.read-line").count() === 0);
    await page.keyboard.press(" "); await page.waitForTimeout(200);
    await page.click("button.read-line"); await page.waitForTimeout(100);
    let said: string[] = await Y(page, "window.__said") as string[];
    ok("Read: the whole line, gaps filled, in German", said.at(-1) === "de-DE|0.95|Habe nun, ach! Philosophie,", said.at(-1));
    await page.click("button.read-line"); await page.waitForTimeout(100); said = await Y(page, "window.__said") as string[];
    ok("…a second tap reads it slower", said.at(-1) === "de-DE|0.7|Habe nun, ach! Philosophie,", said.at(-1));
    await page.waitForTimeout(6500); await page.keyboard.press("l"); await page.waitForTimeout(100); said = await Y(page, "window.__said") as string[];
    ok("…key L reads it (at the normal pace again after a while)", said.at(-1) === "de-DE|0.95|Habe nun, ach! Philosophie,", said.at(-1));
    await page.keyboard.press("3"); await page.waitForTimeout(400);
    ok("the next card shows the line before it, gaps filled", (await page.locator("[data-testid=prev-line] .pl-text").innerText()) === "Habe nun, ach! Philosophie,");
    ok("…and its place: line 2 of 5", (await page.locator("[data-testid=line-no]").innerText()) === "line 2 of 5");
    await page.keyboard.press("3"); await page.waitForTimeout(300); // (the question side)
    for (let i = 0; i < 2; i++) { await page.keyboard.press(" "); await page.waitForTimeout(150); await page.keyboard.press("3"); await page.waitForTimeout(350); }
    // line 4: "Da steht er nun, der Hund." — tap words on the back
    ok("line 4 of 5 now", (await page.locator("[data-testid=line-no]").innerText()) === "line 4 of 5");
    const front = await wordPoint(page, "steht"); await page.mouse.click(front!.x, front!.y); await page.waitForTimeout(200);
    ok("a tap on the question still just shows the answer", await page.locator(".answer-bar").count() === 1 && await page.locator("[data-testid=word-bubble]").count() === 0);
    const hund = await wordPoint(page, "Hund"); await page.mouse.click(hund!.x, hund!.y); await page.waitForTimeout(250);
    const bub = await page.locator("[data-testid=word-bubble]").innerText().catch(() => "");
    ok("tap a word on the back: its meaning from your own vocab card, and where it's from", /der Hund/.test(bub) && /dog/.test(bub) && /Goethe A1/.test(bub), bub.replace(/\n/g, " | "));
    await page.screenshot({ path: `${shots}/story-desktop-bubble.png` });
    await page.mouse.click(hund!.x, hund!.y - 60); await page.waitForTimeout(200);
    ok("…a tap anywhere closes it (and doesn't rate the card)", await page.locator("[data-testid=word-bubble]").count() === 0 && await page.locator(".answer-bar").count() === 1);
    const steht = await wordPoint(page, "steht"); await page.mouse.click(steht!.x, steht!.y); await page.waitForTimeout(200);
    ok("a word none of your cards has: said plainly, with Translate", /isn't in your vocab cards/.test(await page.locator("[data-testid=word-bubble]").innerText()));
    await page.keyboard.press("Escape"); await page.waitForTimeout(150);
    ok("Escape closes the bubble, not the session", await page.locator("[data-testid=word-bubble]").count() === 0 && await page.locator(".answer-bar").count() === 1);
    await page.keyboard.press("3"); await page.waitForTimeout(350); await page.keyboard.press(" "); await page.waitForTimeout(200);
    const geht = await wordPoint(page, "geht"); await page.mouse.click(geht!.x, geht!.y); await page.waitForTimeout(200);
    ok("an inflected verb finds its vocab card (geht → gehen)", /to go/.test(await page.locator("[data-testid=word-bubble]").innerText().catch(() => "")));
    await page.keyboard.press("Escape"); await page.keyboard.press("3"); await page.waitForTimeout(400);

    // Deck options: the look, a cap, and the progress
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await openDeck(page, ["Mephisto", "Faust"]); await page.click("button[aria-label='Deck options']"); await page.waitForTimeout(300);
    const sheet = page.locator(".deck-opts");
    ok("Deck options: the order's progress", /Every line started \(5\)/.test(await sheet.locator("[data-testid=line-progress]").innerText()));
    ok("…strict order on, previous line on, language from the pack", await sheet.locator("[data-testid=opt-ordered]").isChecked() && await sheet.locator("[data-testid=opt-prev]").isChecked() && (await sheet.locator("[data-testid=opt-lang]").inputValue()) === "de-DE");
    await sheet.locator("[data-testid=opt-look-own]").click(); await page.waitForTimeout(200);
    ok("…its own look switched on", await Y(page, `window.yuzu.lookFor("Mephisto::Faust").own`) === true);
    await sheet.locator("[data-testid=opt-cap]").fill("2"); await page.waitForTimeout(200);
    ok("…a cap of 2 new cards a day", await Y(page, `window.yuzu.settings.deckOpts["Mephisto::Faust"].newPerDay`) === 2);
    await page.screenshot({ path: `${shots}/story-desktop-options.png` });
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    // the look on a card: the deck's CSS with its font from the media store, and no Yuzu style
    await page.evaluate(() => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "faust-301", category: "Mephisto::Faust", seqStart: 301, cards: [{ id: "a", text: "Neu {{c1::eins}}" }, { id: "b", text: "Neu {{c1::zwei}}" }, { id: "c", text: "Neu {{c1::drei}}" }] }));
    ok("the cap holds: 5 new lines seen today, a cap of 2, so none of the 3 new ones", await Y(page, `window.yuzu.queue("Mephisto").filter(c => c.state === "new").length`) === 0 && await Y(page, `window.yuzu.capsLeft().get("Mephisto::Faust")`) === -3);
    await page.evaluate(() => (window as any).yuzu.setDeckOpts("Mephisto::Faust", { newPerDay: 7 }));
    ok("…raised to 7: 2 more today, the next two lines", JSON.stringify(await Y(page, `window.yuzu.queue("Mephisto").filter(c => c.state === "new").map(c => window.yuzu.notes.get(c.nid).seq)`)) === "[301,302]");
    await page.evaluate(() => (window as any).yuzu.setDeckOpts("Mephisto::Faust", { prevLines: 2, readPace: "slow", lineNo: false }));
    await openDeck(page, ["Mephisto", "Faust"]); await page.click("button.btn.primary:has-text('Study')"); await page.waitForTimeout(500);
    ok("two lines before, when asked; the line number hidden when asked", await page.locator("[data-testid=prev-line] .pl-one").count() === 2 && await page.locator("[data-testid=line-no]").count() === 0, await page.locator("[data-testid=prev-line]").innerText().catch(() => "none"));
    await page.keyboard.press(" "); await page.waitForTimeout(150); await page.click("button.read-line"); await page.waitForTimeout(100);
    ok("reading pace Slow: slow from the first tap", String((await Y(page, "window.__said") as string[]).at(-1)).startsWith("de-DE|0.7|Neu eins"), String((await Y(page, "window.__said") as string[]).at(-1)));
    const look = await page.evaluate(() => { const h = document.querySelector(".study .paper .card-host") as HTMLElement; const css = [...h.shadowRoot!.querySelectorAll("style")].map((s) => s.textContent).join("\n"); return { look: h.dataset.look, font: /src:\s*url\("blob:/.test(css), sheets: h.shadowRoot!.querySelectorAll("style").length, family: getComputedStyle(h.shadowRoot!.querySelector(".card")!).fontFamily }; });
    ok("the deck's own look: its CSS, its font from the stored file, no Yuzu style on top", look.look === "own" && look.font && look.sheets === 2 && /Story/.test(look.family), JSON.stringify(look));
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    // rename the deck: its options and look go with it
    await page.evaluate(() => (window as any).yuzu.renamePath("Mephisto::Faust", "Stories::Faust"));
    const moved = await page.evaluate(() => { const y = (window as any).yuzu; return { o: y.optsFor("Stories::Faust::x").opts, old: y.settings.deckOpts["Mephisto::Faust"], look: y.lookFor("Stories::Faust").own, css: !!y.settings.deckStyles["Stories::Faust"] }; });
    ok("a renamed deck keeps its options and its look; the old place is cleared", moved.o.ordered === true && moved.o.newPerDay === 7 && moved.old === null && moved.look && moved.css, JSON.stringify(moved));
    await ctx.close(); }

  // ======== phone (touch)
  { const { ctx, page } = await device(412, 915, true);
    await page.evaluate(async ([v, a]) => { const y = (window as any).yuzu; await y.importPack(v); await y.importPack(a); }, [VOCAB, part(1, ["Der {{c1::Hund}} bellt laut.", "Dann {{c1::geht}} er nach Hause, wo der Hund schläft und träumt."])] as const);
    await openDeck(page, ["Mephisto", "Faust"]); await page.click("button.btn.primary:has-text('Study')"); await page.waitForTimeout(500);
    await page.tap(".study-body .paper"); await page.waitForTimeout(200); await page.locator(".answer-bar .good").tap(); await page.waitForTimeout(400);
    await page.tap(".study-body .paper"); await page.waitForTimeout(250);
    const p = await wordPoint(page, "Hund"); await page.touchscreen.tap(p!.x, p!.y); await page.waitForTimeout(250);
    const b = await page.locator("[data-testid=word-bubble]").boundingBox();
    ok("phone: the bubble opens by the word and stays on screen", !!b && b.x >= 0 && b.x + b.width <= 412 && b.y >= 0 && b.y + b.height <= 915, JSON.stringify(b));
    ok("phone: the previous line sits above the card", (await page.locator("[data-testid=prev-line] .pl-text").innerText()) === "Der Hund bellt laut.");
    await page.screenshot({ path: `${shots}/story-phone.png` });
    await page.click("nav.tabs >> text=Library").catch(() => {});
    await ctx.close(); }
  ok("no page errors", errors.length === 0, errors.slice(0, 4).join(" | "));
} catch (e) { console.log("✗ crashed:", e); fails.push("crash"); }
finally { await browser.close(); server.kill(); }
console.log(fails.length ? `FAILED ${fails.length}: ${fails.join("; ")}` : "all story-deck checks passed"); process.exit(fails.length ? 1 : 0);
