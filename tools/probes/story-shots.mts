// Screenshots of the 1.9.0 pieces (bubble, previous line, Read, Deck options) in each interface at phone and desktop size.
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 5480; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" }); await new Promise((r) => setTimeout(r, 800));
const out = process.argv[2] ?? "/tmp"; const browser = await chromium.launch();
const SPEECH = `Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speak(u) { setTimeout(() => u.onend && u.onend(), 5); }, cancel() {}, getVoices() { return []; } } }); window.SpeechSynthesisUtterance = function (t) { this.text = t; };`;
for (const ui of ["arcade", "clean", "paper"]) for (const [w, h] of [[412, 915], [1280, 800]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(`localStorage.setItem("yuzu-ui", "${ui}");` + SPEECH); const p = await ctx.newPage(); const errs: string[] = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${port}/`); await p.waitForFunction(() => (window as any).yuzu?.loaded);
  await p.evaluate(async () => { const y = (window as any).yuzu; await y.importPack({ yuzu_pack: 1, id: "g", category: "Languages::German::Goethe A1", cards: [{ type: "vocab", word: "Hund", article: "der", meaning: "dog" }] });
    await y.importPack({ yuzu_pack: 1, id: "f", category: "Mephisto::Faust", ordered: true, prevLine: true, cards: [{ id: "1", text: "Habe nun, ach! {{c1::Philosophie}}, Juristerei und Medizin, und leider auch Theologie durchaus studiert, mit heißem Bemühn." }, { id: "2", text: "Da steh ich nun, ich armer {{c1::Tor}}! Und bin so klug als wie zuvor; der Hund bellt." }] }); });
  await p.click("nav.tabs >> text=Library"); await p.locator(".tree-row", { hasText: "Mephisto" }).first().click(); await p.locator(".tree-row", { hasText: "Faust" }).first().click();
  await p.click("button[aria-label='Deck options']"); await p.waitForTimeout(300); await p.screenshot({ path: `${out}/opts-${ui}-${w}.png`, fullPage: false }); await p.keyboard.press("Escape");
  await p.click("button.btn.primary:has-text('Study')"); await p.waitForTimeout(400);
  await p.locator(".study-body .paper").click(); await p.waitForTimeout(150); await p.locator(".answer-bar .good").click(); await p.waitForTimeout(350); await p.locator(".study-body .paper").click(); await p.waitForTimeout(200);
  const pt = await p.evaluate(() => { const r = (document.querySelector(".study .paper .card-host") as HTMLElement).shadowRoot!; const wk = document.createTreeWalker(r, NodeFilter.SHOW_TEXT); let n; while ((n = wk.nextNode())) { const i = (n.textContent ?? "").indexOf("Hund"); if (i >= 0) { const g = document.createRange(); g.setStart(n, i); g.setEnd(n, i + 4); const b = g.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; } } return null; });
  if (pt) await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(250);
  await p.screenshot({ path: `${out}/study-${ui}-${w}.png` }); console.log(ui, w, errs.length ? errs.join("|") : "no errors", pt ? "" : "(word not found)");
  await ctx.close();
}
await browser.close(); server.kill();
