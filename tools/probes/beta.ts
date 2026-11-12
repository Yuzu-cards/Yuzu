// Deep beta on the real collection (a copy of a persistent profile that already holds it): every screen at phone and desktop size
// with all sections open, a scan for broken text (undefined / NaN / null / [object Object] / Infinity), sideways overflow, tiny tap
// targets, slow screens, console errors; a study run; a random-tap sweep. Usage: npx tsx tools/probes/beta.ts <profileDir> <shotsDir> [taps=300]
import { chromium, type Page } from "playwright"; import { spawn } from "node:child_process";
const dir = process.argv[2]; const shots = process.argv[3]; const TAPS = Number(process.argv[4] ?? 300);
const port = 4189; /* the origin the profile was imported under */ const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const issues: string[] = []; const errors: string[] = []; const timings: Record<string, number> = {};
let ctx: any, page: Page;
async function launch(w: number, h: number, mobile: boolean) {
  if (ctx) await ctx.close();
  ctx = await chromium.launchPersistentContext(dir, { serviceWorkers: "block", viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, timezoneId: "Asia/Riyadh" });
  page = ctx.pages()[0] ?? (await ctx.newPage()); await (await ctx.newCDPSession(page)).send("Network.setCacheDisabled", { cacheDisabled: true });
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 300))); page.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon|accounts.google/.test(m.text())) errors.push("console: " + m.text().slice(0, 300)); });
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 120000 });
}
const BAD = /\b(undefined|NaN|null|Infinity)\b|\[object Object\]/;
async function scan(where: string) {
  const r = await page.evaluate((VW: number) => {
    const out: any = { bad: [] as string[], wide: [] as string[], tiny: [] as string[] };
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n: Node | null;
    while ((n = walk.nextNode())) { const t = n.textContent ?? ""; if (/\b(undefined|NaN|null|Infinity)\b|\[object Object\]/.test(t) && !(n.parentElement?.closest("pre,code,textarea,.card-host"))) out.bad.push(t.trim().slice(0, 80)); }
    const vw = VW; out.scrollW = Math.max(document.documentElement.scrollWidth, document.documentElement.clientWidth) - vw;
    for (const el of document.querySelectorAll<HTMLElement>("body *")) { const b = el.getBoundingClientRect(); if (b.width && b.right > vw + 2 && getComputedStyle(el).position !== "fixed" && !el.closest(".hscroll,.tree-scroll,[style*='overflow']") && ![...el.children].some((c) => (c as HTMLElement).getBoundingClientRect().right > vw + 2)) { out.wide.push(el.tagName.toLowerCase() + "." + [...el.classList].join(".") + " '" + (el.textContent ?? "").trim().slice(0, 24) + "' " + Math.round(b.right - vw) + "px"); if (out.wide.length > 8) break; } }
    for (const el of document.querySelectorAll<HTMLElement>("button, a, input[type=checkbox]:not(label input), select")) { const b = el.getBoundingClientRect(); if (b.width && b.height && (b.height < 28 || b.width < 28) && getComputedStyle(el).visibility !== "hidden") out.tiny.push((el.getAttribute("aria-label") ?? el.textContent ?? el.tagName).trim().slice(0, 30) + ` ${Math.round(b.width)}×${Math.round(b.height)}`); }
    return out;
  }, page.viewportSize()!.width);
  for (const b of r.bad) issues.push(`${where}: broken text "${b}"`);
  if (r.scrollW > 1) issues.push(`${where}: page scrolls sideways by ${r.scrollW}px (${r.wide.slice(0, 3).join(", ")})`);
  if (r.tiny.length) issues.push(`${where}: small tap targets ${[...new Set(r.tiny)].slice(0, 8).join(" | ")}`);
}
async function tab(name: string) { const t0 = Date.now(); await page.click(`nav.tabs >> text=${name}`); await page.waitForTimeout(150); await page.waitForLoadState("networkidle").catch(() => {}); timings[name] = Date.now() - t0; }
async function openAll() { await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await page.waitForTimeout(300); }
try {
  await launch(412, 915, true); const t0 = Date.now(); await page.goto(`http://127.0.0.1:${port}/`); await page.evaluate(async () => { for (const r of (await navigator.serviceWorker?.getRegistrations()) ?? []) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); }); /* an old service worker in the profile would serve an old build */
  const t1 = Date.now(); await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 120000 }); timings.open = Date.now() - t1; void t0;
  const info = await page.evaluate(() => ({ cards: (window as any).yuzu.cards.size, notes: (window as any).yuzu.notes.size, version: document.body.innerText.match(/Yuzu \d+\.\d+\.\d+/)?.[0] }));
  for (const [w, h, label] of [[412, 915, "phone"], [820, 1180, "tablet"], [1440, 900, "desktop"]] as const) {
    if (label !== "phone") await launch(w, h, label === "tablet");
    for (const t of ["Today", "Library", "Progress", "Settings"]) { await tab(t); await openAll(); await scan(`${label} ${t}`); await page.screenshot({ path: `${shots}/${label}-${t.toLowerCase()}.png`, fullPage: label === "phone" }); }
  }
  await launch(412, 915, true);
  // Study: 25 cards, mixed grades, one undo, the menu, info sheet
  await tab("Today"); const s0 = Date.now(); await page.click(".hero >> text=Study").catch(() => issues.push("Today: no Study button on the hero"));
  await page.waitForSelector(".study .card-host, .plan, text=How long", { timeout: 20000 }).catch(() => {}); timings.studyOpen = Date.now() - s0;
  if (await page.locator("button:has-text('Start')").first().isVisible().catch(() => false)) { await page.screenshot({ path: `${shots}/study-plan.png` }); await scan("study plan"); await page.locator("button:has-text('Start')").first().click(); }
  await page.waitForSelector(".study .card-host", { timeout: 20000 });
  const grades = ["1", "3", "3", "2", "3", "4", "3", "1", "3", "3"]; let answered = 0; const per: number[] = [];
  for (let i = 0; i < 25; i++) {
    await scan("study card"); if (i === 2) await page.screenshot({ path: `${shots}/study-front.png` });
    await page.keyboard.press("Space"); await page.waitForSelector(".answer-bar", { timeout: 5000 }).catch(() => {});
    if (i === 2) await page.screenshot({ path: `${shots}/study-back.png` });
    const a0 = Date.now(); await page.keyboard.press(grades[i % grades.length]); await page.waitForTimeout(60); per.push(Date.now() - a0); answered++;
    if (i === 5) { await page.keyboard.press("z").catch(() => {}); await page.waitForTimeout(200); }
    if (!(await page.locator(".study .card-host").count())) break;
  }
  timings.answerMedian = per.sort((a, b) => a - b)[Math.floor(per.length / 2)];
  await page.click('button[aria-label="More"]').catch(() => {}); await page.waitForTimeout(200); await scan("study menu"); await page.screenshot({ path: `${shots}/study-menu.png` }); await page.keyboard.press("Escape");
  await page.keyboard.press("Escape"); await page.waitForTimeout(300); await page.goBack().catch(() => {}); await page.waitForTimeout(500);
  // Library: search, a deck, a note
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 120000 });
  await tab("Library"); const q0 = Date.now(); const search = page.locator('input[type=search], input[placeholder*="Search"]').first(); await search.fill("hyperkalemia"); await page.waitForTimeout(600); timings.search = Date.now() - q0;
  await scan("library search"); await page.screenshot({ path: `${shots}/library-search.png` });
  await page.locator(".note-row, .row.note, li").first().click().catch(() => {}); await page.waitForTimeout(500); await scan("library note"); await page.screenshot({ path: `${shots}/library-note.png` });
  // Random-tap sweep: visible buttons/links/summaries, skipping anything that deletes, resets, signs out or leaves the app
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 120000 });
  const SKIP = /delete|erase|reset|remove|roll back|sign out|disconnect|forget|discard|replace|import|export|download|copy|open claude|back up now|bring back|suspend all|retire|merge all|clear|wipe|choose file|picture|photo/i;
  let taps = 0, seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < TAPS; i++) {
    const els = await page.$$("button:visible, summary:visible, a[href^='#']:visible, [role=button]:visible, .chip:visible");
    const pick = els[Math.floor(rnd() * els.length)]; if (!pick) { await page.keyboard.press("Escape"); continue; }
    const label = ((await pick.getAttribute("aria-label")) ?? (await pick.innerText().catch(() => ""))).trim().slice(0, 40);
    if (SKIP.test(label) || /^https?:/.test((await pick.getAttribute("href")) ?? "")) continue;
    const before = errors.length; await pick.click({ timeout: 1500 }).catch(() => {}); taps++; await page.waitForTimeout(80);
    if (errors.length > before) issues.push(`sweep: tapping "${label}" → ${errors[errors.length - 1]}`);
    if (i % 25 === 0) await scan(`sweep after "${label}"`);
    if (await page.locator("text=Something went wrong").count()) { issues.push(`sweep: crash screen after "${label}"`); await page.screenshot({ path: `${shots}/crash-${i}.png` }); await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 120000 }); }
    if (rnd() < 0.08) await page.keyboard.press("Escape");
  }
  console.log(JSON.stringify({ info, timings, answered, taps, issues: [...new Set(issues)], errors: [...new Set(errors)].slice(0, 20) }, null, 1));
} catch (e: any) { await page.screenshot({ path: `${shots}/crash.png` }).catch(() => {}); console.log(JSON.stringify({ crash: e?.message?.slice(-1200), timings, issues: [...new Set(issues)], errors: [...new Set(errors)].slice(0, 20) }, null, 1)); }
finally { await ctx.close(); server.kill(); }
