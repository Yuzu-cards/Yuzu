// WP08 — how cards look and behave in study: typed answers on vocab, hands-free voices, the state stamp, MCQ layout
// and colours, pictures, card info, toasts on the done screen, the plan screen, key hints on a desktop, Hard ≠ Again.
// Also screenshots every card type in Arcade / Clean / Paper with light and dark cards (test/e2e/shots/wp08-*).
import { chromium, type Page, type BrowserContext } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const port = 5080; /* this package's own port range (5080–5089) */ const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const shots = "test/e2e/shots"; fs.mkdirSync(shots, { recursive: true }); const SHOTS = process.env.WP08_SHOTS !== "0";
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`;
const SPEECH = `window.__said = []; Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speaking: false, pending: false, speak(u) { window.__said.push(u.lang + "|" + u.text); this.speaking = true; setTimeout(() => { this.speaking = false; u.onend && u.onend(); }, 30); }, cancel() { this.speaking = false; }, getVoices() { return [{ lang: "de-DE", name: "Anna" }, { lang: "en-US", name: "Sam" }]; } } }); window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  window.SpeechRecognition = function () { this.start = () => { setTimeout(() => this.onresult && this.onresult({ resultIndex: 0, results: [[{ transcript: "good" }]] }), 40); }; this.abort = () => {}; };`;
const png = "iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAIAAABM5OhcAAAA0klEQVR4nO3SQQ0AIBDAMMC/5+OPAvZoFSzZnplZ8NoXB/BzLBLGImEsEsYiYSwSxiJhLBLGImEsEsYiYSwSxiJhLBLGImEsEsYiYSwSxiJhLBLGImEsEsYiYSwSxiJhLBLGImEsEsYiYSwSxiJhLBLGImEsEsYiYSwSxiJhLBLGImEsEsYiYSwSxiJhLBLGImEsEsYiYSwSxiJhLBLGImEsEsYiYSwSxiJhLBLGImEsEsYiYSwSxiJhLBLGImEsEsYiYSwSxiJhLBLGImEsEsYiYSwS5gIKtAGHppq5UwAAAABJRU5ErkJggg==";
const pack = { yuzu_pack: 1, id: "wp08", category: "Medicine::WP08", cards: [
  { id: "cz", type: "cloze", text: "Drug of choice for SVT after vagal manoeuvres fail: {{c1::adenosine 6 mg rapid IV push}}", extra: "Then 12 mg, then 12 mg." },
  { id: "bs", type: "basic", front: "Beck's triad (cardiac tamponade): hypotension, raised JVP and what heart sounds?", back: "Muffled heart sounds", image: "data:image/png;base64," + png },
  { id: "mq", type: "mcq", question: "A 24-year-old has wheeze, stridor, urticaria and BP 80/40 after a bee sting. First drug?", options: [{ text: "Adrenaline 0.5 mg IM", correct: true, why: "Anterolateral thigh; repeat after 5 min." }, { text: "Hydrocortisone 200 mg IV", why: "Second line; it takes hours to work." }, { text: "Chlorphenamine 10 mg IV" }], explanation: "Remember: IM adrenaline first, before anything else." },
  { id: "io", type: "occlusion", front: "Label the box", image: "data:image/png;base64," + png, masks: [{ x: 10, y: 15, w: 27, h: 25, label: "left box" }] },
] };
const german = { yuzu_pack: 1, id: "wp08de", category: "Languages::German::Klinik", cards: [
  { id: "niere", type: "vocab", word: "Niere", article: "die", meaning: "kidney", plural: "die Nieren", example: "Die Niere filtert das Blut." },
  { id: "schmerz", type: "vocab", word: "Schmerzmittel", article: "das", meaning: "painkiller; analgesic" },
] };
async function open(ctx: BrowserContext, label: string): Promise<Page> {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(label + ": " + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon|save failed/.test(m.text())) errors.push(label + " console: " + m.text()); });
  await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 30000 }); return p;
}
/** Open study on exactly these cards (a saved session, as after a reload). */
async function study(p: Page, ids: string[]) {
  await p.evaluate((ids) => localStorage.setItem("yuzu-session", JSON.stringify({ scope: { path: "" }, ids, idx: 0, plan: ids.length, done: 0, results: [], startedAt: Date.now(), savedAt: Date.now() })), ids);
  await p.reload(); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 30000 }); await p.waitForSelector(".study .card-host", { timeout: 15000 }); await p.waitForTimeout(250);
}
const cid = (p: Page, noteText: RegExp | string, ord = 0) => p.evaluate(([t, ord]) => { const y = (window as any).yuzu; const n = [...y.notes.values()].find((n: any) => new RegExp(t as string).test(n.fields.join(" "))); return y.cardsOfNote(n.id).find((c: any) => c.ord === ord)?.id; }, [typeof noteText === "string" ? noteText : noteText.source, ord] as const);
try {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(SPEECH);
  const P = await open(ctx, "P"); await P.evaluate(async ([a, b]) => { const y = (window as any).yuzu; await y.importPack(a); await y.importPack(b); await y.saveSettings({ typeAnswers: true, autoplay: true }); }, [pack, german]);
  const ids = { cz: await cid(P, "SVT"), bs: await cid(P, "Beck"), mq: await cid(P, "bee sting"), io: await cid(P, "Label the box"), v0: await cid(P, "Niere", 0), v1: await cid(P, "Schmerzmittel", 1), s0: await cid(P, "Schmerzmittel", 0) };

  // ---- 02-3 typed answers
  await study(P, [ids.v0!]); await P.fill("input.typeans", "kidney"); await P.keyboard.press("Enter"); await P.waitForSelector(".typed-res");
  const t1 = await P.locator(".typed-res").innerText(); ok("typed 'kidney' for die Niere is right (plural/example don't count)", /^✓ kidney/.test(t1), t1);
  await study(P, [ids.s0!]); await P.fill("input.typeans", "painkiller"); await P.keyboard.press("Enter"); await P.waitForSelector(".typed-res");
  ok("…'painkiller' is right for 'painkiller; analgesic'", /^✓/.test(await P.locator(".typed-res").innerText()));
  await study(P, [ids.v1!]); await P.fill("input.typeans", "das Schmerzmittel"); await P.keyboard.press("Enter"); await P.waitForSelector(".typed-res");
  const t3 = await P.locator(".typed-res").innerText(); ok("…meaning → word: 'das Schmerzmittel' is right, no [tts:…] shown", /^✓/.test(t3) && !/tts/.test(t3), t3);
  await study(P, [ids.v1!]); await P.fill("input.typeans", "der Schmerzmittel"); await P.keyboard.press("Enter"); await P.waitForSelector(".typed-res");
  const t4 = await P.locator(".typed-res").innerText(); ok("…a wrong article is a near miss that says so", /^≈/.test(t4) && /article/.test(t4), t4.replace(/\n/g, " "));

  // ---- 02-9 hands-free: German in German, once; the meaning in English
  await P.evaluate(() => (window as any).yuzu.saveSettings({ typeAnswers: false }));
  await study(P, [ids.v0!]); // the reload clears the record of what was said
  await P.click('button[aria-label="More"]'); await P.click("text=Hands-free (read aloud, answer by voice)");
  await P.waitForFunction(() => (window as any).yuzu.reviews.some((r: any) => r.rating === 3), null, { timeout: 20000 }).catch(() => {});
  const said = await P.evaluate(() => (window as any).__said as string[]);
  ok("hands-free: the German word is said once, in German (autoplay), never with the English voice", said.filter((s) => /Niere/.test(s)).length === 1 && said.some((s) => s === "de-DE|die Niere") && !said.some((s) => s.startsWith("en-US") && /Niere/.test(s)), JSON.stringify(said));
  ok("…and the meaning in English", said.some((s) => s === "en-US|kidney"), JSON.stringify(said));
  await P.evaluate(() => (window as any).yuzu.saveSettings({ autoplay: false }));
  await study(P, [ids.v0!]); // the reload clears the record of what was said
  await P.click('button[aria-label="More"]'); await P.click("text=Hands-free (read aloud, answer by voice)"); await P.waitForTimeout(1500);
  const said2 = await P.evaluate(() => (window as any).__said as string[]);
  ok("…with autoplay off, hands-free says the word itself in German", said2[0] === "de-DE|die Niere", JSON.stringify(said2));
  await P.evaluate(() => (window as any).yuzu.saveSettings({ autoplay: true }));

  // ---- 02-10 / 08-5 the stamp never covers card text, in every interface
  for (const ui of ["arcade", "clean", "paper"]) {
    await P.evaluate((ui) => localStorage.setItem("yuzu-ui", ui), ui); await study(P, [ids.cz!]); await P.click(".study-body"); await P.waitForSelector(".answer-bar");
    const hit = await P.evaluate(() => { const s = document.querySelector(".study .stamp")!.getBoundingClientRect(); const root = (document.querySelector(".study .card-host") as any).shadowRoot as ShadowRoot; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const bad: string[] = []; let n: Node | null;
      while ((n = w.nextNode())) { const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.right > s.left && b.left < s.right && b.bottom > s.top && b.top < s.bottom) bad.push((n.textContent ?? "").slice(0, 20)); } return bad; });
    ok(`${ui}: the state stamp overlaps no card text`, hit.length === 0, JSON.stringify(hit));
  }
  await P.evaluate(() => localStorage.setItem("yuzu-ui", "arcade"));

  // ---- 02-13 / 08-20 / 02-8 / 08-4 MCQ back
  for (const ui of ["arcade", "paper"]) for (const dark of [false, true]) {
    await P.evaluate(([ui, dark]) => { localStorage.setItem("yuzu-ui", ui as string); return (window as any).yuzu.saveSettings({ nightCards: dark }); }, [ui, dark] as const); await study(P, [ids.mq!]);
    const texts = await P.locator(".mcq-opt span:nth-child(2)").allInnerTexts(); await P.locator(".mcq-opt").nth(texts.findIndex((t) => /Hydrocortisone/.test(t))).click(); await P.waitForSelector(".answer-bar");
    const m = await P.evaluate(() => { const mcq = document.querySelector(".study .mcq")!.getBoundingClientRect(); const hosts = [...document.querySelectorAll(".study .card-host")]; const tail = hosts[1]?.getBoundingClientRect(); const card = ((hosts[0] as any).shadowRoot.querySelector(".card") as HTMLElement).getBoundingClientRect();
      const [right, wrong, idle] = [".mcq-opt.right", ".mcq-opt.wrong", ".mcq-opt.idle"].map((q) => getComputedStyle(document.querySelector(q)!).backgroundColor); const [sugg, plain] = [".answer-bar .again.suggest", ".answer-bar .hard"].map((q) => getComputedStyle(document.querySelector(q)!).boxShadow);
      return { tailBelow: !!tail && tail.top >= mcq.bottom - 1, tailText: (hosts[1] as any)?.shadowRoot?.textContent ?? "", mainHasExpl: /Remember/.test((hosts[0] as any).shadowRoot.textContent), widthDiff: Math.round(Math.abs(mcq.width - card.width)), right, wrong, idle, sugg, plain }; });
    const tag = `${ui}${dark ? " dark" : ""}`;
    ok(`${tag}: MCQ explanation comes after the options (not above them)`, m.tailBelow && /Remember/.test(m.tailText) && !m.mainHasExpl, JSON.stringify(m));
    ok(`${tag}: options are as wide as the question`, m.widthDiff <= 4, String(m.widthDiff));
    ok(`${tag}: right and wrong options keep their colours`, m.right !== m.idle && m.wrong !== m.idle && m.right !== m.wrong, `${m.right} / ${m.wrong} / ${m.idle}`);
    ok(`${tag}: the suggested grade is visibly marked`, /inset/.test(m.sugg) && m.sugg !== m.plain, m.sugg);
  }
  await P.evaluate(() => { localStorage.setItem("yuzu-ui", "arcade"); return (window as any).yuzu.saveSettings({ nightCards: false }); });

  // ---- 02-16 pictures stay inside the paper (occlusion too)
  for (const id of [ids.bs!, ids.io!]) {
    await study(P, [id]); await P.waitForTimeout(300);
    const o = await P.evaluate(() => { const root = (document.querySelector(".study .card-host") as any).shadowRoot; const img = root.querySelector("img").getBoundingClientRect(); const box = (root.querySelector(".io") ?? root.querySelector(".card")).getBoundingClientRect(); return { over: Math.round(img.right - box.right), iw: Math.round(img.width), bw: Math.round(box.width) }; });
    ok(`picture fits its box (${id === ids.io ? "occlusion" : "basic"})`, o.over <= 0, JSON.stringify(o));
  }

  // ---- 02-14 Hard ≠ Again on a new card
  await study(P, [ids.cz!]); await P.click(".study-body"); await P.waitForSelector(".answer-bar");
  const iv = await P.locator(".answer-bar button small").allInnerTexts(); ok("a new card's Hard interval is longer than Again's", iv[0] !== iv[1] && /^\d+m$/.test(iv[1]), iv.join(" · "));

  // ---- 08-11 card info: the state fits its tile
  for (const ui of ["arcade", "clean"]) {
    await P.evaluate(([ui, id]) => { localStorage.setItem("yuzu-ui", ui); const y = (window as any).yuzu; const c = y.cards.get(id); y.cards.set(id, { ...c, state: "relearning" }); }, [ui, ids.cz!] as const);
    await study(P, [ids.cz!]); await P.evaluate((id) => { const y = (window as any).yuzu; const c = y.cards.get(id); y.cards.set(id, { ...c, state: "relearning" }); }, ids.cz!); await P.keyboard.press("i"); await P.waitForSelector(".sheet .stat-state");
    const f = await P.evaluate(() => { const b = document.querySelector(".sheet .stat-state b") as HTMLElement; const t = b.parentElement!.getBoundingClientRect(); const r = document.createRange(); r.selectNodeContents(b); const x = r.getBoundingClientRect(); return { text: b.innerText, over: Math.round(x.right - t.right) }; });
    ok(`${ui}: card info "${f.text}" stays inside its tile`, f.over <= 0, JSON.stringify(f));
    if (SHOTS) await P.screenshot({ path: `${shots}/wp08-${ui}-cardinfo.png` });
  }
  await P.evaluate(() => localStorage.setItem("yuzu-ui", "arcade"));
  await ctx.close();

  // ---- 02-11 a leech on the last card: the done screen says it
  const c2 = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }); const L = await open(c2, "L");
  await L.evaluate((p) => (window as any).yuzu.importPack(p), pack); const lid = await cid(L, "SVT");
  await L.evaluate(async (id) => { const y = (window as any).yuzu; await y.saveSettings({ leechThreshold: 3, leechAction: "claude" }); const c = y.cards.get(id); y.cards.set(id, { ...c, state: "review", lapses: 2, reps: 9, stability: 5, difficulty: 7, due: Date.now() - 1000, lastReview: Date.now() - 6 * 86400000 }); await y._db?.putCards?.([y.cards.get(id)]); }, lid);
  await study(L, [lid!]); await L.evaluate((id) => { const y = (window as any).yuzu; const c = y.cards.get(id); y.cards.set(id, { ...c, state: "review", lapses: 2, reps: 9, stability: 5, difficulty: 7, due: Date.now() - 1000, lastReview: Date.now() - 6 * 86400000 }); }, lid!);
  await L.click(".study-body"); await L.waitForSelector(".answer-bar"); await L.click(".answer-bar .again"); await L.waitForSelector(".done", { timeout: 5000 });
  const done = await L.locator(".study").innerText(); const toastSeen = await L.locator(".toast").count();
  ok("the leech toast shows on the done screen and the summary lists it", toastSeen === 1 && /1 card sent to Claude to rewrite \(forgotten 3 times\)/.test(done), done.replace(/\n/g, " | ").slice(0, 300));
  ok("…and the done screen says '1 card', not '1 cards'", /\b1\s*\n?\s*card in/.test(done), done.slice(0, 40).replace(/\n/g, " | "));
  if (SHOTS) await L.screenshot({ path: `${shots}/wp08-done-leech.png` });

  // ---- 02-12 the plan screen for a small queue: no contradictory choices
  await L.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ planScreen: true }); localStorage.removeItem("yuzu-session"); const cards = Array.from({ length: 54 }, (_, i) => ({ id: "p" + i, front: "Plan question " + i, back: "a" + i })); await y.importPack({ yuzu_pack: 1, id: "plan", category: "Medicine::Plan", cards });
    const now = Date.now(); for (let i = 0; i < 40; i++) y.reviews.push({ id: "r" + i, cid: "x", ts: now - i * 1000, rating: 3, state: "review", elapsedDays: 1, scheduledDays: 1, durationMs: 3000 }); });
  await L.reload(); await L.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 30000 }); await L.waitForTimeout(400);
  await L.evaluate(() => { (window as any).yuzu.saveSettings({ newPerDay: 100 }); }); await L.reload(); await L.waitForSelector(".hero >> text=Study", { timeout: 15000 }); await L.click(".hero >> text=Study");
  await L.waitForSelector("text=cards ready", { timeout: 10000 }); const plan = await L.locator(".study .done").innerText();
  const counts = [...plan.matchAll(/(\d+) cards/g)].map((m) => Number(m[1])); const total = Number(/^\s*(\d+)/.exec(plan)?.[1]);
  const btns = await L.locator(".study .done button").allInnerTexts();
  ok("plan screen: no minute button that already means the whole queue, no card count twice", !btns.some((b) => /minutes/.test(b) && new RegExp(`· ${total} cards`).test(b)) && new Set(btns.map((b) => b.replace(/\s+/g, " "))).size === btns.length, btns.join(" | "));
  ok("…and no 'Session length 25 min' for a 3-minute queue", !/Session length/.test(plan) || !/25 min/.test(plan), plan.replace(/\n/g, " | ").slice(0, 300) + " " + counts.join(","));
  if (SHOTS) await L.screenshot({ path: `${shots}/wp08-plan-small.png` });
  await c2.close();

  // ---- 07-14 / 02-17 desktop: key hints
  const c3 = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await c3.addInitScript(SPEECH); const D = await open(c3, "D");
  await D.evaluate(async ([a, b]) => { const y = (window as any).yuzu; await y.importPack(a); await y.importPack(b); }, [pack, german]); const dz = await cid(D, "SVT");
  await study(D, [dz!]); const front = await D.locator(".swipe-tip").innerText().catch(() => "");
  ok("desktop: the tip names the keys, not 'Tap or swipe'", /Space/.test(front) && !/Tap or swipe/.test(front), front);
  await D.keyboard.press("Space"); await D.waitForSelector(".answer-bar");
  const badges = await D.locator(".answer-bar .key-badge").evaluateAll((els) => els.map((e) => getComputedStyle(e).display !== "none" ? (e as HTMLElement).innerText.trim() : ""));
  ok("…each rating button shows its key 1–4", badges.join(",") === "1,2,3,4", badges.join(","));
  if (SHOTS) await D.screenshot({ path: `${shots}/wp08-desk-keys.png` });

  // ---- Screenshots: every card type, three interfaces, light and dark cards, phone and desktop
  if (SHOTS) {
    const all = { cloze: dz!, basic: await cid(D, "Beck"), mcq: await cid(D, "bee sting"), io: await cid(D, "Label the box"), vocab: await cid(D, "Niere", 0), vocab2: await cid(D, "Niere", 1) };
    const ph = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }); await ph.addInitScript(SPEECH); const S = await open(ph, "S");
    await S.evaluate(async ([a, b]) => { const y = (window as any).yuzu; await y.importPack(a); await y.importPack(b); await y.saveSettings({ typeAnswers: true }); }, [pack, german]);
    const sid = { cloze: await cid(S, "SVT"), basic: await cid(S, "Beck"), mcq: await cid(S, "bee sting"), io: await cid(S, "Label the box"), vocab: await cid(S, "Niere", 0), vocab2: await cid(S, "Niere", 1) };
    for (const [pg, ids2, tagW] of [[S, sid, "p412"], [D, all, "d1440"]] as const) for (const ui of ["arcade", "clean", "paper"]) for (const dark of [false, true]) {
      await pg.evaluate(([ui, dark]) => { localStorage.setItem("yuzu-ui", ui as string); return (window as any).yuzu.saveSettings({ nightCards: dark }); }, [ui, dark] as const);
      for (const [type, id] of Object.entries(ids2)) {
        if (tagW === "d1440" && dark && type !== "mcq") continue; // desktop: one dark sample is enough
        await study(pg, [id as string]);
        if (type === "mcq") { const t = await pg.locator(".mcq-opt span:nth-child(2)").allInnerTexts(); await pg.locator(".mcq-opt").nth(t.findIndex((x) => /Hydro/.test(x))).click(); }
        else if (type === "vocab" && tagW === "p412") { await pg.fill("input.typeans", "kidny"); await pg.keyboard.press("Enter"); }
        else await pg.click(".study-body");
        await pg.waitForSelector(".answer-bar"); await pg.waitForTimeout(150);
        await pg.screenshot({ path: `${shots}/wp08-${ui}-${dark ? "dark" : "light"}-${tagW}-${type}.png` });
      }
    }
    await ph.close();
  }
  await c3.close();
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails); process.exitCode = 1; }
  await browser.close(); server.kill();
}
