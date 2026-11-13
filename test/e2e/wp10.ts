// WP10: the visual design system — a focus ring you can see in every interface (also through Arcade's notched clip-path),
// WCAG contrast measured from computed styles, the flat interfaces' soft spine, tap targets, link-buttons, keyboard chips.
import { chromium, type Page } from "playwright"; import { spawn } from "node:child_process"; import { createRequire } from "node:module";
const sharp = createRequire(import.meta.url)("sharp");
const port = 5100 + Number(process.env.PORT_OFFSET ?? 0); const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`;
const pack = { yuzu_pack: 1, id: "wp10", name: "wp10", cards: [
  { id: "a", type: "cloze", category: "Medicine::Cardio", text: "Beck's triad: hypotension, {{c1::muffled heart sounds}} and raised JVP", extra: "Exam pearl", tags: ["auto::System::Endocrine"] },
  { id: "b", type: "basic", category: "Pharmacology::Abx", front: "Antidote for heparin?", back: "Protamine", tags: ["auto::System::Hematology & Oncology"] },
  { id: "m", type: "mcq", category: "Step 1::Bio", question: "Peaked T waves?", options: ["Hyperkalaemia", "Hypokalaemia", "Hypocalcaemia"], answer: 0, explanation: "Because." }] };

// WCAG 2.x contrast of every visible text node against its composited background (from getComputedStyle)
const LOW = `(() => {
  const parse = (s) => { let m = s && s.match(/rgba?\\(([^)]+)\\)/); if (m) { const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = s && s.match(/color\\(srgb ([^)]+)\\)/); if (m) { const p = m[1].split(/[ \\/]+/).filter(Boolean).map(Number); return [p[0]*255, p[1]*255, p[2]*255, p.length > 3 ? p[3] : 1]; } return null; };
  const blend = (t, b) => [t[0]*t[3] + b[0]*(1-t[3]), t[1]*t[3] + b[1]*(1-t[3]), t[2]*t[3] + b[2]*(1-t[3]), 1];
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const up = (e) => e.parentElement || (e.getRootNode && e.getRootNode().host) || null;
  const bgOf = (el) => { const L = []; for (let e = el; e; e = up(e)) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { L.push(c); if (c[3] >= 1) break; } } let bg = parse(getComputedStyle(document.body).backgroundColor); for (let i = L.length - 1; i >= 0; i--) bg = blend(L[i], bg); return bg; };
  const opac = (el) => { let o = 1; for (let e = el; e; e = up(e)) o *= Number(getComputedStyle(e).opacity); return o; };
  const all = []; const walk = (r) => { for (const e of r.querySelectorAll("*")) { all.push(e); if (e.shadowRoot) walk(e.shadowRoot); } }; walk(document); const out = [];
  for (const el of all) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight * 3) continue;
    const cs = getComputedStyle(el); if (cs.visibility === "hidden" || el.closest("svg, button:disabled, .btn:disabled")) continue;
    const f0 = parse(cs.color); if (!f0) continue; const bg = bgOf(el); const fg = blend([f0[0], f0[1], f0[2], f0[3] * opac(el)], bg); const q = ratio(fg, bg);
    const fs = parseFloat(cs.fontSize); const large = fs >= 24 || (fs >= 18.66 && Number(cs.fontWeight) >= 700) || (/Yuzu Pixel/.test(cs.fontFamily.split(",")[0]) && fs >= 20);
    if (q < (large ? 3 : 4.5)) out.push(el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0] + " '" + el.textContent.trim().slice(0, 20) + "' " + q.toFixed(2));
  }
  return [...new Set(out)];
})()`;
const ratioOf = (p: Page, fgSel: string, prop: "color" | "borderTopColor", bgSel?: string) => p.evaluate(([s, pr, b]) => {
  const parse = (x: string) => { const m = x.match(/rgba?\(([^)]+)\)/)!; return m[1].split(/[ ,/]+/).filter(Boolean).map(Number); };
  const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const el = document.querySelector(s) as HTMLElement; if (!el) return -1; const fg = parse(getComputedStyle(el)[pr as "color"]);
  let e: HTMLElement | null = b ? document.querySelector(b) : el.parentElement; let bg = [255, 255, 255]; for (; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if ((c[3] ?? 1) >= 1) { bg = c; break; } }
  const x = lum(fg), y = lum(bg); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
}, [fgSel, prop, bgSel ?? ""] as const);

async function open(w: number, h: number, mobile: boolean) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, serviceWorkers: "block" }); await ctx.addInitScript("window.__name = (f) => f;");
  if (!mobile) await ctx.addInitScript(`window.__pad = { id: "Steam Deck", index: 0, connected: true, mapping: "standard", buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }; navigator.getGamepads = () => [window.__pad];`);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => { errors.push("dialog: " + d.message()); d.dismiss().catch(() => {}); }); await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  await p.evaluate((pk) => (window as any).yuzu.importPack(pk), pack);
  return { ctx, p };
}
async function look(p: Page, ui: string, theme: string) {
  await p.evaluate(([u, t]) => { localStorage.setItem("yuzu-ui", u); localStorage.setItem("yuzu-theme", t); }, [ui, theme]); await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded);
  await p.evaluate(async (t) => { await (window as any).yuzu.saveSettings({ theme: t, nightCards: false }); }, theme); await p.mouse.move(1, 1); await p.waitForTimeout(200);
}
const tab = async (p: Page, t: string) => { await p.locator(`nav.tabs >> text=${t}`).first().click(); await p.waitForTimeout(200); };
async function study(p: Page, label: string) { await tab(p, "Today"); await p.locator(".stack", { hasText: label }).first().click(); await p.waitForTimeout(300); const s = p.locator("button:has-text('Start')").first(); if (await s.isVisible().catch(() => false)) await s.click(); await p.waitForSelector(".study .card-host", { timeout: 5000 }); }
const leave = async (p: Page) => { for (let i = 0; i < 3 && (await p.locator(".study").count()); i++) { await p.keyboard.press("Escape"); await p.waitForTimeout(200); } };
/** pixels that change around an element between focused and not focused */
async function ringPixels(p: Page): Promise<{ diff: number; per: number; el: string } | null> {
  const r = await p.evaluate(() => { const el = document.activeElement as HTMLElement; if (!el || el === document.body) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, el: el.tagName + "." + String(el.className).split(" ")[0] + " " + (el.textContent ?? "").trim().slice(0, 14) }; });
  const vp = p.viewportSize()!; if (!r || r.w < 4 || r.y < 0 || r.y + r.h > vp.height) return null;
  const x = Math.max(0, r.x - 6), y = Math.max(0, r.y - 6); const clip = { x, y, width: Math.min(vp.width - x, r.w + 12), height: Math.min(vp.height - y, r.h + 12) };
  const on = await p.screenshot({ clip }); await p.evaluate(() => { (window as any).__f = document.activeElement; (document.activeElement as HTMLElement).blur(); document.querySelectorAll(".pad-focus").forEach((e) => { e.classList.remove("pad-focus"); e.setAttribute("data-was-pad", ""); }); });
  const off = await p.screenshot({ clip }); await p.evaluate(() => { document.querySelectorAll("[data-was-pad]").forEach((e) => { e.classList.add("pad-focus"); e.removeAttribute("data-was-pad"); }); (window as any).__f?.focus({ focusVisible: true }); });
  const [a, b] = await Promise.all([sharp(on).raw().toBuffer(), sharp(off).raw().toBuffer()]); let diff = 0;
  for (let k = 0; k < a.length; k += 3) if (Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]) > 60) diff++;
  return { diff, per: 2 * (r.w + r.h), el: r.el };
}

try {
  // ---- 08-1 / 07-13: the keyboard focus ring is visible on every stop, in all three interfaces (also notched Arcade controls)
  const D = await open(1440, 900, false);
  for (const ui of ["arcade", "clean", "paper"]) {
    await look(D.p, ui, "yuzu"); await tab(D.p, "Today"); await D.p.mouse.move(1, 1); const bad: string[] = []; let n = 0;
    for (let i = 0; i < 18; i++) { await D.p.keyboard.press("Tab"); await D.p.waitForTimeout(40); const r = await ringPixels(D.p); if (!r) continue; n++; if (r.diff < r.per * 1.5) bad.push(`${r.el} ${r.diff}/${Math.round(r.per)}`); }
    ok(`${ui}: every keyboard focus stop on Today shows a ring (${n} stops)`, n >= 8 && bad.length === 0, bad.join(" | "));
  }
  // the focus colour is never the accent (orange ring next to an orange button was 1:1)
  await look(D.p, "arcade", "yuzu"); await tab(D.p, "Today");
  for (let i = 0; i < 20 && !(await D.p.evaluate(() => !!document.activeElement?.matches(".btn.primary"))); i++) await D.p.keyboard.press("Tab");
  const pr = await D.p.evaluate(() => { const b = document.querySelector(".btn.primary") as HTMLElement; const cs = getComputedStyle(b); return { border: cs.borderTopColor, shadow: cs.boxShadow, bg: cs.backgroundColor, outline: cs.outlineStyle }; });
  ok("Arcade: the focused primary button gets a yellow inner ring with a dark line, not an orange outline the clip-path cuts", /inset/.test(pr.shadow) && pr.border === "rgb(242, 211, 75)" && pr.outline === "none", JSON.stringify(pr));
  // gamepad (a stub pad, as in edge.ts): .pad-focus draws the same ring; a keyboard Tab afterwards removes it so only one
  // place looks focused (07-13); the d-pad wraps from the last stop to the first
  const pad = async (b: number) => { await D.p.evaluate((i) => { (window as any).__pad.buttons[i].pressed = true; }, b); await D.p.waitForTimeout(80); await D.p.evaluate((i) => { (window as any).__pad.buttons[i].pressed = false; }, b); await D.p.waitForTimeout(80); };
  await look(D.p, "arcade", "yuzu"); await tab(D.p, "Today"); await D.p.evaluate(() => window.dispatchEvent(new Event("gamepadconnected")));
  await pad(13); await pad(13); await pad(13);
  const pr2 = await ringPixels(D.p); ok("gamepad: the d-pad focus ring shows on a notched Arcade control", !!pr2 && pr2.diff >= pr2.per * 1.5, JSON.stringify(pr2));
  await D.p.keyboard.press("Tab"); await D.p.waitForTimeout(60);
  ok("…and a keyboard Tab afterwards leaves one ring, not two", (await D.p.locator(".pad-focus").count()) === 0);
  await D.p.evaluate(() => (document.activeElement as HTMLElement)?.blur()); await pad(12);
  const atEnd = await D.p.evaluate(() => !!document.querySelector(".pad-focus")); await pad(13);
  const first = await D.p.evaluate(() => { const all = [...document.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], summary, input:not([type=hidden]):not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); return document.activeElement === all[0]; });
  ok("…and the d-pad wraps from the last stop to the first", atEnd && first);
  // MCQ: the suggested rating is visible in Arcade (an outline used to be clipped away)
  await study(D.p, "Step 1"); await D.p.locator(".mcq-opt").nth(1).click(); await D.p.waitForTimeout(200);
  const sug = await D.p.evaluate(() => { const b = document.querySelector(".answer-bar button.suggest") as HTMLElement | null; return b ? getComputedStyle(b).boxShadow : "none"; });
  ok("Arcade: the suggested answer button carries an inner ring", /0px 0px 0px 3px inset/.test(sug), sug); await leave(D.p);
  // 08-16: keyboard chips stay one box
  await D.p.keyboard.press("?"); await D.p.waitForTimeout(200);
  ok("keyboard chips are inline blocks (one box when a combo wraps)", await D.p.evaluate(() => [...document.querySelectorAll("kbd")].every((k) => getComputedStyle(k).display === "inline-block")));
  await D.ctx.close();

  // ---- Phone: contrast in every interface × theme, tap targets, spine, shadows, link-buttons
  const P = await open(412, 915, true); const p = P.p;
  for (const ui of ["arcade", "clean", "paper"]) for (const th of ["yuzu", "orange", "gameboy", "night"]) {
    await look(p, ui, th); const low: string[] = []; console.log("  …", ui, th);
    for (const t of ["Today", "Library", "Progress", "Settings"]) { await tab(p, t); if (t === "Settings") await p.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); low.push(...(await p.evaluate(LOW) as string[]).map((x) => t + ": " + x)); }
    for (const dark of [false, true]) { await p.evaluate(async (d) => { await (window as any).yuzu.saveSettings({ nightCards: d }); }, dark); await study(p, "Step 1"); await p.locator(".mcq-opt").nth(1).click(); await p.waitForTimeout(150); low.push(...(await p.evaluate(LOW) as string[]).map((x) => (dark ? "dark " : "") + "mcq: " + x)); await leave(p); }
    await p.evaluate(async () => { await (window as any).yuzu.saveSettings({ nightCards: false }); });
    ok(`${ui} × ${th}: no text under WCAG AA contrast on Today, Library, Progress, Settings and a study card`, low.length === 0, low.slice(0, 6).join(" | "));
  }
  // the stamp on every system colour (light and dark card, every theme)
  const stampWorst: string[] = [];
  for (const ui of ["arcade", "paper"]) for (const th of ["yuzu", "gameboy", "night"]) for (const dark of [false, true]) {
    await look(p, ui, th); await p.evaluate(async (d) => { await (window as any).yuzu.saveSettings({ nightCards: d }); }, dark); await study(p, "Medicine");
    const sw = await p.evaluate(() => { const sys = ["#D65A3C", "#4FA3A3", "#8A6FD1", "#E8A83E", "#4D86C6", "#E0B93A", "#B23A48", "#6FA34A", "#A9794B", "#E07C9A", "#9C8AD6", "#D96C8F", "#3F9C8C", "#8C9A3A", "#FF7A1A", "#3FA7C9", "#8C8373"];
      const stage = document.querySelector(".paper-stage") as HTMLElement; const st = document.querySelector(".stamp") as HTMLElement; const paper = document.querySelector(".paper") as HTMLElement; let worst = 99;
      const parse = (x: string) => { const m = x.match(/rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/)!; return m[1] ? m[1].split(/[ ,/]+/).filter(Boolean).map(Number) : m[2].split(/[ /]+/).filter(Boolean).map((v, i) => (i < 3 ? Number(v) * 255 : Number(v))); };
      const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      for (const c of sys) { stage.style.setProperty("--spine", c); const fg = parse(getComputedStyle(st).color); const pb = parse(getComputedStyle(paper).backgroundColor); const t = parse(getComputedStyle(st).backgroundColor); const a = t[3] ?? 1;
        const bg = [0, 1, 2].map((i) => t[i] * a + pb[i] * (1 - a)); const x = lum(fg), y = lum(bg); worst = Math.min(worst, (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)); }
      return Math.round(worst * 100) / 100; });
    if (sw < 4.5) stampWorst.push(`${ui}/${th}/${dark ? "dark" : "light"} ${sw}`); await leave(p);
  }
  ok("the card's state stamp reads at ≥4.5:1 on every system colour, theme and card colour", stampWorst.length === 0, stampWorst.join(" | "));
  await p.evaluate(async () => { await (window as any).yuzu.saveSettings({ nightCards: false }); });
  // Paper specifics: field borders ≥3:1 (WCAG 1.4.11), focus ring dark, headings one colour
  await look(p, "paper", "yuzu"); await tab(p, "Library");
  const fb = await ratioOf(p, ".field input", "borderTopColor"); ok("Paper: text-field borders are ≥3:1 against the page", fb >= 3, String(fb));
  await tab(p, "Settings"); const hc = await p.evaluate(() => [getComputedStyle(document.querySelector("details.section > summary")!).color, getComputedStyle(document.querySelector("h2") ?? document.querySelector("details.section > summary")!).color]);
  await tab(p, "Progress"); const h2 = await p.evaluate(() => getComputedStyle(document.querySelector("h2")!).color);
  ok("Paper: Settings section titles use the same colour as headings elsewhere", hc[0] === h2, `${hc[0]} vs ${h2}`);
  // 08-7: the flat interfaces get the soft 5-px spine, not the striped pixel one
  for (const ui of ["clean", "paper"]) { await look(p, ui, "yuzu"); await tab(p, "Today");
    const sp = await p.evaluate(() => { const cs = getComputedStyle(document.querySelector(".stack")!, "::before"); return { w: cs.width, img: cs.backgroundImage }; });
    ok(`${ui}: Today's stacks have the plain 5-px spine (no pixel stripes)`, sp.w === "5px" && sp.img === "none", JSON.stringify(sp)); }
  // 08-9 / 01-17 / 05-13 / 03-17: touch targets
  for (const ui of ["arcade", "paper"]) { await look(p, ui, "yuzu"); const small: string[] = [];
    for (const t of ["Today", "Library", "Settings"]) { await tab(p, t); if (t === "Settings") await p.evaluate(() => document.querySelectorAll("details.section").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
      small.push(...await p.evaluate(() => [...document.querySelectorAll<HTMLElement>(".seg button, button.chip, .crumbs button, .coach-x, details.section > summary, label.row:has(> input[type=checkbox])")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && r.height < 44; }).map((e) => (e.textContent ?? "").trim().slice(0, 14) + " " + Math.round(e.getBoundingClientRect().height)))); }
    await tab(p, "Today"); await p.click('[aria-label="Quick add a card"]'); await p.waitForTimeout(200);
    small.push(...await p.evaluate(() => [...document.querySelectorAll<HTMLElement>(".sheet .seg button, .sheet button.chip")].filter((e) => e.getBoundingClientRect().height < 44).map((e) => "sheet " + (e.textContent ?? "").trim().slice(0, 14))));
    await p.keyboard.press("Escape");
    ok(`${ui}: segmented controls, chips, crumbs, section titles and checkbox rows are ≥44 px tall on a phone`, small.length === 0, [...new Set(small)].slice(0, 8).join(" | "));
  }
  // 08-17 / 08-18: link-buttons look like buttons; the flat interfaces have no hard black offset shadows
  await p.evaluate(async () => { const y = (window as any).yuzu; for (const c of [...y.cards.values()]) await y.answer(c.id, 3, 4000); }); // the Claude practice fold needs some reviews
  await look(p, "paper", "yuzu"); await tab(p, "Today"); await p.evaluate(() => (window as any).yuzu.openOnToday("practice")); await p.waitForSelector("a.btn", { timeout: 5000 }).catch(async () => { await p.screenshot({ path: "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad/wp10/nopractice.png" }); console.log("  (practice sheet did not open)"); });
  const lb = await p.evaluate(() => { const a = document.querySelector("a.btn") as HTMLElement | null; if (!a) return null; const cs = getComputedStyle(a); return { deco: cs.textDecorationLine, color: cs.color, text: getComputedStyle(document.body).color }; });
  ok("“Open Claude” is a plain button (no underline, button text colour)", !!lb && lb.deco === "none" && lb.color === lb.text, JSON.stringify(lb));
  await p.keyboard.press("Escape"); await p.waitForTimeout(150);
  for (const ui of ["clean", "paper"]) { await look(p, ui, "yuzu"); await tab(p, "Progress"); await p.locator("button", { hasText: /^Recap$/ }).first().click(); await p.waitForTimeout(300);
    const sh = await p.evaluate(() => getComputedStyle(document.querySelector(".recap-card")!).boxShadow);
    ok(`${ui}: recap cards have a soft shadow, not the 4-px black 8-bit offset`, !/rgb\(0, 0, 0\) 4px 4px 0px/.test(sh) && /px \d+px/.test(sh), sh); await p.keyboard.press("Escape"); await p.waitForTimeout(150); }
  // 08-15: no 10-px pixel-font running labels in Arcade
  await look(p, "arcade", "yuzu"); const tiny: string[] = [];
  for (const t of ["Today", "Library", "Progress", "Settings"]) { await tab(p, t); tiny.push(...await p.evaluate(() => [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => e instanceof HTMLElement && !e.closest("svg") && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && e.getBoundingClientRect().width > 0 && /Yuzu Pixel/.test(getComputedStyle(e).fontFamily.split(",")[0]) && parseFloat(getComputedStyle(e).fontSize) < 20).map((e) => e.tagName + "." + String(e.className).split(" ")[0] + " '" + e.textContent!.trim().slice(0, 12) + "'"))); }
  ok("Arcade: the pixel face is only used at 20 px and up (labels under that use the sans)", tiny.length === 0, [...new Set(tiny)].slice(0, 8).join(" | "));
  await P.ctx.close();
} catch (e: any) { fails.push("crash: " + e.message.slice(0, 300)); console.log(e); }
finally {
  await browser.close(); server.kill();
  if (errors.length) { console.log("page errors:", errors.slice(0, 5)); fails.push("page errors"); }
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nall wp10 checks passed"); process.exit(fails.length ? 1 : 0);
}
