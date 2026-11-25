// WP12: the desktop (Steam Deck at a 27" monitor) — mouse, keyboard and a mocked gamepad outside study, and the wide layouts.
import { chromium, type Page, type BrowserContext } from "playwright"; import { spawn } from "node:child_process";
const port = 5120 + Number(process.env.PORT_OFFSET ?? 0); /* PORT_OFFSET lets several copies run at once */ const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`;
const PAD = `window.__pad = { id: "Steam Deck", index: 0, connected: true, mapping: "standard", buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }; navigator.getGamepads = () => [window.__pad];`;
async function open(ctx: BrowserContext, label: string): Promise<Page> {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(label + ": " + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon|save failed/.test(m.text())) errors.push(label + " console: " + m.text()); });
  await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 }); return p;
}
const pack = { yuzu_pack: 1, id: "wp12", category: "Medicine::Desk", cards: Array.from({ length: 14 }, (_, i) => ({ id: "c" + i, front: `Desk question ${i}`, back: `answer ${i}` })) };
const A = 0, B = 1, Y = 3, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
const dialogs = (p: Page) => p.locator("[role=dialog]").count();
try {
  for (const [w, h] of [[1280, 800], [1920, 1080]] as const) {
    const tag = `${w}×${h}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }); await ctx.addInitScript(PAD);
    const P = await open(ctx, tag); await P.evaluate((p) => (window as any).yuzu.importPack(p), pack);
    await P.evaluate(() => window.dispatchEvent(new Event("gamepadconnected")));
    const pad = async (b: number) => { await P.evaluate((i) => { (window as any).__pad.buttons[i].pressed = true; }, b); await P.waitForTimeout(70); await P.evaluate((i) => { (window as any).__pad.buttons[i].pressed = false; }, b); await P.waitForTimeout(70); };

    // ---- 07-6: the pad changes sliders and dropdowns
    await P.click("nav.tabs >> text=Settings"); await P.waitForTimeout(150);
    await P.click("#s-study > summary"); await P.waitForTimeout(150); // groups start closed (25/11/2026): open Daily study, as a person would
    const n0 = await P.evaluate(() => (window as any).yuzu.settings.newPerDay);
    await P.focus('input[aria-label="New cards per day"]'); await pad(RIGHT); await pad(RIGHT); await pad(RIGHT); await pad(LEFT);
    await P.waitForFunction((n) => (window as any).yuzu.settings.newPerDay === n, n0 + 2, { timeout: 3000 }).catch(() => {});
    const n1 = await P.evaluate(() => ({ v: (window as any).yuzu.settings.newPerDay, focus: (document.activeElement as HTMLElement)?.getAttribute("aria-label") }));
    ok(`${tag} pad → → → ← on a slider moves it by 2 and saves it, focus stays`, n1.v === n0 + 2 && n1.focus === "New cards per day", JSON.stringify({ n0, ...n1 }));
    const sel = P.locator("select").filter({ has: P.locator("option") }).first();
    await sel.focus(); const d0 = await sel.evaluate((s: HTMLSelectElement) => s.selectedIndex); await pad(RIGHT); await P.waitForTimeout(200);
    const d1 = await sel.evaluate((s: HTMLSelectElement) => s.selectedIndex);
    ok(`${tag} pad → on a dropdown picks the next choice`, d1 === d0 + 1 || (d0 === (await sel.evaluate((s: HTMLSelectElement) => s.options.length - 1)) && d1 === d0), `${d0} → ${d1}`);
    await pad(A); await P.waitForTimeout(250); ok(`${tag} pad A on a dropdown lists its choices in a sheet`, (await dialogs(P)) === 1 && (await P.locator(".kit-sheet .kit-item").count()) === (await sel.evaluate((s: HTMLSelectElement) => s.options.length)));
    await pad(UP); await pad(A); await P.waitForTimeout(250);
    const d2 = await sel.evaluate((s: HTMLSelectElement) => s.selectedIndex);
    ok(`${tag} …↑ then A picks the choice above, the sheet closes and focus returns`, d2 === Math.max(0, d1 - 1) && (await dialogs(P)) === 0 && (await P.evaluate(() => document.activeElement?.tagName)) === "SELECT", String(d2));

    // ---- 07-17 / 05-18: two fixed columns in jump-row order
    const cols = await P.evaluate(() => { const c = [...document.querySelectorAll(".settings-col")]; return { n: c.length, lefts: c.map((x) => Math.round(x.getBoundingClientRect().left)), first: c.map((x) => x.querySelector("details.section")?.id) }; });
    ok(`${tag} Settings has two side-by-side columns (Look | Import first)`, cols.n === 2 && cols.lefts[1] > cols.lefts[0] + 300 && cols.first[0] === "s-look" && cols.first[1] === "s-import", JSON.stringify(cols));
    const order = await P.evaluate(() => { const ids = [...document.querySelectorAll("details.section[id]")].map((d) => d.id); return ids; });
    const chips = await P.evaluate(() => [...document.querySelectorAll(".jump-row .chip")].map((b) => b.textContent));
    const want = ["s-look", "s-study", "s-exam", "s-remind", "s-import", "s-inbox", "s-improve", "s-media", "s-google", "s-sync", "s-data", "s-diag"];
    ok(`${tag} the page order of the groups matches the jump row`, JSON.stringify(order.filter((x) => want.includes(x))) === JSON.stringify(want) && chips[0] === "Look" && chips.indexOf("Import") === (chips.includes("Languages") ? chips.indexOf("Languages") : chips.indexOf("Reminders")) + 1, order.join(","));
    const gTop = () => P.evaluate(() => Math.round(document.getElementById("s-google")!.getBoundingClientRect().top + scrollY));
    const g0 = await gTop(); await P.click("#s-study > summary"); await P.waitForTimeout(150); const g1 = await gTop(); await P.click("#s-study > summary");
    ok(`${tag} closing a left-column group does not move the right column`, g0 === g1, `${g0} → ${g1}`);
    await P.click(".jump-row >> text=Controls"); await P.waitForTimeout(150);
    ok(`${tag} Settings → Controls opens the controls list`, (await P.locator('[role=dialog][aria-label="Controls"]').count()) === 1);
    const keysText = await P.locator('[role=dialog][aria-label="Controls"]').innerText();
    ok(`${tag} …which lists hold menus, sliders, Steam + X and G`, /Shift\+F10/.test(keysText) && /Steam \+ X/.test(keysText) && /G · Enter on Today/.test(keysText) && /D-pad ← \/ →/.test(keysText));
    await P.keyboard.press("Escape"); await P.waitForTimeout(150);

    // ---- 07-7: hold menus by right-click, M, Shift+F10 and pad Y
    await P.click("nav.tabs >> text=Library"); await P.click("text=Show cards in"); await P.waitForSelector(".list-row");
    await P.click(".list-row >> nth=0", { button: "right" }); await P.waitForTimeout(150);
    ok(`${tag} right-click a Library card row opens its menu`, (await dialogs(P)) === 1 && (await P.locator(".kit-sheet >> text=Study it").count() + (await P.locator(".kit-sheet .kit-item").count())) > 1);
    await P.keyboard.press("Escape"); await P.waitForTimeout(120); ok(`${tag} …Esc closes it`, (await dialogs(P)) === 0);
    await P.focus(".list-row >> nth=1"); await P.keyboard.press("m"); await P.waitForTimeout(150); ok(`${tag} M on a focused row opens its menu`, (await dialogs(P)) === 1); await P.keyboard.press("Escape"); await P.waitForTimeout(120);
    await P.focus(".list-row >> nth=1"); await P.keyboard.press("Shift+F10"); await P.waitForTimeout(150); ok(`${tag} Shift+F10 on a focused row opens its menu`, (await dialogs(P)) === 1); await P.keyboard.press("Escape"); await P.waitForTimeout(120);
    await P.focus(".list-row >> nth=2"); await pad(Y); await P.waitForTimeout(150); ok(`${tag} pad Y on a focused row opens its menu`, (await dialogs(P)) === 1);
    await pad(B); await P.waitForTimeout(150); ok(`${tag} …pad B closes it`, (await dialogs(P)) === 0);

    // ---- 07-9: wide layouts — the Library preview beside the list
    const sw = await P.evaluate(() => Math.round(document.querySelector(".screen")!.getBoundingClientRect().width));
    await P.click(".list-row >> nth=0"); await P.waitForTimeout(200);
    const dock = await P.evaluate(() => { const d = document.querySelector(".lib-dock"); const row = document.querySelector(".list-row"); return { dock: !!d, backdrop: !!document.querySelector(".sheet-backdrop"), gap: d && row ? Math.round(d.getBoundingClientRect().left - row.getBoundingClientRect().right) : null }; });
    if (w >= 1500) {
      ok(`${tag} the screen uses the width (${sw}px)`, sw >= 1400, String(sw));
      ok(`${tag} Library: the preview sits beside the list, not over it`, dock.dock && !dock.backdrop && (dock.gap ?? -1) >= 0, JSON.stringify(dock));
      await P.click(".list-row >> nth=3"); await P.waitForTimeout(150); ok(`${tag} …clicking another card shows it there`, (await P.locator(".lib-dock").innerText()).includes("answer 3") || (await P.locator(".lib-dock").count()) === 1);
      await P.click('.lib-dock [aria-label="Close preview"]'); await P.waitForTimeout(100);
    } else { ok(`${tag} below 1500px the preview stays a sheet`, !dock.dock && dock.backdrop); await P.click('[aria-label="Close preview"]'); await P.waitForTimeout(100); }
    await P.click("nav.tabs >> text=Progress"); await P.waitForTimeout(200);
    const pc = await P.evaluate(() => { const c = document.querySelector(".progress-cols"); return c ? getComputedStyle(c).gridTemplateColumns.split(" ").length : 0; });
    ok(`${tag} Progress: ${w >= 1300 ? "two columns" : "one column"}`, w >= 1300 ? pc === 2 : pc <= 1, String(pc));

    // ---- 07-8: hover hints — none after a click; rail hints beside the rail; they go by themselves
    await P.mouse.move(w / 2, h - 40); await P.waitForTimeout(100);
    const lib = await P.locator("nav.tabs .tab >> text=Library").boundingBox();
    await P.mouse.move(lib!.x + lib!.width / 2, lib!.y + lib!.height / 2); await P.waitForTimeout(60); await P.mouse.down(); await P.mouse.up(); await P.waitForTimeout(1300);
    ok(`${tag} a click on a rail tab does not leave a hint behind`, (await P.locator("[data-testid=hint]").count()) === 0);
    const prog = await P.locator("nav.tabs .tab >> text=Progress").boundingBox();
    await P.mouse.move(prog!.x + prog!.width / 2, prog!.y + prog!.height / 2); await P.waitForTimeout(1200);
    const hb = await P.locator("[data-testid=hint]").boundingBox();
    ok(`${tag} hovering a rail tab shows its hint to the right of the rail`, !!hb && hb.x >= prog!.x + prog!.width, JSON.stringify(hb));
    await P.waitForTimeout(4200); ok(`${tag} …and it goes by itself after a few seconds`, (await P.locator("[data-testid=hint]").count()) === 0);
    await P.mouse.move(w / 2, h / 2);

    // ---- 07-10: Enter on Today works with the tab focused; G starts from anywhere
    await P.click("nav.tabs >> text=Today"); await P.keyboard.press("Enter"); await P.waitForTimeout(300);
    ok(`${tag} Enter on Today starts studying even with the Today tab focused`, (await P.locator(".study").count()) === 1);
    // ---- 07-11: the card menu opens at the right-click, or under ⋯ in the study column
    await P.waitForSelector(".study-body"); await P.mouse.click(Math.round(w * 0.4), 320, { button: "right" }); await P.waitForTimeout(150);
    const mb = await P.locator(".menu").boundingBox();
    ok(`${tag} right-click opens the card menu at the pointer`, !!mb && Math.abs(mb.x - Math.round(w * 0.4)) < 4 && Math.abs(mb.y - 320) < 4, JSON.stringify(mb));
    await P.click('[aria-label="More"]', { force: true }).catch(() => {}); await P.waitForTimeout(100); if (await P.locator(".menu").count()) await P.mouse.click(5, h - 5);
    await P.click('[aria-label="More"]'); await P.waitForTimeout(150);
    const mb2 = await P.locator(".menu").boundingBox(); const more = await P.locator('[aria-label="More"]').boundingBox();
    ok(`${tag} ⋯ opens the menu right under it`, !!mb2 && !!more && Math.abs(mb2.x + mb2.width - (more.x + more.width)) < 24 && mb2.y >= more.y + more.height - 4, JSON.stringify({ mb2, more }));
    await P.mouse.click(5, h - 5); await P.waitForTimeout(100);
    await P.click('.study-top [aria-label="Close"]'); await P.waitForTimeout(300);
    await P.click("nav.tabs >> text=Library"); await P.keyboard.press("g"); await P.waitForTimeout(300);
    ok(`${tag} G starts studying from another tab`, (await P.locator(".study").count()) === 1);
    await P.click('.study-top [aria-label="Close"]'); await P.waitForTimeout(300);

    // ---- 07-16: Esc in the Today search box empties it, then lets go; the pad's first text field says Steam + X
    await P.click("nav.tabs >> text=Today"); const qs = P.locator('input[placeholder^="Search"]').first();
    await qs.click(); await qs.type("lst ?"); await P.keyboard.press("Escape");
    const e1 = await qs.evaluate((i: HTMLInputElement) => ({ v: i.value, f: document.activeElement === i }));
    await P.keyboard.press("Escape"); const e2 = await qs.evaluate((i: HTMLInputElement) => document.activeElement === i);
    ok(`${tag} Esc empties the search box, a second Esc leaves it`, e1.v === "" && e1.f && !e2, JSON.stringify({ e1, e2 }));
    await P.evaluate(() => localStorage.removeItem("yuzu-pad-kb-tip")); await qs.focus(); await pad(A); await P.waitForTimeout(150);
    ok(`${tag} pad A on a text field tells how to type on the Deck`, /Steam \+ X/.test(await P.locator(".kit-snack").innerText().catch(() => "")));
    await qs.type("x"); await pad(B); await pad(B); ok(`${tag} …and pad B empties, then leaves it`, await qs.evaluate((i: HTMLInputElement) => i.value === "" && document.activeElement !== i));
    await pad(DOWN); ok(`${tag} …after which the d-pad moves on`, await P.evaluate(() => !!document.querySelector(".pad-focus")));

    // ---- Today deck rows: right-click reaches "Due only / New only"
    const stack = P.locator(".stack.kit-holdable").first();
    if (await stack.count()) { await stack.click({ button: "right" }); await P.waitForTimeout(150); ok(`${tag} right-click a Today deck row opens its menu`, (await dialogs(P)) === 1); await P.keyboard.press("Escape"); }
    await P.screenshot({ path: `/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad/wp12-${w}.png` });
    await ctx.close();
  }
  { // ---- 07-9 at 2560×1440: the buttons sit under the card, and the card text is bigger
    const ctx = await browser.newContext({ viewport: { width: 2560, height: 1440 } }); const P = await open(ctx, "2560");
    await P.evaluate((p) => (window as any).yuzu.importPack(p), pack); await P.keyboard.press("g"); await P.waitForSelector(".study .paper");
    await P.keyboard.press("Space"); await P.waitForSelector(".answer-bar");
    const g = await P.evaluate(() => { const c = document.querySelector(".study .paper")!.getBoundingClientRect(), a = document.querySelector(".answer-bar")!.getBoundingClientRect(); return { gap: Math.round(a.top - c.bottom), zoom: getComputedStyle(document.querySelector(".study .card-host")!).zoom }; });
    ok("2560×1440 the answer buttons sit right under the card", g.gap >= 0 && g.gap < 160, JSON.stringify(g));
    ok("2560×1440 the card text is scaled up", Number(g.zoom) > 1.2, String(g.zoom));
    await P.screenshot({ path: `/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad/wp12-2560-study.png` });
    await ctx.close();
  }
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails); process.exitCode = 1; }
  await browser.close(); server.kill();
}
