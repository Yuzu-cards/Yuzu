// WP15: Progress presentation, the monthly recap, boss wording and the Practice with Claude prompt.
import { chromium, type Page, type BrowserContext } from "playwright"; import { spawn } from "node:child_process";
const port = 5150 + Number(process.env.PORT_OFFSET ?? 0); const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`;
const DAY = 86400000;
async function open(ctx: BrowserContext, label: string, clock?: string): Promise<Page> {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(label + ": " + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon|save failed/.test(m.text())) errors.push(label + " console: " + m.text()); });
  if (clock) await p.clock.install({ time: new Date(clock) });
  await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 }); return p;
}
const pack = { yuzu_pack: 1, id: "wp15", cards: [
  { id: "ie", type: "cloze", category: "Medicine::Cardio", text: "Infective endocarditis in IV drug users most often affects the {{c1::tricuspid}} valve" },
  { id: "angina", type: "basic", category: "Medicine::Cardio", front: "First-line treatment of stable angina for symptom relief", back: "short-acting nitrate plus beta blocker", source: "NICE CG126" },
  { id: "rs", type: "mcq", category: "Step 1::Pathology", question: "A biopsy shows Reed–Sternberg cells. Which diagnosis fits best?", options: ["Hodgkin lymphoma", "Amyloidosis", "Sarcoidosis"], answer: 0, explanation: "Reed–Sternberg cells → Hodgkin lymphoma" },
  { id: "amy", type: "mcq", category: "Step 1::Pathology", question: "Apple-green birefringence with Congo red. Which diagnosis fits best?", options: ["Amyloidosis", "Gout"], answer: 0, explanation: "The amyloid fibrils' beta-pleated sheets bind the dye." },
  { id: "blut", type: "vocab", category: "German::Klinik", word: "Blutabnahme", article: "die", plural: "die Blutabnahmen", meaning: "blood draw" },
  { id: "auf", type: "vocab", category: "German::Klinik", word: "Aufnahme", article: "die", plural: "die Aufnahmen", meaning: "admission" },
] };
try {
  // ---- Practice with Claude (01-11): no German in a viva, no Source, no repeated MCQ explanation; German gets its own talk
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } }); const P = await open(ctx, "P");
  await P.evaluate(async (p) => { const y = (window as any).yuzu; await y.importPack(p); const t = Date.now() - 40 * 86400000; for (const c of [...y.cards.values()]) await y.answer(c.id, 3, 2000, t); }, pack);
  await P.click("details.more-today > summary").catch(() => {}); await P.locator("button", { hasText: "Practice with Claude" }).first().click();
  const viva = await P.locator("textarea[aria-label='Prompt for Claude']").inputValue();
  ok("the viva has the medical facts", /tricuspid/.test(viva) && /Hodgkin lymphoma/.test(viva) && /stable angina/.test(viva), viva.slice(0, 300));
  ok("…and no German words (neither direction of a vocab card)", !/Blutabnahme|Aufnahme|blood draw|admission/.test(viva));
  ok("…no Source field glued on", !/NICE CG126/.test(viva));
  ok("…an MCQ explanation that repeats the question is dropped, a useful one kept", !/Hodgkin lymphoma\. Reed/.test(viva) && /beta-pleated/.test(viva));
  ok("…grouped by topic", /\n(Cardio|Medicine › Cardio)[^\n]*:\n1\. /.test(viva) && /\nPathology[^\n]*:\n\d+\. /.test(viva), viva.split("\n").filter((l) => l.endsWith(":")).join(" | "));
  await P.locator(".sheet select").first().selectOption("area:German");
  ok("choosing the German area switches to German talk", await P.locator(".sheet .seg button.on", { hasText: "German talk" }).count() === 1);
  const de = await P.locator("textarea[aria-label='Prompt for Claude']").inputValue();
  ok("…whose prompt is a German ward conversation on the words, asked word → meaning", /Oberarzt/.test(de) && /die Blutabnahme → blood draw/.test(de) && !/\badmission → /.test(de) && !/tricuspid/.test(de), de.slice(0, 260));
  await P.locator(".sheet select").first().selectOption("area:Medicine");
  ok("…and back to the viva for Medicine", await P.locator(".sheet .seg button.on", { hasText: "Oral exam" }).count() === 1);
  await P.click("[aria-label='Close practice']");
  // ---- Leech route (05-17): one explanation that fits the sync in use
  await P.evaluate(() => (window as any).yuzu.saveSettings({ leechAction: "claude" }));
  await P.click("nav.tabs >> text=Settings"); await P.evaluate(() => { (document.getElementById("s-study") as HTMLDetailsElement).open = true; });
  const leech = await P.locator("#s-study").innerText();
  ok("without Drive the leech text says to send the file and import Claude's reply under Import", /Send to Claude/.test(leech) && /Import \(Anki, packs, Claude files\)/.test(leech) && !/Drive outbox/.test(leech), (leech.match(/It's marked[^\n]*/) ?? [""])[0]);
  ok("…and the Import section is called that", (await P.locator("#s-import > summary").innerText()).startsWith("Import"));
  await ctx.close();

  // ---- Recap (04-7, 04-8, 04-14) and Progress (04-2, 04-17, 04-18) with a pinned clock: 13/11/2026 11:00 Riyadh
  const c2 = await browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: "Asia/Riyadh" }); const R = await open(c2, "R", "2026-11-13T11:00:00+03:00");
  await R.evaluate(async (p) => { const y = (window as any).yuzu; await y.importPack(p); }, pack);
  const setup = await R.evaluate(async () => {
    const y = (window as any).yuzu; const D = 86400000; const ids = [...y.cards.values()].map((c: any) => c.id); const cloze = [...y.cards.values()].find((c: any) => y.notes.get(c.nid).fields[0].includes("{{c1::"));
    // one review on every day of November so far (10:00 each day), today included
    for (let d = 1; d <= 13; d++) { const ts = new Date(`2026-11-${String(d).padStart(2, "0")}T10:00:00+03:00`).getTime(); await y.answer(ids[d % ids.length], 3, 3000, ts); }
    // the cloze card is learned and forgotten twice: the month's nemesis
    for (let i = 0; i < 2; i++) { const cur = y.cards.get(cloze.id); y.cards.set(cloze.id, { ...cur, state: "review", step: 0, stability: 9, reps: Math.max(3, cur.reps), due: Date.now() - 1000, lastReview: Date.now() - 9 * D }); await y.answer(cloze.id, 1, 1500); }
    const from = new Date("2026-11-01T12:00:00+03:00").getTime(); const r = y.recap(y.dayStart(from), y.dayStart(new Date("2026-12-01T12:00:00+03:00").getTime()));
    return { spanDays: r.spanDays, daysStudied: r.daysStudied, nemesis: r.nemesis?.title, top: r.topSys };
  });
  ok("recap: 13 study days of 13 so far this month (today counts)", setup.spanDays === 13 && setup.daysStudied === 13, JSON.stringify(setup));
  ok("recap: the nemesis shows the gap, not cloze markup or the answer", !!setup.nemesis && !/\{\{|tricuspid/.test(setup.nemesis!) && /\[…\]/.test(setup.nemesis!), setup.nemesis);
  ok("recap: time per area reports recall on learned cards only", setup.top.every((t: any) => t.recall === null || (t.recall >= 0 && t.recall <= 1)), JSON.stringify(setup.top));
  await R.click("nav.tabs >> text=Progress"); await R.click("button:has-text('Recap')"); await R.waitForTimeout(300);
  const rtxt = await R.locator(".recap-cards").innerText();
  ok("the recap card reads 'over 13 of 13 days'", /over\s+13\s+of 13 days/.test(rtxt), (rtxt.match(/over[^\n]*/) ?? [""])[0]);
  ok("…speaks of learned cards, with a labelled recall %", /of learned cards recalled/.test(rtxt) || !/recalled/.test(rtxt));
  await R.click(".recap-card button:has-text('Needs improving')"); await R.waitForSelector(".sheet >> text=What's wrong with this card?");
  ok("the nemesis has a 'Needs improving' button that opens the mark sheet", true);
  await R.locator(".sheet .chip").first().click(); await R.click(".sheet >> text=Mark for improving"); await R.waitForTimeout(200);
  ok("…and marks the card", await R.evaluate(() => (window as any).yuzu.improveList().length === 1));
  await R.click("[aria-label='Close recap']");
  // Heatmap: weekday and month labels, a legend, a dated hint per day
  const heat = await R.evaluate(() => { const cells = [...document.querySelectorAll(".heat-wrap > i")]; const last = cells[cells.length - 1] as HTMLElement; return { cells: cells.length, labels: [...document.querySelectorAll(".heat-day")].map((e) => e.textContent).filter(Boolean), months: [...document.querySelectorAll(".heat-month")].map((e) => e.textContent).filter(Boolean), legend: document.querySelector(".heat-legend")?.textContent, hint: last?.getAttribute("data-hint"), row: last?.style.gridRow }; });
  ok("heatmap: weekday rows and month labels, today (a Friday) in its row, a legend", heat.labels.join(",") === "Sun,Tue,Thu,Sat" && heat.months.includes("Nov") && heat.row === "7" && heat.cells === 77 + 6 && /Reviews a day/.test(heat.legend ?? ""), JSON.stringify(heat));
  ok("…and each day's hint has its date (dd/mm/yyyy) and count", /^Fri 13\/11\/2026\|\d+ reviews?/.test(heat.hint ?? ""), heat.hint ?? "");
  ok("calibration axis label '100%' is inside the chart", await R.evaluate(() => { const svg = document.querySelector("svg.calib") as SVGSVGElement | null; if (!svg) return true; const vb = svg.viewBox.baseVal; return [...svg.querySelectorAll("text")].every((t) => { const b = (t as SVGTextElement).getBBox(); return b.x >= 0 && b.x + b.width <= vb.width + 0.5; }); }));
  ok("no 'By category' list repeating Areas, no ⚔ glyph", !(await R.locator(".screen").innerText()).includes("By category") && !(await R.locator(".screen").innerText()).includes("⚔"));
  // Staleness (04-2): Areas follows an answer while Progress stays open
  const dueOf = async () => Number((await R.locator(".area-row", { hasText: "Medicine" }).locator(".num").first().innerText()).replace(/\D/g, ""));
  await R.evaluate(async () => { const y = (window as any).yuzu; for (const c of [...y.cards.values()].filter((c: any) => c.source.startsWith("Medicine") && c.state !== "review")) y.cards.set(c.id, { ...c, state: "review", step: 0, stability: 5, reps: 3, due: Date.now() - 3600e3, lastReview: Date.now() - 5 * 86400000 }); await y.saveSettings({}); });
  await R.clock.runFor(2500); await R.waitForTimeout(200);
  const before = await dueOf();
  await R.evaluate(async () => { const y = (window as any).yuzu; const c = [...y.cards.values()].find((c: any) => c.source.startsWith("Medicine") && c.state === "review" && c.due < Date.now()); await y.answer(c.id, 3, 3000); });
  await R.clock.runFor(2500); await R.waitForTimeout(200);
  const after = await dueOf();
  ok("Areas updates within 2 seconds of an answer while Progress is open", before >= 1 && after === before - 1, `${before} → ${after}`);
  // Desktop: two columns
  await R.setViewportSize({ width: 1440, height: 900 }); await R.waitForTimeout(200);
  const cols = await R.evaluate(() => { const c = document.querySelector(".progress-cols"); return c ? getComputedStyle(c).gridTemplateColumns.split(" ").length : 0; });
  ok("on a desktop Progress has two columns", cols === 2, String(cols));
  await R.setViewportSize({ width: 412, height: 915 });
  const one = await R.evaluate(() => getComputedStyle(document.querySelector(".progress-cols")!).display);
  ok("…and one on a phone", one === "block", one);
  ok("the Progress tab hint no longer promises a streak", !/Streak/.test((await R.locator("nav.tabs [data-hint^='Progress']").first().getAttribute("data-hint").catch(() => "")) ?? ""));
  await c2.close();
} catch (e: any) { console.log("✗ threw: " + (e?.stack ?? e)); fails.push("exception");
} finally {
  await browser.close(); server.kill();
  if (errors.length) { console.log("Page errors:\n" + errors.join("\n")); fails.push("page errors"); }
  console.log(fails.length ? `\n${fails.length} failed: ${fails.join("; ")}` : "\nall passed"); process.exit(fails.length ? 1 : 0);
}
