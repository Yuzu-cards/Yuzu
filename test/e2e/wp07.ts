// WP07: undo takes back whatever was done last, in study and everywhere an Undo is promised.
// 02-2 (no replay after a card's second showing), 02-4 (pause / flag / delete / retire each undo themselves), 02-6 (the last
// answer of a session), 10-18 (answer → delete → undo delete keeps the answer's undo), 04-9 (one Undo per applied workload fix),
// 05-16 (Unmark in Cards to improve has an Undo).
import { chromium, type Page, type BrowserContext } from "playwright"; import { spawn } from "node:child_process";
const port = 5070 + Number(process.env.PORT_OFFSET ?? 0); const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`;
async function open(ctx: BrowserContext, label: string, clock = false): Promise<Page> {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(label + ": " + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon|save failed/.test(m.text())) errors.push(label + " console: " + m.text()); });
  if (clock) await p.clock.install({ time: new Date("2026-11-13T10:00:00+03:00") });
  await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 }); return p;
}
const pack = (id: string, n: number) => ({ yuzu_pack: 1, id, category: "Medicine::Undo", cards: Array.from({ length: n }, (_, i) => ({ id: "q" + i, front: `Q${i} question`, back: `answer ${i}` })) });
const front = (p: Page) => p.locator(".study .card-host").first().evaluate((el) => (el.shadowRoot!.querySelector(".card")!.textContent ?? "").trim().match(/Q\d+/)?.[0] ?? "").catch(() => "");
const left = async (p: Page) => (await p.locator(".study-top span.num").innerText().catch(() => "")).match(/(\d+) left/)?.[1] ?? "";
const reviews = (p: Page) => p.evaluate(() => (window as any).yuzu.reviews.length as number);
async function grade(p: Page, g: 1 | 2 | 3 | 4) { await p.waitForSelector(".show-bar", { timeout: 4000 }); await p.keyboard.press(" "); await p.waitForSelector(".answer-bar", { timeout: 4000 }); await p.keyboard.press(String(g)); await p.waitForTimeout(150); }
async function study(p: Page) { await p.evaluate(() => window.dispatchEvent(new CustomEvent("yuzu-study"))); await p.waitForSelector(".study .card-host", { timeout: 5000 }); }
async function menu(p: Page, item: string) { await p.click('[aria-label="More"]'); await p.click(`.menu >> text=${item}`); await p.waitForTimeout(150); }
const undo = async (p: Page) => { await p.keyboard.press("Control+z"); await p.waitForTimeout(250); };
try {
  // ---- 02-2: Q0 Again comes back later in the session; undoing its second answer goes back one card only
  {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } }); const P = await open(ctx, "A", true); await P.evaluate((x) => (window as any).yuzu.importPack(x), pack("u1", 5));
    await study(P); const seen: string[] = [await front(P)]; await grade(P, 1);
    await P.clock.runFor(2 * 60_000); // Q0's learning step is up
    seen.push(await front(P)); await grade(P, 3); seen.push(await front(P)); await grade(P, 3); seen.push(await front(P));
    ok("Again brings the card back in the same session", seen.join(" ") === "Q0 Q1 Q2 Q0", seen.join(" "));
    await grade(P, 3); const r0 = await reviews(P), l0 = await left(P);
    await undo(P); const after = { card: await front(P), left: await left(P), reviews: await reviews(P) };
    ok("02-2: undo shows Q0 again, one card back (not its first showing)", after.card === "Q0" && Number(after.left) === Number(l0) + 1 && after.reviews === r0 - 1, JSON.stringify({ l0, r0, after }));
    const rest: string[] = []; for (let i = 0; i < 6 && (await P.locator(".study .card-host").count()); i++) { rest.push(await front(P)); await grade(P, 3); }
    ok("…and the session goes on Q0 Q3 Q4 — nothing graded before is replayed", rest.join(" ") === "Q0 Q3 Q4", rest.join(" "));
    // ---- 02-6: the done screen offers ↶ for the last answer, by button and by Ctrl+Z
    ok("02-6: the done screen offers Undo the last answer", await P.locator("text=Undo the last answer").count() === 1 && await P.locator('.study-top [aria-label="Undo"]').count() === 1);
    const r1 = await reviews(P); await undo(P);
    ok("…Ctrl+Z on the done screen reopens the session at that card", (await front(P)) === "Q4" && (await reviews(P)) === r1 - 1 && (await left(P)) === "1");
    await grade(P, 3); await P.click("text=Undo the last answer"); await P.waitForTimeout(250);
    ok("…and the button does the same", (await front(P)) === "Q4" && (await reviews(P)) === r1 - 1);
    await grade(P, 3); ok("…answering again finishes the session", await P.locator("text=Undo the last answer").count() === 1 && (await reviews(P)) === r1);
    await ctx.close();
  }
  // ---- 02-4: pause, flag, delete, retire — each is undone by itself, the earlier answer stays
  {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } }); const P = await open(ctx, "B"); await P.evaluate((x) => (window as any).yuzu.importPack(x), pack("u2", 8));
    await study(P); await grade(P, 3); const r0 = await reviews(P); const c1 = await front(P);
    await menu(P, "Pause this card"); ok("pause moves on", (await front(P)) !== c1);
    await undo(P); const st = await P.evaluate(() => { const y = (window as any).yuzu; return [...y.cards.values()].filter((c: any) => c.suspended).length; });
    ok("02-4: undo after Pause unpauses that card (the earlier answer stays)", st === 0 && (await reviews(P)) === r0 && (await front(P)) === c1 && /Unpaused/.test(await P.locator(".toast").innerText().catch(() => "")), JSON.stringify({ st, r: await reviews(P), r0 }));
    await menu(P, "Flag this card"); await undo(P);
    const fl = await P.evaluate(() => [...(window as any).yuzu.cards.values()].filter((c: any) => c.flag).length);
    ok("…undo after Flag removes the flag, nothing else", fl === 0 && (await reviews(P)) === r0 && (await front(P)) === c1);
    await menu(P, "Delete this card"); await P.click(".sheet >> button:has-text('Delete')"); await P.waitForTimeout(250);
    const cardsAfterDel = await P.evaluate(() => (window as any).yuzu.cards.size);
    await undo(P); const back = await P.evaluate(() => (window as any).yuzu.cards.size);
    ok("…undo after Delete brings the card back in place", cardsAfterDel === 7 && back === 8 && (await front(P)) === c1 && (await reviews(P)) === r0, JSON.stringify({ cardsAfterDel, back }));
    await menu(P, "I've mastered this"); await P.click(".sheet >> button:has-text('mastered it')"); await P.waitForTimeout(250);
    const m1 = await P.evaluate(() => ({ n: (window as any).yuzu.cards.size, log: (window as any).yuzu.mastery.log.length }));
    await undo(P); const m2 = await P.evaluate(() => ({ n: (window as any).yuzu.cards.size, log: (window as any).yuzu.mastery.log.length }));
    ok("…undo after I've mastered this brings it back and takes it out of the Mastered log", m1.n === 7 && m1.log === 1 && m2.n === 8 && m2.log === 0 && (await front(P)) === c1, JSON.stringify({ m1, m2 }));
    await undo(P); ok("…then the next undo takes back the earlier answer", (await reviews(P)) === r0 - 1 && (await left(P)) === "8");
    await undo(P); ok("…and with nothing left, it says so", /Nothing to undo/.test(await P.locator(".toast").innerText().catch(() => "")) && (await reviews(P)) === r0 - 1);
    // ---- 10-18 in the store: answer → delete its note → undo the delete → the answer can still be undone
    const s = await P.evaluate(async () => { const y = (window as any).yuzu; const c = [...y.cards.values()][3]; await y.answer(c.id, 3, 1000); const n0 = y.reviews.length; await y.deleteNotes([c.nid]); const mid = y.canUndoLast(); await y.undoDelete(); const can = y.canUndoLast(); const prev = await y.undoLast(); return { mid, can, prev: prev?.id === c.id, reps: y.cards.get(c.id).reps, n: y.reviews.length - n0, stack: (await y._db.getMeta("undoStack", [])).length === y.undoStack.length }; });
    ok("10-18: after undoing a delete, the review before it can still be undone", s.mid === null && !!s.can && s.prev && s.reps === 0 && s.n === -1 && s.stack, JSON.stringify(s));
    // ---- bury (hold Good: this note's other cards wait): undo brings the siblings back too
    await P.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ burySiblings: false }); await y.importPack({ yuzu_pack: 1, id: "u3", category: "Medicine::Sib", cards: [{ id: "z", type: "cloze", text: "Sib {{c1::one}} and {{c2::two}} and {{c3::three}}" }] }); });
    await P.click('[aria-label="Close"]'); await P.evaluate(() => window.dispatchEvent(new CustomEvent("yuzu-study")));
    await P.waitForSelector(".study .card-host"); let guard = 0;
    while (!(await P.locator(".study .card-host").evaluate((el) => /Sib/.test(el.shadowRoot!.textContent ?? ""))) && guard++ < 12) await grade(P, 3);
    const before = await left(P); await P.keyboard.press(" "); await P.waitForSelector(".answer-bar");
    const g = P.locator(".answer-bar .good"); const box = (await g.boundingBox())!; await P.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await P.mouse.down(); await P.waitForTimeout(900); await P.mouse.up(); await P.waitForTimeout(250);
    const buried = await left(P); await undo(P); const restored = await left(P);
    ok("bury: undo after hold-Good brings the sibling cards back into the session", Number(buried) === Number(before) - 3 && restored === before, JSON.stringify({ before, buried, restored }));
    await ctx.close();
  }
  // ---- 04-9: two workload fixes, each keeps its own Undo
  {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } }); const P = await open(ctx, "D"); await P.evaluate((x) => (window as any).yuzu.importPack(x), pack("u4", 80));
    await P.evaluate(async () => { const y = (window as any).yuzu; const now = Date.now(), D = 86400000; let k = 0;
      for (const c of [...y.cards.values()]) { y.cards.set(c.id, { ...c, state: "review", stability: 20 + (k % 40), difficulty: 5, reps: 3, due: now - (2 + (k % 9)) * D, lastReview: now - 30 * D }); for (let j = 0; j < 4; j++) y.reviews.push({ id: c.id + "-" + j, cid: c.id, ts: now - (1 + ((k + j * 7) % 28)) * D, rating: 3, state: "review", elapsedDays: 5, scheduledDays: 5, durationMs: 4000 }); k++; }
      y.reviews.sort((a: any, b: any) => a.ts - b.ts); await y.saveSettings({ scheduler: { ...y.settings.scheduler, desiredRetention: 0.95 } }); y.openOnToday("workload"); });
    await P.waitForSelector("text=Why so many reviews?", { timeout: 5000 });
    ok("the sheet says every applied fix can be undone", await P.locator("text=every fix you apply here can be undone").count() === 1);
    await P.click("text=Spread them over 7 days"); await P.waitForSelector(".diag.applied"); await P.click("text=Set target recall to 90%"); await P.waitForTimeout(400);
    const n = await P.locator(".diag.applied button:has-text('Undo')").count(); const r1 = await P.evaluate(() => (window as any).yuzu.settings.scheduler.desiredRetention);
    ok("04-9: after two fixes both still offer Undo", n === 2 && r1 === 0.9, `${n} ${r1}`);
    const overdue0 = await P.evaluate(() => (window as any).yuzu.overdueCount());
    await P.locator(".diag.applied").first().locator("button:has-text('Undo')").click(); await P.waitForTimeout(400);
    const after = await P.evaluate(() => ({ overdue: (window as any).yuzu.overdueCount(), ret: (window as any).yuzu.settings.scheduler.desiredRetention }));
    ok("…undoing the first (spread) puts the overdue cards back and leaves the second fix in place", after.overdue === 80 && overdue0 < 80 && after.ret === 0.9 && await P.locator(".diag.applied").count() === 1, JSON.stringify({ overdue0, after }));
    await P.locator(".diag.applied button:has-text('Undo')").click(); await P.waitForTimeout(300);
    ok("…and the second one undoes too", (await P.evaluate(() => (window as any).yuzu.settings.scheduler.desiredRetention)) === 0.95);
    await P.screenshot({ path: "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad/wp07-diag.png" });
    await ctx.close();
  }
  // ---- 05-16: Unmark in Cards to improve has an Undo
  {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } }); const P = await open(ctx, "E"); await P.evaluate((x) => (window as any).yuzu.importPack(x), pack("u5", 3));
    const nid = await P.evaluate(async () => { const y = (window as any).yuzu; const n = [...y.notes.keys()][0]; await y.markImprove([n], ["unclear"], "say why"); return n; });
    await P.click("nav.tabs >> text=Settings"); await P.click("#s-improve > summary"); await P.click("#s-improve >> button:has-text('Unmark')"); await P.waitForTimeout(200);
    const gone = await P.evaluate((n) => (window as any).yuzu.improveFor(n), nid);
    await P.click(".kit-snack >> button:has-text('Undo')"); await P.waitForTimeout(250);
    const back = await P.evaluate((n) => (window as any).yuzu.improveFor(n), nid);
    ok("05-16: Unmark offers Undo, which puts the mark back with its reasons and note", gone === null && back?.r?.[0] === "unclear" && back?.t === "say why", JSON.stringify(back));
    await ctx.close();
  }
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails); process.exitCode = 1; }
  await browser.close(); server.kill();
}
