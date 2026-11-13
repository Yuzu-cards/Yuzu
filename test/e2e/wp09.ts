// WP09: every sheet is a proper dialog — Escape and pad B close it, focus moves in and comes back, Tab stays inside,
// the page behind is inert, a half-typed card or capture survives a stray tap outside (and Back), stacked sheets unwind
// one at a time, the file buttons are reachable, and the screen-reader basics (current tab, pressed segments, labels,
// a study heading and announcements) are there.
import { chromium, type Page } from "playwright"; import { spawn } from "node:child_process";
const port = 5090 + Number(process.env.PORT_OFFSET ?? 0); /* PORT_OFFSET lets several copies run at once */ const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`;
const pack = { yuzu_pack: 1, id: "wp09", category: "Medicine::Dialogs", cards: Array.from({ length: 8 }, (_, i) => ({ id: "c" + i, front: `Dialog question ${i}`, back: `answer ${i}` })) };

const dialogs = (p: Page) => p.evaluate(() => [...document.querySelectorAll<HTMLElement>("[role=dialog]")].map((d) => d.getAttribute("aria-label") || document.getElementById(d.getAttribute("aria-labelledby") ?? "")?.textContent || "?"));
const top = (p: Page) => p.evaluate(() => { const d = [...document.querySelectorAll<HTMLElement>("[role=dialog]")].pop(); return d ? d.getAttribute("aria-label") || document.getElementById(d.getAttribute("aria-labelledby") ?? "")?.textContent || "?" : null; });
const focusInTop = (p: Page) => p.evaluate(() => { const d = [...document.querySelectorAll<HTMLElement>("[role=dialog]")].pop(); return !!d && d.contains(document.activeElement); });
const focusId = (p: Page) => p.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a ? (a.getAttribute("aria-label") || a.textContent || a.tagName).trim().slice(0, 40) : ""; });
async function tabStaysInside(p: Page, n = 30) { for (let i = 0; i < n; i++) { await p.keyboard.press(i % 7 === 6 ? "Shift+Tab" : "Tab"); if (!(await focusInTop(p))) return false; } return true; }
// press until the app has seen it (its loop runs on animation frames, which a busy headless browser can space out), then release
async function pad(p: Page, b: number) {
  await p.evaluate((i) => { const w = window as any; if (!w.__padHooked) { w.__padHooked = true; window.addEventListener("yuzu-pad", (e) => { w.__padSeen = (e as CustomEvent).detail; }); } w.__padSeen = -1; w.__pad.buttons[i].pressed = true; }, b);
  await p.waitForFunction((i) => (window as any).__padSeen === i, b, { timeout: 2000 }).catch(() => {});
  await p.evaluate((i) => { (window as any).__pad.buttons[i].pressed = false; }, b); await p.waitForTimeout(100);
}
const B = 1, LB = 4, RB = 5;

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(`window.__pad = { id: "Steam Deck", index: 0, connected: true, mapping: "standard", buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }; navigator.getGamepads = () => [window.__pad];`);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon/.test(m.text())) errors.push("console: " + m.text()); });
  await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  await p.evaluate((x) => (window as any).yuzu.importPack(x), pack); await p.evaluate(() => window.dispatchEvent(new Event("gamepadconnected")));
  await p.evaluate(async () => { const y = (window as any).yuzu; for (const c of [...y.cards.values()].slice(0, 6)) await y.answer(c.id, 1, 3000); }); // a few weak cards, so Practice has something
  const histLen0 = await p.evaluate(() => history.length);

  // ---- Every sheet: opened from a focused button, it is a labelled modal dialog, takes focus, keeps Tab, closes on Esc and pad B, gives focus back
  type Opener = { name: string; open: () => Promise<void>; expect: string };
  const viaKey = (tab: string, key: string) => async () => { await p.click(`nav.tabs >> text=${tab}`); await p.locator("nav.tabs .tab.active").focus(); await p.keyboard.press(key); };
  const viaClick = (tab: string, sel: string) => async () => { await p.click(`nav.tabs >> text=${tab}`); await p.locator(sel).first().focus(); await p.keyboard.press("Enter"); };
  const openers: Opener[] = [
    { name: "Quick add (N)", open: viaKey("Today", "n"), expect: "Quick add" },
    { name: "Capture (C)", open: viaKey("Today", "c"), expect: "Capture" },
    { name: "Why so many reviews (W)", open: viaKey("Today", "w"), expect: "Why so many reviews" },
    { name: "Controls (?)", open: viaKey("Today", "?"), expect: "Controls" },
    { name: "Card editor (Library ＋ Card)", open: viaClick("Library", "button:has-text('＋ Card')"), expect: "Card editor" },
    { name: "Image occlusion (Library ＋ Image)", open: viaClick("Library", "button:has-text('＋ Image')"), expect: "Image occlusion" },
    { name: "Practice with Claude", open: async () => { await p.click("nav.tabs >> text=Today"); await p.locator("nav.tabs .tab.active").focus(); await p.evaluate(() => (window as any).yuzu.openOnToday("practice")); }, expect: "Practice with Claude" },
  ];
  for (const o of openers) {
    for (const how of ["Esc", "pad B"] as const) {
      await o.open(); await p.waitForSelector("[role=dialog]", { timeout: 4000 }).catch(() => {}); await p.waitForTimeout(150);
      const name = await top(p);
      if (name !== o.expect) { ok(`${o.name}: opens`, false, `top dialog: ${name}; all: ${JSON.stringify(await dialogs(p))}`); break; }
      if (how === "Esc") {
        const sem = await p.evaluate(() => { const d = [...document.querySelectorAll<HTMLElement>("[role=dialog]")].pop()!; return { modal: d.getAttribute("aria-modal"), heading: !!d.querySelector("h2"), rootInert: document.getElementById("root")!.hasAttribute("inert") }; });
        ok(`${o.name}: a labelled modal dialog with a heading, the app behind inert`, sem.modal === "true" && sem.heading && sem.rootInert, JSON.stringify(sem));
        ok(`${o.name}: focus moves into it`, await focusInTop(p), await focusId(p));
        ok(`${o.name}: Tab and Shift+Tab stay inside`, await tabStaysInside(p));
      }
      if (how === "Esc") await p.keyboard.press("Escape"); else await pad(p, B);
      await p.waitForTimeout(250);
      const after = await p.evaluate(() => ({ n: document.querySelectorAll("[role=dialog]").length, inert: document.getElementById("root")!.hasAttribute("inert"), focus: (document.activeElement as HTMLElement)?.textContent?.trim().slice(0, 30), body: document.activeElement === document.body }));
      ok(`${o.name}: ${how} closes it and focus comes back`, after.n === 0 && !after.inert && !after.body, JSON.stringify(after));
    }
  }
  ok("closing every sheet left no stray history entries (Back would not need extra presses)", (await p.evaluate(() => history.length)) - histLen0 <= openers.length * 2 + 2, String((await p.evaluate(() => history.length)) - histLen0));
  ok("…and the app is still where it was (no Back press leaked out of the app)", await p.evaluate(() => !!(window as any).yuzu?.loaded && !document.querySelector("[role=dialog]")));

  // ---- Focus comes back to the very button that opened it
  await p.click("nav.tabs >> text=Library"); const plus = p.locator("button:has-text('＋ Card')").first(); await plus.focus(); await p.keyboard.press("Enter"); await p.waitForTimeout(200);
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok("focus returns to the ＋ Card button after Esc", await p.evaluate(() => (document.activeElement as HTMLElement)?.textContent?.includes("＋ Card") ?? false), await focusId(p));

  // ---- A typed draft survives a stray tap outside, and Esc / Back ask before throwing it away
  await p.click("nav.tabs >> text=Today"); await p.keyboard.press("n"); await p.waitForTimeout(200);
  await p.fill('textarea[aria-label="Cloze text"]', "Half-typed {{c1::thing"); await p.mouse.click(640, 8); await p.waitForTimeout(250);
  ok("tapping outside a half-typed Quick add asks first", (await top(p)) === "Discard this card?", String(await top(p)));
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);
  ok("…Cancel (Esc) keeps the sheet and the text", (await top(p)) === "Quick add" && (await p.inputValue('textarea[aria-label="Cloze text"]')) === "Half-typed {{c1::thing");
  ok("…and focus goes back into the sheet", await focusInTop(p), await focusId(p));
  await p.goBack(); await p.waitForTimeout(300);
  ok("Back on a half-typed card asks too", (await top(p)) === "Discard this card?", String(await top(p)));
  await p.locator('[role=dialog][aria-label="Discard this card?"] button.kit-cancel').click(); await p.waitForTimeout(300);
  ok("…Cancel keeps it", (await top(p)) === "Quick add" && (await p.inputValue('textarea[aria-label="Cloze text"]')) === "Half-typed {{c1::thing");
  await p.goBack(); await p.waitForTimeout(300);
  ok("…and Back still belongs to the sheet afterwards (asks again, doesn't leave the app)", (await top(p)) === "Discard this card?" && p.url().startsWith(URL), `${await top(p)} ${p.url()}`);
  await p.locator('[role=dialog][aria-label="Discard this card?"] button:has-text("Discard")').click(); await p.waitForTimeout(300);
  ok("…Discard closes it", (await dialogs(p)).length === 0);
  await p.keyboard.press("n"); await p.waitForTimeout(200);
  ok("…and the next Quick add starts empty", (await p.inputValue('textarea[aria-label="Cloze text"]')) === "");
  await p.mouse.click(640, 8); await p.waitForTimeout(250);
  ok("an empty Quick add closes on a tap outside without asking", (await dialogs(p)).length === 0, JSON.stringify(await dialogs(p)));
  await p.keyboard.press("c"); await p.waitForTimeout(200); await p.fill('textarea[aria-label="Capture text"]', "Ask about the K+ in bay 3");
  await p.mouse.click(640, 8); await p.waitForTimeout(250);
  ok("a half-typed capture survives a tap outside", (await top(p)) === "Discard this capture?"); await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok("…with its text", (await p.inputValue('textarea[aria-label="Capture text"]')) === "Ask about the K+ in bay 3");
  // a drag that starts inside the sheet (selecting text) and ends on the dimmed area is not a tap outside
  const ta = (await p.locator('textarea[aria-label="Capture text"]').boundingBox())!; await p.mouse.move(ta.x + 10, ta.y + 10); await p.mouse.down(); await p.mouse.move(640, 8, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(200);
  ok("selecting text out past the sheet's edge doesn't count as a tap outside", (await top(p)) === "Capture");

  // ---- File buttons are real buttons: Tab reaches "Add photo" and Enter opens the picker
  let reached = false; for (let i = 0; i < 12 && !reached; i++) { await p.keyboard.press("Tab"); reached = (await focusId(p)) === "Add photo"; }
  ok("Tab reaches Add photo in Capture", reached);
  // the picker itself is the browser's; what matters is that Enter on the button clicks the file input (watched, not opened: a headless picker under load is flaky)
  await p.evaluate(() => { const w = window as any; w.__picked = ""; const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function (this: HTMLInputElement) { if (this.type === "file") { w.__picked = this.accept; return; } return orig.call(this); }; });
  await p.keyboard.press("Enter"); await p.waitForTimeout(150);
  ok("…and Enter opens the file picker (for a picture)", (await p.evaluate(() => (window as any).__picked)) === "image/*");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200); await p.locator('[role=dialog] button:has-text("Discard")').click(); await p.waitForTimeout(200);

  // ---- Stacked sheets unwind one at a time; LB/RB and letters don't act behind a sheet
  await p.keyboard.press("n"); await p.waitForTimeout(200); await p.keyboard.press("?"); await p.waitForTimeout(200);
  ok("? over Quick add stacks Controls on top", JSON.stringify(await dialogs(p)) === JSON.stringify(["Quick add", "Controls"]), JSON.stringify(await dialogs(p)));
  ok("…focus is in Controls and Tab stays there", await focusInTop(p) && await tabStaysInside(p, 10));
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok("…Esc closes Controls only", JSON.stringify(await dialogs(p)) === JSON.stringify(["Quick add"]));
  ok("…and focus is back in Quick add", await focusInTop(p));
  await pad(p, RB); await pad(p, LB); await pad(p, RB); await p.waitForTimeout(150);
  ok("RB/LB don't switch the tab behind a sheet", (await p.locator("nav.tabs .tab.active").innerText()).includes("Today") && (await top(p)) === "Quick add");
  await p.locator('[role=dialog][aria-label="Quick add"]').focus(); await p.keyboard.press("l"); await p.waitForTimeout(150);
  ok("…nor do letter shortcuts", (await p.locator("nav.tabs .tab.active").innerText()).includes("Today"));
  await pad(p, B); await p.waitForTimeout(200);
  ok("…and pad B closes Quick add", (await dialogs(p)).length === 0);

  // ---- Screen-reader basics
  ok("the active tab is aria-current=page", await p.evaluate(() => { const a = document.querySelectorAll("nav.tabs .tab[aria-current=page]"); return a.length === 1 && a[0].classList.contains("active"); }));
  await p.click("nav.tabs >> text=Library"); await p.waitForTimeout(150);
  ok("Library's view switch says which one is on (aria-pressed)", await p.evaluate(() => { const b = [...document.querySelectorAll<HTMLElement>(".seg button")]; return b.length > 2 && b.filter((x) => x.getAttribute("aria-pressed") === "true").length === 1 && b.every((x) => x.hasAttribute("aria-pressed")); }));
  ok("the searches have a name, not just a placeholder", await p.evaluate(() => [...document.querySelectorAll<HTMLInputElement>("input[placeholder^='Search']")].every((i) => !!i.getAttribute("aria-label"))));
  await p.click("button:has-text('＋ Image')"); await p.waitForTimeout(200);
  ok("Image occlusion has a real Choose a picture button", await p.locator("[role=dialog] button:has-text('Choose a picture')").count() === 1); await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  await p.click("nav.tabs >> text=Settings"); await p.waitForTimeout(300);
  const labels = await p.evaluate(() => { const ls = [...document.querySelectorAll<HTMLLabelElement>(".field > label")].filter((l) => l.parentElement!.querySelector("input:not([type=hidden]):not([type=file]):not([type=checkbox]),select,textarea")); return { n: ls.length, tied: ls.filter((l) => l.htmlFor && document.getElementById(l.htmlFor)?.closest(".field") === l.parentElement).length }; });
  ok("every field label in Settings is tied to its field", labels.n > 5 && labels.tied === labels.n, JSON.stringify(labels));
  await p.click("nav.tabs >> text=Today"); await p.keyboard.press("n"); await p.waitForTimeout(200);
  ok("…and in the card editor (a tap on the label focuses the field)", await p.evaluate(() => { const l = [...document.querySelectorAll<HTMLLabelElement>("[role=dialog] .field > label")].find((x) => /^Deck/.test(x.textContent ?? "")); l?.click(); return !!l && document.activeElement?.getAttribute("aria-label") === "Deck"; }), await p.evaluate(() => JSON.stringify([document.querySelector("[role=dialog]")?.getAttribute("aria-label"), [...document.querySelectorAll<HTMLLabelElement>("[role=dialog] .field > label")].map((l) => l.textContent + ">" + l.htmlFor), document.activeElement?.outerHTML.slice(0, 80)])));
  await p.keyboard.press("Escape"); await p.waitForTimeout(150); if ((await dialogs(p)).length) await p.keyboard.press("Escape");

  // ---- Study: a heading, announcements, and Card info (I) as a dialog over it
  await p.click("nav.tabs >> text=Today"); await p.click(".hero >> text=Study"); await p.waitForSelector(".study .card-host", { timeout: 10000 }); await p.waitForTimeout(200);
  ok("the study screen has a heading", /Studying .+ left/.test(await p.evaluate(() => document.querySelector(".study h1")?.textContent ?? "")), await p.evaluate(() => document.querySelector(".study h1")?.textContent ?? ""));
  await p.keyboard.press("Space"); await p.waitForTimeout(150);
  ok("showing the answer is announced", (await p.locator("[data-testid=study-live]").innerText()) === "Answer shown");
  await p.keyboard.press("i"); await p.waitForTimeout(250);
  ok("I opens Card info as a dialog with focus inside", (await top(p)) === "Card info" && await focusInTop(p), `${await top(p)} ${await focusId(p)}`);
  ok("…Tab stays inside it", await tabStaysInside(p, 15));
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok("…Esc closes Card info and leaves the session running", (await dialogs(p)).length === 0 && await p.locator(".study .card-host").count() === 1);
  await p.keyboard.press("i"); await p.waitForTimeout(200); await p.click("text=Edit this card"); await p.locator("[role=dialog] textarea").first().fill("Edited front"); await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok("…an unsaved edit in Card info asks before Esc throws it away", (await top(p)) === "Discard your changes to this card?");
  await p.keyboard.press("Escape"); await p.waitForTimeout(150); await p.click('[role=dialog] [aria-label="Close info"]'); await p.waitForTimeout(150); await p.locator('[role=dialog] button:has-text("Discard")').click(); await p.waitForTimeout(200);
  await pad(p, B); await p.waitForTimeout(300);
  ok("…and pad B then leaves study", await p.locator(".study .card-host").count() === 0);

  // ---- Phone width: Android Back closes a sheet
  await p.setViewportSize({ width: 412, height: 915 }); await p.click("nav.tabs >> text=Today"); await p.keyboard.press("w"); await p.waitForTimeout(200);
  await p.goBack(); await p.waitForTimeout(300);
  ok("Android Back closes Why so many reviews", (await dialogs(p)).length === 0 && !!(await p.evaluate(() => (window as any).yuzu?.loaded)));
  await ctx.close();
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails); process.exitCode = 1; }
  await browser.close(); server.kill();
}
