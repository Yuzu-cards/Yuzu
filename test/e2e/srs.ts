// Spaced repetition in the real app (IndexedDB, the store, the queue) with a controlled clock in Riyadh time:
// new cards per day and the 4:00 rollover, sibling burying (without losing new cards), the review cap, learning cards
// coming back, the load balancer (within the fuzz range, steering away from an off day), postponing a backlog (fragile
// first, undo), retirement of mastered cards. Fails on any JavaScript error.
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 4185; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const fails: string[] = []; const errors: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: "Asia/Riyadh" }); const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const at = async (iso: string) => { await page.clock.setFixedTime(new Date(iso)); };
const y = <T>(f: string) => page.evaluate(f) as Promise<T>;
try {
  await at("2026-11-10T03:30:00+03:00");
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet", { timeout: 15000 });
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg"); await page.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  await page.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ newPerDay: 5, burySiblings: false, maxReviewsPerDay: 0, easyDays: [1, 1, 1, 1, 1, 1, 1], breakFrom: "", breakTo: "" }); });
  const counts = `(() => { const y = window.yuzu; const q = y.queue("", Date.now()); return { n: q.filter((c) => c.state === "new").length, r: q.filter((c) => c.state === "review").length, l: q.filter((c) => c.state !== "new" && c.state !== "review").length, nids: q.length - new Set(q.map((c) => c.nid)).size }; })()`;

  // ---- new cards per day and the 4:00 rollover
  let c = await y<any>(counts); ok("5 new cards offered (new/day = 5)", c.n === 5, JSON.stringify(c));
  await page.evaluate(async () => { const y = (window as any).yuzu; for (const card of y.queue("", Date.now()).filter((c: any) => c.state === "new")) await y.answer(card.id, 3, 4000, Date.now()); });
  c = await y<any>(counts); ok("after learning 5, no more new today", c.n === 0, JSON.stringify(c));
  await at("2026-11-10T03:59:00+03:00"); c = await y<any>(counts); ok("03:59 is still the same study day", c.n === 0);
  await at("2026-11-10T04:01:00+03:00"); c = await y<any>(counts); ok("04:01 is a new day: 5 new again", c.n === 5, JSON.stringify(c));

  // ---- learning cards come back on time
  const lid = await page.evaluate(async () => { const y = (window as any).yuzu; const card = y.queue("", Date.now()).find((c: any) => c.state === "new"); await y.answer(card.id, 1, 3000, Date.now()); return card.id; });
  await at("2026-11-10T04:01:30+03:00"); ok("Again: not back before its minute", !(await page.evaluate((id) => (window as any).yuzu.queue("", Date.now()).some((c: any) => c.id === id), lid)));
  await at("2026-11-10T04:02:05+03:00");
  const lq = await page.evaluate((id) => { const q = (window as any).yuzu.queue("", Date.now()); const i = q.findIndex((c: any) => c.id === id); const firstOther = q.findIndex((c: any) => c.state === "new" || c.state === "review"); return { i, firstOther }; }, lid);
  ok("…and back with the learning cards, ahead of reviews and new cards, once due", lq.i >= 0 && (lq.firstOther < 0 || lq.i < lq.firstOther), JSON.stringify(lq));

  // ---- burying siblings keeps the day's new-card count
  await page.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ burySiblings: true, newPerDay: 40 }); });
  await at("2026-11-11T09:00:00+03:00");
  c = await y<any>(counts); ok("with bury siblings: no two cards of one note in the queue", c.nids === 0, JSON.stringify(c));
  ok("…and still the full 40 new cards (a buried sibling is replaced, not lost)", c.n === 40, JSON.stringify(c));
  const sib = await page.evaluate(async () => { const y = (window as any).yuzu; const byNote = y.cardsByNote(); const card = y.queue("", Date.now()).find((c: any) => (byNote.get(c.nid) ?? []).length > 1); if (!card) return null; await y.answer(card.id, 3, 3000, Date.now()); return y.queue("", Date.now()).filter((c: any) => c.nid === card.nid && c.id !== card.id && c.state !== "learning").length; });
  ok("after answering a card, its siblings wait until tomorrow", sib === 0 || sib === null, String(sib));

  // ---- the daily review cap
  await page.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ maxReviewsPerDay: 10, burySiblings: false }); });
  c = await y<any>(counts); const done = await y<number>(`window.yuzu.reviewedToday(Date.now()).reviews`);
  ok("max reviews per day caps the due cards offered", c.r <= Math.max(0, 10 - done), `offered ${c.r}, done today ${done}`);
  await page.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ maxReviewsPerDay: 0 }); });

  // ---- load balancer: inside the fuzz range, and away from an off day (Friday)
  await page.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ easyDays: [1, 1, 1, 1, 1, 0, 1] }); });
  const lb = await page.evaluate(async () => {
    const y = (window as any).yuzu; const F = y._fsrs; const DAY = 86400000; const now = Date.now();
    const due = y.queue("", now).filter((c: any) => c.state === "review").slice(0, 150); let outside = 0, friday = 0, balanced = 0, moved = 0; const bad: any[] = [];
    for (const card of due) {
      const base = F.rate(card, 3, now, y.settings.scheduler).intervalDays;
      const next = await y.answer(card.id, 3, 3000, now); const got = Math.round((next.due - now) / DAY);
      if (base < 3) continue; balanced++;
      const spread = Math.max(1, Math.round(base * (base <= 7 ? 0.15 : base <= 20 ? 0.1 : 0.05)));
      if (Math.abs(got - base) > spread) { outside++; if (bad.length < 3) bad.push({ base, got, spread }); }
      if (new Date(next.due).getDay() === 5) friday++; if (got !== base) moved++;
    }
    return { balanced, outside, friday, moved, bad };
  });
  ok("balanced dates stay inside the fuzz range", lb.balanced > 30 && lb.outside === 0, JSON.stringify(lb));
  ok("…and never land on the off day (Friday)", lb.friday === 0, `${lb.friday} of ${lb.balanced}`);

  // ---- postpone a backlog: the fragile stay soonest; undo puts everything back
  const pp = await page.evaluate(async () => {
    const y = (window as any).yuzu; const DAY = 86400000; const now = Date.now();
    const pick = [...y.cards.values()].filter((c: any) => c.state === "review").slice(0, 70);
    for (const [i, c] of pick.entries()) y.cards.set(c.id, { ...c, due: now - (3 + (i % 9)) * DAY, stability: 1 + i * 3 });
    const before = new Map(pick.map((c: any) => [c.id, y.cards.get(c.id).due]));
    const res = await y.postponeOverdue(7); const undo = res.undo; const day0 = y.dayStart(now);
    const after = pick.map((c: any) => y.cards.get(c.id)); let order = 0, span = 0;
    for (const a of after) { if (a.due < day0 || a.due >= day0 + 7 * DAY) span++; for (const b of after) if (a.stability < b.stability && Math.floor((a.due - day0) / DAY) > Math.floor((b.due - day0) / DAY)) order++; }
    await undo(); let restored = 0; for (const c of pick) if (y.cards.get(c.id).due === before.get(c.id)) restored++;
    return { n: pick.length, span, order, restored };
  });
  ok("postpone spreads the backlog over the next 7 days", pp.span === 0, JSON.stringify(pp));
  ok("…most fragile first", pp.order === 0, JSON.stringify(pp));
  ok("…and undo restores every date", pp.restored === pp.n, JSON.stringify(pp));

  // ---- retirement: > 20 y retires (kept in the log), > 5 y is offered
  const rt = await page.evaluate(async () => {
    const y = (window as any).yuzu; const DAY = 86400000; const now = Date.now(); const [a, b] = [...y.cards.values()].filter((c: any) => c.state === "review").slice(-2);
    y.cards.set(a.id, { ...a, lastReview: now - 2 * DAY, due: now + 25 * 365 * DAY }); y.cards.set(b.id, { ...b, lastReview: now - 2 * DAY, due: now + 6 * 365 * DAY });
    const offered = y.countBeyond(5); const logBefore = y.mastery.log.length; await y.autoMaster();
    return { offered, retiredA: !y.cards.has(a.id), keptB: y.cards.has(b.id), logged: y.mastery.log.length - logBefore, logHasA: y.mastery.log.some((e: any) => e.id === a.id) };
  });
  ok("a card past 20 years is retired and logged", rt.retiredA && rt.logHasA && rt.logged >= 1, JSON.stringify(rt));
  ok("a card past 5 years is offered, not retired", rt.keptB && rt.offered >= 2, JSON.stringify(rt));
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails); process.exitCode = 1; }
  await browser.close(); server.kill();
}
