// WP11 — layout on small phones, large text and tablets: no sideways overflow or clipped content on any tab, and the tab bar
// always fixed and visible at the bottom, at 360×780 and 412×915 (Small / Normal / Large text), 820×1180 and 1180×820, in Arcade / Clean / Paper.
import { chromium, type Page, type BrowserContext } from "playwright"; import { spawn } from "node:child_process";
const port = 5110 + Number(process.env.PORT_OFFSET ?? 0); /* PORT_OFFSET lets several copies run at once */ const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`; const SHOTS = process.env.WP11_SHOTS; /* a folder to save screenshots in, when looking */
const words = ["myocardial infarction heart", "renal kidney glomerulus", "neuron brain stroke", "lung pneumonia asthma", "liver hepatitis bowel", "bone fracture muscle", "thyroid insulin diabetes", "anemia leukemia platelet"];
const pack = { yuzu_pack: 1, id: "wp11", category: "Medicine::Step 1::Pathology::Cardiovascular", cards: Array.from({ length: 160 }, (_, i) => ({ id: "c" + i, front: `Question ${i} about ${words[i % words.length]}`, back: `answer ${i}`, tags: ["cardio", "step1"] })) };
const pack2 = { yuzu_pack: 1, id: "wp11b", category: "German::Klinik::Wortschatz", cards: Array.from({ length: 30 }, (_, i) => ({ id: "g" + i, front: `das Wort ${i}`, back: `the word ${i}` })) };
async function seed(p: Page) {
  await p.evaluate(async ([a, b]) => { const y = (window as any).yuzu; await y.importPack(a); await y.importPack(b);
    const cards = [...y.cards.values()]; const now = Date.now(); const upd: any[] = [];
    cards.forEach((c: any, i: number) => { if (i % 3 === 0) return; const n = { ...c, state: "review", step: 0, stability: i % 2 ? 500 : 30, difficulty: 5, reps: 6, due: now + (i % 5 === 0 ? -1 : 1) * 86400000 * (1 + (i % 7)), lastReview: now - 86400000 * 3 }; y.cards.set(c.id, n); upd.push(n); });
    await y._db.putMany("cards", upd);
    const sys = ["Cardiovascular", "Musculoskeletal & Trauma", "Toxicology & Environmental", "Hematology & Oncology", "Obstetrics & Gynecology"]; const notes: any[] = [];
    [...y.notes.values()].forEach((n: any, i: number) => { const m = { ...n, tags: [...n.tags, "auto::System::" + sys[i % sys.length]] }; y.notes.set(n.id, m); notes.push(m); }); await y._db.putMany("notes", notes);
    for (const c of cards.slice(0, 40)) await y.answer(c.id, 1 + (c.id.length % 4), 4000);
    await y.saveSettings({ sync: { ...y.settings.sync, owner: "someone", repo: "yuzu-data", token: "ghp_x", auto: false }, bosses: Object.fromEntries(sys.map((k) => ["systems:" + k, { at: now, score: 90, best: 90, passed: true }])) });
  }, [pack, pack2]);
}
async function scan(p: Page) {
  return p.evaluate(() => {
    const vw = document.documentElement.clientWidth, vh = innerHeight; const wide: string[] = [];
    const scroller = (el: Element) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if (ox === "auto" || ox === "scroll") return true; } return false; };
    for (const el of document.querySelectorAll<HTMLElement>(".screen *, nav.tabs *, .bulk-bar *")) {
      const b = el.getBoundingClientRect(); if (!b.width || !b.height || el.closest("[hidden], .kit-sheet, .sheet, svg")) continue;
      if ((b.right > vw + 1 || b.left < -1) && !scroller(el) && getComputedStyle(el).visibility !== "hidden") wide.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} '${(el.textContent ?? "").trim().slice(0, 24)}' ${Math.round(b.right - vw)}px`);
      if (wide.length > 6) break;
    }
    const nav = document.querySelector("nav.tabs") as HTMLElement | null; const n = nav?.getBoundingClientRect();
    const rail = !!n && n.width < 200 && n.height > vh * 0.8;
    const navOk = !!n && getComputedStyle(nav!).position === "fixed" && (rail ? n.left >= 0 && n.top <= 1 : Math.abs(n.bottom - vh) <= 1 && n.left >= -1 && n.right <= vw + 1);
    return { wide, navOk, nav: n ? `${Math.round(n.left)},${Math.round(n.top)} ${Math.round(n.width)}×${Math.round(n.height)}` : "none", innerW: innerWidth, docW: document.documentElement.scrollWidth, vw };
  });
}
const TABS = ["Today", "Library", "Progress", "Settings"];
async function context(w: number, h: number, ui: string, size: string): Promise<{ ctx: BrowserContext; p: Page }> {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 1000, hasTouch: w < 1000, deviceScaleFactor: 1 });
  await ctx.addInitScript("window.__name = (f) => f"); /* tsx names inner arrow functions */
  await ctx.addInitScript(`try { localStorage.setItem("yuzu-ui", ${JSON.stringify(ui)}); localStorage.setItem("yuzu-size", ${JSON.stringify(size)}); sessionStorage.setItem("yuzu-from", "citrus"); } catch {}`);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${w} ${ui} ${size}: ${e.message}`));
  await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 }); return { ctx, p };
}
async function openAll(p: Page) { await p.evaluate(() => document.querySelectorAll(".screen details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await p.waitForTimeout(150); }
try {
  // ---- The specific findings, at 360 px (the S25 Ultra's default width), Normal and Large text
  for (const [ui, size] of [["arcade", "normal"], ["arcade", "large"], ["clean", "large"]]) {
    const { ctx, p } = await context(360, 780, ui, size); await seed(p); const tag = `360 ${ui} ${size}`;
    await p.evaluate(() => (document.querySelector("nav.tabs .tab") as HTMLElement).click()); await p.waitForTimeout(200);
    const head = await p.evaluate(() => { const r = (s: string) => document.querySelector(s)?.getBoundingClientRect(); const vw = document.documentElement.clientWidth;
      const cap = r('.brand [aria-label="Capture"]'), logo = r(".brand .yuzu-mark"), study = [...document.querySelectorAll<HTMLElement>(".hero .btn")].find((b) => /Study/.test(b.textContent ?? ""))?.getBoundingClientRect();
      return { vw, cap: cap && Math.round(cap.right), logo: logo && Math.round(logo.width), study: study && [Math.round(study.left), Math.round(study.right)], citrus: !!document.querySelector(".brand .back-citrus"), sync: !!document.querySelector(".brand span.chip") }; });
    ok(`${tag} 01-2: with ← Citrus and the sync chip, ＋ Capture is on screen and the logo keeps its size`, head.citrus && head.sync && !!head.cap && head.cap <= head.vw && (head.logo ?? 0) >= 32, JSON.stringify(head));
    ok(`${tag} 08-6: the Study button on the hero is wholly on screen`, !!head.study && head.study[0] >= 0 && head.study[1] <= head.vw, JSON.stringify(head.study));
    // Progress: system names are not cut, Boss is a full tap target
    await p.evaluate(() => ([...document.querySelectorAll<HTMLElement>("nav.tabs .tab")].find((b) => /Progress/.test(b.textContent ?? "")))?.click()); await p.waitForTimeout(300);
    const sys = await p.evaluate(() => ({ names: [...document.querySelectorAll<HTMLElement>(".sys-head .t")].map((t) => ({ n: t.textContent, cut: t.scrollWidth > t.clientWidth + 1 })), boss: [...document.querySelectorAll<HTMLElement>(".sys-head .boss-chip")].map((b) => Math.round(b.getBoundingClientRect().height)) }));
    if (SHOTS) await p.locator(".sys-head").first().scrollIntoViewIfNeeded().then(() => p.screenshot({ path: `${SHOTS}/f-${tag}-progress.png` })).catch(() => {});
    ok(`${tag} 04-11: system names on Progress are shown whole`, sys.names.length >= 4 && sys.names.every((x) => !x.cut), JSON.stringify(sys.names.filter((x) => x.cut)));
    ok(`${tag} 04-11: the Boss button is at least 44 px tall`, sys.boss.length > 0 && sys.boss.every((h) => h >= 44), JSON.stringify(sys.boss));
    // Library: zero-count filters hidden, Show cards scrolls the list into view, bulk bar one row of 44-px buttons + More…
    await p.evaluate(() => ([...document.querySelectorAll<HTMLElement>("nav.tabs .tab")].find((b) => /Library/.test(b.textContent ?? "")))?.click()); await p.waitForTimeout(300);
    ok(`${tag} 03-15: filter chips with nothing in them are hidden`, await p.evaluate(() => ![...document.querySelectorAll(".screen button.chip")].some((b) => /· 0$/.test((b.textContent ?? "").trim()))));
    ok(`${tag} 03-15: at the root the All crumb doesn't repeat the title`, (await p.locator(".crumbs").count()) === 0);
    await p.locator("button:has-text('Show cards in')").click();
    await p.waitForFunction(() => { const e = document.getElementById("lib-cards"); return !!e && e.getBoundingClientRect().top < innerHeight / 2; }, null, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(400); /* the smooth scroll settles */
    const lc = await p.evaluate(() => { const r = document.getElementById("lib-cards")!.getBoundingClientRect(); const h = document.querySelector("#lib-cards h2") as HTMLElement; return { top: Math.round(r.top), vh: innerHeight, lines: Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)) }; });
    ok(`${tag} 03-15: Show cards brings the card list into view, its header on one line`, lc.top >= 0 && lc.top < lc.vh / 2 && lc.lines === 1, JSON.stringify(lc));
    await p.locator("#lib-cards button.chip:has-text('Select')").click(); await p.locator("#lib-cards button.chip:has-text('All ')").click(); await p.waitForTimeout(200);
    const bar = await p.evaluate(() => { const b = document.querySelector(".bulk-bar") as HTMLElement; const btns = [...b.querySelectorAll<HTMLElement>(".btn")]; const tops = new Set(btns.map((x) => Math.round(x.getBoundingClientRect().top)));
      return { labels: btns.map((x) => x.textContent), rows: tops.size, minH: Math.min(...btns.map((x) => x.getBoundingClientRect().height)), h: Math.round(b.getBoundingClientRect().height), count: b.querySelector(".small")?.textContent }; });
    ok(`${tag} 03-12: the bulk bar is one row of Study · Pause · Flag · Tag · More…, each at least 44 px`, bar.labels.join() === "Study,Pause,Flag,Tag,More…" && bar.rows === 1 && bar.minH >= 44 && bar.h <= 110 && bar.count === "190 selected", JSON.stringify(bar));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/f-${tag}-bulk.png` });
    await p.locator(".bulk-bar >> text=More…").click(); await p.waitForTimeout(200);
    const more = await p.locator(".kit-sheet .kit-item").allInnerTexts();
    ok(`${tag} 03-12: More… holds the rest (Unpause, Unflag, Move, System, Specialty, Needs improving, Delete)`, ["Unpause", "Unflag", "Move to a category…", "Set system…", "Set specialty…", "Needs improving…", "Delete…"].every((l) => more.some((m) => m.trim() === l)), JSON.stringify(more));
    await p.locator(".kit-sheet >> text=Unflag").click(); await p.waitForTimeout(200);
    ok(`${tag} …a More… action runs and the sheet closes`, (await p.locator(".kit-sheet").count()) === 0);
    // Settings: the order select fits its field; Break dates are two labelled rows
    await p.evaluate(() => ([...document.querySelectorAll<HTMLElement>("nav.tabs .tab")].find((b) => /Settings/.test(b.textContent ?? "")))?.click()); await p.waitForTimeout(300); await openAll(p);
    const st = await p.evaluate(() => { const sel = [...document.querySelectorAll<HTMLSelectElement>(".field select")].find((x) => x.querySelector('option[value="forgotten"]'))!; const o = sel.options[sel.selectedIndex].text;
      const bd = document.querySelector(".break-dates")!; const labels = [...bd.querySelectorAll(":scope > span.small")].map((x) => ({ t: x.textContent, top: Math.round(x.getBoundingClientRect().top) }));
      return { o, fits: sel.scrollWidth <= sel.clientWidth + 1, labels }; });
    if (SHOTS) await p.locator(".break-dates").scrollIntoViewIfNeeded().then(() => p.screenshot({ path: `${SHOTS}/f-${tag}-break.png` })).catch(() => {});
    ok(`${tag} 05-19: the due-order choice is short and fits`, st.o === "Most forgotten first" && st.fits, JSON.stringify(st));
    ok(`${tag} 05-19: Break from / Break to are on their own rows`, st.labels.length === 2 && st.labels[1].t === "Break to" && st.labels[1].top > st.labels[0].top, JSON.stringify(st.labels));
    await ctx.close();
  }
  {
    const { ctx, p } = await context(412, 915, "arcade", "normal");
    const misc = await p.evaluate(async () => { await document.fonts.load('20px "Yuzu Pixel"'); const c = document.createElement("canvas").getContext("2d")!; c.font = '20px "Yuzu Pixel"';
      const bd = document.createElement("div"); bd.className = "sheet-backdrop"; const sn = document.createElement("div"); sn.className = "kit-snack"; document.body.append(bd, sn);
      const top = sn.getBoundingClientRect().top; bd.remove(); const bottom = sn.getBoundingClientRect().top; sn.remove();
      return { one: c.measureText("1").width, three: c.measureText("3").width, snackTopWithSheet: Math.round(top), snackTopWithout: Math.round(bottom) }; });
    ok("01-19: in the pixel font the 1 is narrower than other digits (no '1 37' gap)", misc.one < misc.three, JSON.stringify(misc));
    ok("01-19: with a sheet open the snackbar sits at the top, clear of the sheet", misc.snackTopWithSheet < 100 && misc.snackTopWithout > 600, JSON.stringify(misc));
    await ctx.close();
  }
  // One seeded profile reused for every size (same origin, so a fresh context needs seeding once per context)
  const sizes: [number, number][] = process.env.WP11_FINDINGS ? [] : process.env.WP11_QUICK ? [[360, 780], [412, 915]] : [[360, 780], [412, 915], [820, 1180], [1180, 820]];
  for (const [w, h] of sizes) for (const ui of ["arcade", "clean", "paper"]) for (const size of w <= 412 ? ["small", "normal", "large"] : ["normal", "large"]) {
    const { ctx, p } = await context(w, h, ui, size); await seed(p); let passed = 0;
    for (const t of TABS) {
      await p.evaluate((t) => ([...document.querySelectorAll<HTMLElement>("nav.tabs .tab")].find((b) => b.textContent?.includes(t)))?.click(), t); /* a real tap is checked by navOk; a covered bar must not stall the run */ await p.waitForTimeout(200);
      if (t === "Settings") { await p.locator("details.section:has-text('Sync')").first().evaluate((d: any) => { d.open = true; }).catch(() => {}); await openAll(p); }
      if (t === "Progress") await openAll(p);
      for (const y of [0, 0.5, 1]) {
        await p.evaluate((f) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), y); await p.waitForTimeout(60);
        if (SHOTS && y === 0) await p.screenshot({ path: `${SHOTS}/${w}-${ui}-${size}-${t.toLowerCase()}.png` });
        const r = await scan(p); const where = `${w}×${h} ${ui} ${size} ${t} @${y}`;
        if (r.wide.length || r.innerW !== w || r.docW > r.vw) ok(`${where}: nothing runs off the screen`, false, `innerWidth ${r.innerW}, scrollWidth ${r.docW}; ${r.wide.join(" | ")}`);
        if (!r.navOk) ok(`${where}: the tab bar is fixed and visible`, false, r.nav);
        if (!r.wide.length && r.navOk && r.innerW === w && r.docW <= r.vw) passed++;
      }
    }
    await ctx.close(); ok(`${w}×${h} ${ui} ${size}: every tab fits the screen, with the tab bar fixed at the bottom`, passed === TABS.length * 3, `${passed}/${TABS.length * 3} views`);
  }
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails.length); process.exitCode = 1; }
  await browser.close(); server.kill();
}
