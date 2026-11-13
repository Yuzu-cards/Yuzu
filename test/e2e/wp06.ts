// WP06 — keyboard and gamepad safety while studying: typing is never a shortcut, nothing grades behind a sheet or the
// card menu, a held key does one thing, Esc / B close the menu first and the pad can use it, MCQ options are chosen
// with a highlight and confirmed, and the typed-answer box has the focus on a desktop.
import { chromium, type Page, type BrowserContext } from "playwright"; import { spawn } from "node:child_process";
const port = 5061 + Number(process.env.PORT_OFFSET ?? 0); /* PORT_OFFSET lets several copies run at once */ const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`;
const PAD = `window.__pad = { id: "Steam Deck", index: 0, connected: true, mapping: "standard", buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }; navigator.getGamepads = () => [window.__pad];`;
async function open(ctx: BrowserContext, label: string, pack: unknown, settings: Record<string, unknown> = {}): Promise<Page> {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(label + ": " + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon|save failed/.test(m.text())) errors.push(label + " console: " + m.text()); });
  await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  await p.evaluate(async ([pk, st]) => { const y = (window as any).yuzu; await y.importPack(pk); await y.saveSettings(st); }, [pack, settings] as const);
  await p.reload(); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 }); await p.waitForTimeout(300);
  await p.keyboard.press("Enter"); await p.waitForSelector(".study .card-host", { timeout: 8000 });
  return p;
}
const reviews = (p: Page) => p.evaluate(() => (window as any).yuzu.reviews.length as number);
const inStudy = async (p: Page) => (await p.locator(".study").count()) === 1;
const answerShown = async (p: Page) => (await p.locator(".answer-bar").count()) === 1;
const overlays = (p: Page) => p.locator(".sheet-backdrop, [role=dialog]").count();
const basic = { yuzu_pack: 1, id: "keys", category: "Medicine::Keys", cards: Array.from({ length: 14 }, (_, i) => ({ id: "k" + i, front: `Key question ${i}`, back: `answer ${i}` })) };
const padOf = (p: Page) => async (b: number) => { await p.evaluate((i) => { (window as any).__pad.buttons[i].pressed = true; }, b); await p.waitForTimeout(70); await p.evaluate((i) => { (window as any).__pad.buttons[i].pressed = false; }, b); await p.waitForTimeout(90); };
const A = 0, B = 1, MENU = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(PAD);
  const K = await open(ctx, "K", basic); const pad = padOf(K);
  await K.evaluate(() => window.dispatchEvent(new Event("gamepadconnected")));
  let r0 = await reviews(K);

  // ---- 07-3: a sheet over study (Controls via ?) swallows Space and 1–4
  await K.keyboard.press("?"); await K.waitForTimeout(150);
  await K.keyboard.press(" "); await K.keyboard.press("3"); await K.keyboard.press("2"); await K.waitForTimeout(200);
  ok("07-3 with the Controls sheet open, Space and 1–4 neither flip nor grade", (await reviews(K)) === r0 && !(await answerShown(K)));
  await pad(A); await pad(RIGHT); await K.waitForTimeout(150);
  ok("07-3 …nor do pad A and the d-pad", (await reviews(K)) === r0 && !(await answerShown(K)));
  await K.keyboard.press("Escape"); await K.waitForTimeout(200);
  ok("07-3 …Esc closes the sheet and the session stays", (await overlays(K)) === 0 && (await inStudy(K)));

  // ---- 07-1 / 02-1: typing a hook is typing; Enter saves it
  await K.keyboard.press(" "); await K.waitForSelector(".answer-bar"); r0 = await reviews(K);
  await K.keyboard.press("m"); await K.waitForSelector(".study [role=menu]");
  ok("02-7 M opens the card menu with the focus on its first item", await K.evaluate(() => !!document.activeElement?.closest("[role=menu]")));
  await K.click("[role=menu] >> text=Add my hook"); await K.waitForSelector(".hook textarea");
  ok("07-1 the hook box has the focus", await K.evaluate(() => document.activeElement?.matches(".hook textarea") ?? false));
  const hook = "K shifts 2 cells 1 i m h r 3 4";
  await K.keyboard.type(hook); await K.waitForTimeout(200);
  const ht = await K.evaluate(() => (document.querySelector(".hook textarea") as HTMLTextAreaElement | null)?.value ?? "GONE");
  ok("07-1 typing spaces, digits and i m h r in the hook box grades nothing and opens nothing", (await reviews(K)) === r0 && ht === hook && (await overlays(K)) === 0 && (await K.locator(".study [role=menu]").count()) === 0, ht);
  await K.keyboard.press("Enter"); await K.waitForTimeout(300);
  const saved = await K.evaluate(() => { const y = (window as any).yuzu; return [...y.notes.keys()].map((n: string) => y.hookFor(n)).find(Boolean) ?? ""; });
  ok("07-1 Enter in the hook box saves the hook (and does not grade)", saved === hook && (await K.locator(".hook textarea").count()) === 0 && (await reviews(K)) === r0, saved);
  // Esc in an open hook box cancels the hook, not the session
  await K.click(".hook-text"); await K.waitForSelector(".hook textarea"); await K.keyboard.type(" more"); await K.keyboard.press("Escape"); await K.waitForTimeout(200);
  ok("Esc in the hook box cancels the edit and keeps the session", (await inStudy(K)) && (await K.locator(".hook textarea").count()) === 0 && (await K.locator(".hook-text").innerText()).includes(hook) && !(await K.locator(".hook-text").innerText()).includes("more"));

  // ---- 02-1: the Needs improving note
  await K.keyboard.press("m"); await K.waitForSelector(".study [role=menu]"); await K.click("[role=menu] >> text=Needs improving");
  await K.waitForSelector(".sheet textarea"); await K.click(".sheet textarea"); await K.keyboard.type("2 3 i m split it"); await K.waitForTimeout(200);
  const it = await K.evaluate(() => (document.querySelector(".sheet textarea") as HTMLTextAreaElement | null)?.value ?? "GONE");
  ok("02-1 typing in the Needs improving note grades nothing and opens no Card info", (await reviews(K)) === r0 && it === "2 3 i m split it" && (await overlays(K)) === 1, it);
  await K.click(".sheet b"); await K.keyboard.press(" "); await K.keyboard.press("2"); await K.waitForTimeout(200);
  ok("07-3 with the Needs improving sheet open (focus off the box), Space and 2 grade nothing", (await reviews(K)) === r0);
  await K.keyboard.press("Escape"); await K.waitForTimeout(200);
  ok("…Esc closes that sheet and the session stays", (await overlays(K)) === 0 && (await inStudy(K)));

  // ---- 02-7 / 07-2: Esc with the menu open closes only the menu; keys don't grade behind it; arrows move through it
  await K.keyboard.press("m"); await K.waitForSelector(".study [role=menu]");
  await K.keyboard.press("3"); await K.keyboard.press("4"); await K.keyboard.press("i"); await K.waitForTimeout(150);
  ok("07-2 with the menu open, 3 / 4 / i grade nothing and open nothing", (await reviews(K)) === r0 && (await overlays(K)) === 0);
  const f0 = await K.evaluate(() => document.activeElement?.textContent ?? ""); await K.keyboard.press("ArrowDown");
  const f1 = await K.evaluate(() => document.activeElement?.closest("[role=menu]") ? document.activeElement!.textContent : "");
  ok("07-2 ↓ moves to the next menu item", !!f1 && f1 !== f0, `${f0} → ${f1}`);
  await K.keyboard.press("Escape"); await K.waitForTimeout(200);
  ok("02-7 Esc closes the menu and the session stays", (await K.locator(".study [role=menu]").count()) === 0 && (await inStudy(K)));
  await K.click(".study-body", { button: "right" }); await K.waitForSelector(".study [role=menu]"); await K.keyboard.press("Escape"); await K.waitForTimeout(200);
  ok("02-7 right-click menu → Esc closes the menu and the session stays", (await K.locator(".study [role=menu]").count()) === 0 && (await inStudy(K)));

  // ---- 07-2 on the pad: Menu opens, the d-pad moves, A presses, B closes only the menu
  await pad(MENU); await K.waitForSelector(".study [role=menu]");
  await pad(RIGHT); await pad(LEFT); await K.waitForTimeout(100);
  ok("07-2 pad: the d-pad over the open menu grades nothing", (await reviews(K)) === r0 && (await K.locator(".study [role=menu]").count()) === 1);
  await pad(B); await K.waitForTimeout(200);
  ok("07-2 pad: B closes the menu and the session stays", (await K.locator(".study [role=menu]").count()) === 0 && (await inStudy(K)));
  await pad(MENU); await K.waitForSelector(".study [role=menu]");
  for (let i = 0; i < 8 && !/Flag this card/.test(await K.evaluate(() => document.activeElement?.textContent ?? "")); i++) await pad(DOWN);
  await pad(A); await K.waitForTimeout(250);
  ok("07-2 pad: moving to Flag this card and pressing A flags it", (await K.locator(".study-meta >> text=flagged").count()) === 1 && (await K.locator(".study [role=menu]").count()) === 0 && (await reviews(K)) === r0);
  await pad(MENU); await K.waitForSelector(".study [role=menu]"); await pad(MENU); await K.waitForTimeout(150);
  ok("…and pad Menu closes the menu again", (await K.locator(".study [role=menu]").count()) === 0 && (await inStudy(K)));

  // ---- 02-5: holding Space flips once and grades nothing; a fresh press grades one card
  await K.keyboard.press("3"); await K.waitForTimeout(300); r0 = await reviews(K);
  ok("(a new card front is showing)", !(await answerShown(K)) && r0 > 0);
  await K.keyboard.down(" "); for (let i = 0; i < 6; i++) { await K.keyboard.down(" "); await K.waitForTimeout(30); } await K.keyboard.up(" "); await K.waitForTimeout(250);
  ok("02-5 holding Space (auto-repeat) only shows the answer", (await answerShown(K)) && (await reviews(K)) === r0, String((await reviews(K)) - r0));
  await K.keyboard.down("3"); for (let i = 0; i < 5; i++) await K.keyboard.down("3"); await K.keyboard.up("3"); await K.waitForTimeout(300);
  ok("02-5 holding 3 grades exactly one card", (await reviews(K)) === r0 + 1);
  r0 = await reviews(K);
  await K.evaluate(() => { for (let i = 0; i < 3; i++) window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })); }); await K.waitForTimeout(250);
  ok("02-5 a second keydown without a key-up (no repeat flag) does not grade the card just flipped", (await answerShown(K)) && (await reviews(K)) === r0);
  await K.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }))); await K.keyboard.press(" "); await K.waitForTimeout(300);
  ok("02-5 …a fresh press then grades it Good", (await reviews(K)) === r0 + 1);
  r0 = await reviews(K); await pad(A); await K.waitForTimeout(150); await pad(A); await K.waitForTimeout(300);
  ok("pad: A then A again shows the answer and grades Good (each press is a fresh press)", (await reviews(K)) === r0 + 1);
  await ctx.close();

  // ---- 07-5: MCQ — the d-pad moves a highlight, A confirms; ← → do nothing; option E is reachable
  const mcq = { yuzu_pack: 1, id: "mcq6", name: "MCQ", category: "Medicine::MCQ", cards: [
    { id: "q1", type: "mcq", question: "Which is the fifth letter?", options: ["Alpha", "Bravo", "Charlie", "Delta", "Echo"], answer: 4 },
    { id: "q2", type: "mcq", question: "Which is first?", options: ["One", "Two", "Three", "Four", "Five"], answer: 0 },
  ] };
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await c2.addInitScript(PAD);
  const M = await open(c2, "M", mcq); const mp = padOf(M); await M.evaluate(() => window.dispatchEvent(new Event("gamepadconnected")));
  await M.waitForSelector(".mcq-opt");
  await mp(DOWN); await M.waitForTimeout(100);
  const hi = await M.evaluate(() => [...document.querySelectorAll(".mcq-opt")].indexOf(document.activeElement as Element));
  ok("07-5 d-pad ↓ highlights the first option without picking it", hi === 0 && !(await answerShown(M)) && (await M.locator(".mcq-opt.wrong, .mcq-opt.right").count()) === 0, String(hi));
  await mp(LEFT); await mp(RIGHT); await M.waitForTimeout(100);
  ok("07-5 ← and → do nothing on the front", !(await answerShown(M)));
  for (let i = 0; i < 4; i++) await mp(DOWN);
  const lastTxt = await M.evaluate(() => (document.activeElement as HTMLElement)?.innerText ?? "");
  ok("07-5 option E can be reached", (await M.evaluate(() => [...document.querySelectorAll(".mcq-opt")].indexOf(document.activeElement as Element))) === 4, lastTxt);
  await mp(UP); const upTxt = await M.evaluate(() => (document.activeElement as HTMLElement)?.querySelector("span:nth-child(2)")?.textContent ?? "");
  await mp(A); await M.waitForSelector(".answer-bar", { timeout: 3000 }).catch(() => {});
  const pickedTxt = await M.evaluate(() => { const el = document.querySelector(".mcq-opt.wrong") ?? document.querySelector(".mcq-opt.right"); return el?.querySelector("span:nth-child(2)")?.textContent ?? ""; });
  ok("07-5 A confirms the highlighted option", (await answerShown(M)) && pickedTxt === upTxt, `${upTxt} / ${pickedTxt}`);
  await M.keyboard.press("1"); await M.waitForTimeout(400); await M.waitForSelector(".mcq-opt:not([disabled])");
  await M.keyboard.press("ArrowDown"); await M.keyboard.press("ArrowDown"); const kTxt = await M.evaluate(() => (document.activeElement as HTMLElement)?.querySelector("span:nth-child(2)")?.textContent ?? "");
  ok("07-5 keyboard ↓ moves the highlight too, without picking", !!kTxt && !(await answerShown(M)));
  await M.keyboard.press("Enter"); await M.waitForSelector(".answer-bar", { timeout: 3000 }).catch(() => {});
  const kPicked = await M.evaluate(() => { const el = document.querySelector(".mcq-opt.wrong") ?? document.querySelector(".mcq-opt.right"); return el?.querySelector("span:nth-child(2)")?.textContent ?? ""; });
  ok("07-5 …and Enter confirms it", (await answerShown(M)) && kPicked === kTxt, `${kTxt} / ${kPicked}`);
  await c2.close();

  // ---- 02-15: the typed-answer box has the focus on a desktop (and typing h i m r there is typing)
  const lang = { yuzu_pack: 1, id: "de", category: "Languages::German", cards: [{ id: "d1", front: "kidney", back: "Niere" }, { id: "d2", front: "liver", back: "Leber" }] };
  const c3 = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const T = await open(c3, "T", lang, { typeAnswers: true });
  await T.waitForSelector("input.typeans"); await T.waitForTimeout(150);
  ok("02-15 desktop: the typed-answer box is focused", await T.evaluate(() => document.activeElement?.matches("input.typeans") ?? false));
  const tr0 = await reviews(T); await T.keyboard.type("hmir 12"); await T.waitForTimeout(150);
  ok("02-15 typing there fires no shortcut (no hint, info, menu or grade)", (await T.locator(".hint-line").count()) === 0 && (await overlays(T)) === 0 && (await T.locator(".study [role=menu]").count()) === 0 && (await reviews(T)) === tr0 && (await T.inputValue("input.typeans")) === "hmir 12");
  await T.keyboard.press("Enter"); await T.waitForTimeout(200);
  ok("02-15 Enter in the box shows the answer", (await answerShown(T)) && (await reviews(T)) === tr0);
  await c3.close();
  const c4 = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }); const P = await open(c4, "P", lang, { typeAnswers: true });
  await P.waitForSelector("input.typeans"); await P.waitForTimeout(150);
  ok("02-15 phone: the box is not focused (the keyboard doesn't jump up)", !(await P.evaluate(() => document.activeElement?.matches("input.typeans") ?? false)));
  await c4.close();
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails); process.exitCode = 1; }
  await browser.close(); server.kill();
}
