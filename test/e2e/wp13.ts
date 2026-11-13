// WP13 — the Today screen: learning cards waking up while Today is open, one meaning of "due", the study day (04:00) for
// labels and dismissals, honest Boss / Next / exam / overdue / backup wording, the empty state, quick add's vocab deck,
// the "all done" and "goal reached" moment, and the ← Citrus chip. Time-based checks run on Playwright's fake clock.
import { chromium, type Page, type BrowserContext } from "playwright"; import { spawn } from "node:child_process";
const port = 5130 + Number(process.env.PORT_OFFSET ?? 0); /* PORT_OFFSET lets several copies run at once */ const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`; const SHOTS = process.env.WP13_SHOTS ?? "";
const pack = (id: string, category: string, n: number) => ({ yuzu_pack: 1, id, category, cards: Array.from({ length: n }, (_, i) => ({ id: id + i, front: `${id} question ${i}`, back: `answer ${i}` })) });
async function ctxAt(time: string | null, viewport = { width: 412, height: 915 }, ui?: string): Promise<{ ctx: BrowserContext; p: Page }> {
  const ctx = await browser.newContext({ viewport, timezoneId: "Asia/Riyadh", locale: "en-GB" });
  await ctx.addInitScript("window.__name = (f) => f"); if (ui) await ctx.addInitScript(`try { localStorage.setItem("yuzu-ui", ${JSON.stringify(ui)}) } catch {}`);
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon|save failed/.test(m.text())) errors.push("console: " + m.text()); });
  if (time) await p.clock.install({ time: new Date(time) });
  await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 }); return { ctx, p };
}
const heroText = (p: Page) => p.locator(".hero").innerText();
const shot = async (p: Page, name: string) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };
try {
  // ---- 01-1 + 01-18: finish the queue at 19:30; the learning steps come back by themselves with Today left open
  { const { ctx, p } = await ctxAt("2026-11-13T19:30:00+03:00", undefined, "arcade");
    await p.evaluate(async (pk) => { const y = (window as any).yuzu; await y.importPack(pk); await y.saveSettings({ newPerDay: 12, dailyGoal: 5 }); }, pack("ln", "Medicine::Learn", 12));
    await p.evaluate(async () => { const y = (window as any).yuzu; for (let i = 0; i < 200; i++) { const q = y.queue(""); if (!q.length) break; await y.answer(q[0].id, 3, 1500); } });
    await p.click("nav.tabs >> text=Library"); await p.click("nav.tabs >> text=Today"); await p.waitForTimeout(150);
    const done = await heroText(p); const queued = await p.evaluate(() => (window as any).yuzu.queue("").length);
    ok("01-18 the empty queue says All done, with when the learning cards come back", queued === 0 && /All done for today\./.test(done) && /12 learning cards come back later today, the first at \d\d:\d\d/.test(done), done.replace(/\n/g, " | "));
    ok("01-18 …the dull disabled Study becomes Mixed drill", (await p.locator(".hero button.btn.primary", { hasText: "Mixed drill" }).isEnabled()));
    ok("01-18 goal reached: ★ and 'reached!'", (await p.locator(".hero.goal-done .goal-star").count()) === 1 && /reached!/.test(done));
    await shot(p, "done-arcade-412");
    await p.clock.runFor(61 * 60 * 1000); await p.waitForTimeout(300);
    const back = await heroText(p); const n = await p.evaluate(() => (window as any).yuzu.queue("").length);
    ok("01-1 with Today left open, the learning cards appear when they fall due (one timer)", n === 12 && new RegExp(`\\b${n} cards\\s*ready`).test(back.replace(/\n/g, " ")) && /12 learning/.test(back), back.replace(/\n/g, " | "));
    ok("01-1 …and Study is enabled again", await p.locator(".hero button.btn.primary", { hasText: "Study" }).isEnabled());
    await shot(p, "back-arcade-412");
    await ctx.close(); }

  // ---- 01-6: after midnight (still Friday's study day) the bars are named from the study day
  { const { ctx, p } = await ctxAt("2026-11-14T01:00:00+03:00");
    await p.evaluate(async (pk) => { const y = (window as any).yuzu; await y.importPack(pk); }, pack("lb", "Medicine::Labels", 5));
    await p.click("nav.tabs >> text=Library"); await p.click("nav.tabs >> text=Today");
    const labels = await p.locator(".forecast > div > span:last-child").allInnerTexts();
    ok("01-6 at 01:00 Saturday the labels read today, Sat, Sun… (no day skipped)", labels.join(",") === "today,Sat,Sun,Mon,Tue,Wed,Thu", labels.join(","));
    const hint = await p.locator(".forecast > div").nth(1).getAttribute("data-hint");
    ok("01-6 …and the hints too", /^Saturday\|/.test(hint ?? ""), hint ?? "");
    await ctx.close(); }

  // ---- 01-7 + 01-13: dismissals follow the 04:00 study day; "No backup yet" on day one
  { const { ctx, p } = await ctxAt("2026-11-13T23:50:00+03:00");
    await p.evaluate(async (pk) => { const y = (window as any).yuzu; await y.importPack(pk); }, pack("bk", "Medicine::Backup", 101));
    await p.click("nav.tabs >> text=Library"); await p.click("nav.tabs >> text=Today");
    const tip = p.locator(".coach-row", { hasText: "No backup" });
    ok("01-13 a user who never backed up sees 'No backup yet' (not 'in 30 days')", (await tip.innerText().catch(() => "")).includes("No backup yet"));
    await p.click('[aria-label="Dismiss: No backup yet"]');
    await p.clock.runFor(20 * 60 * 1000); await p.click("nav.tabs >> text=Library"); await p.click("nav.tabs >> text=Today"); await p.waitForTimeout(100);
    ok("01-7 dismissed at 23:50, still hidden at 00:10 (same study day)", (await tip.count()) === 0);
    await p.clock.runFor(3 * 3600 * 1000 + 30 * 60 * 1000); await p.click("nav.tabs >> text=Library"); await p.click("nav.tabs >> text=Today"); await p.waitForTimeout(100);
    ok("01-7 …and still hidden at 03:50", (await tip.count()) === 0);
    await p.clock.runFor(20 * 60 * 1000); await p.waitForTimeout(300);
    ok("01-7 back after 04:00 (a new study day), even with Today left open", (await tip.count()) === 1);
    await ctx.close(); }

  // ---- 01-5, 01-8, 01-9, 01-10, 01-12 on one system ("Cardio": 14 well-learned, 26 unseen; 9 of the 14 overdue)
  { const { ctx, p } = await ctxAt("2026-11-13T19:30:00+03:00", { width: 1440, height: 900 }, "paper");
    await p.evaluate(async (pk) => { const y = (window as any).yuzu; await y.importPack(pk); const now = Date.now(), D = 86400000;
      for (const n of [...y.notes.values()]) y.notes.set(n.id, { ...n, tags: ["auto::System::Cardio"] });
      const cards = [...y.cards.values()].sort((a: any, b: any) => a.id < b.id ? -1 : 1);
      cards.slice(0, 14).forEach((c: any, i: number) => y.cards.set(c.id, { ...c, state: "review", reps: 6, stability: 400, step: 0, lastReview: now - (i < 9 ? 40 : 1) * D, due: i < 9 ? now - 2 * D : now + 100 * D }));
      const d = (k: number) => y.isoToday(new Date(now + k * D));
      await y.saveSettings({ newPerDay: 1, deadlines: [{ id: "a", name: "Exam A", date: d(0), view: "decks", path: "" }, { id: "b", name: "Exam B", date: d(1), view: "decks", path: "" }, { id: "c", name: "Exam C", date: d(3), view: "decks", path: "" }] });
      const fresh = y.queue("").find((c: any) => c.state === "new"); await y.answer(fresh.id, 3, 1500); }, pack("cv", "Medicine::Cardio", 40));
    await p.click("nav.tabs >> text=Library"); await p.click("nav.tabs >> text=Today"); await p.waitForTimeout(150);
    const hero = (await heroText(p)).replace(/\n/g, " ");
    const cat = await p.locator(".stack", { hasText: "Medicine" }).first().locator(".meta").innerText();
    ok("01-5 one meaning of due: the hero's 9 due and the category's 9 due agree; unseen cards say unseen", /9 due, 0 learning and 0 new/.test(hero) && cat === "9 due · 1 learning later · 25 unseen", `${hero.slice(0, 90)} || ${cat}`);
    const coach = await p.locator(".coach-row").allInnerTexts(); const boss = coach.find((t) => /Boss fight/.test(t)) ?? ""; const next = coach.find((t) => /finish Cardio/.test(t)) ?? "";
    ok("01-8 the Boss tip promises what the fight holds (14 cards, all 14)", /14 well-learned cards — all 14 in random order, no hints, 85% to pass/.test(boss), boss.replace(/\n/g, " | "));
    ok("01-9 with today's new cards used up the tip says Tomorrow, and offers 10 more", /^Tomorrow: finish Cardio/.test(next) && /tap to learn 10 more/.test(next), next.replace(/\n/g, " | "));
    const ov = await p.locator(".col-side > p").first().innerText();
    ok("01-12 a small backlog is 'already in today's session', not 'extra a day'", /9 overdue, already in today's session/.test(ov) && !/extra a day/.test(ov), ov);
    const exams = await p.locator(".card-box", { hasText: "cards in scope" }).allInnerTexts();
    ok("01-10 exam today / tomorrow: triage, no pace sum", /Too late for the 25 new cards: review the weakest 30/.test(exams[0] ?? "") && /Too late for the \d+ new cards/.test(exams[1] ?? "") && !/review-only/.test((exams[0] ?? "") + (exams[1] ?? "")) && !/Set \d+ a day/.test(exams[1] ?? ""), exams.slice(0, 2).join(" || ").replace(/\n/g, " | "));
    ok("01-10 finishing after the exam: says how many will still be new on the day", /after the exam \(about \d+ will still be new on the day\)/.test(exams[2] ?? ""), (exams[2] ?? "").replace(/\n/g, " | "));
    await shot(p, "cardio-paper-1440");
    await p.locator(".coach-row button.stack", { hasText: "Tomorrow: finish Cardio" }).click(); await p.waitForSelector(".study .card-host", { timeout: 5000 }).catch(() => {});
    ok("01-9 …and the tap opens a real session (not an empty one)", (await p.locator(".study .card-host").count()) === 1);
    await ctx.close(); }

  // ---- 01-14: the empty state has actions, and a waiting pack comes first
  { const { ctx, p } = await ctxAt(null, { width: 360, height: 800 });
    ok("01-14 empty: Import from Anki and Write a card", (await p.locator(".today-empty button", { hasText: "Import from Anki" }).count()) === 1 && (await p.locator(".today-empty button", { hasText: "Write a card" }).count()) === 1);
    await p.evaluate(async (pk) => { const y = (window as any).yuzu; y.inbox = [{ file: "p.json", sha: "x", at: Date.now(), pack: pk }]; await y.saveSettings({}); }, pack("ib", "Medicine::Inbox", 3));
    await p.waitForTimeout(150);
    ok("01-14 …and Review the pack when one waits in the Inbox", (await p.locator(".today-empty button", { hasText: "Review the pack" }).count()) === 1 && !/Go to Settings/.test(await p.locator(".today-empty").innerText()));
    await shot(p, "empty-inbox-360");
    await p.locator(".today-empty button", { hasText: "Write a card" }).click(); ok("01-14 Write a card opens quick add", (await p.locator('[role=dialog][aria-label="Quick add"]').count()) === 1); await p.locator('[role=dialog][aria-label="Quick add"] [aria-label="Close editor"]').first().click(); await p.waitForTimeout(150);
    await p.locator(".today-empty button", { hasText: "Import from Anki" }).click(); await p.waitForTimeout(300);
    ok("01-14 Import from Anki opens Settings → Import", await p.evaluate(() => !!(document.getElementById("s-import") as HTMLDetailsElement | null)?.open));
    await ctx.close(); }

  // ---- 01-15: Vocab goes to the German deck you already have
  { const { ctx, p } = await ctxAt(null);
    await p.evaluate(async () => { const y = (window as any).yuzu; await y.importPack({ yuzu_pack: 1, id: "gk", category: "German::Klinik", cards: Array.from({ length: 6 }, (_, i) => ({ id: "g" + i, front: "Wort " + i, back: "word" })) }); await y.importPack({ yuzu_pack: 1, id: "ga", category: "German::Alltag", cards: [{ id: "a1", front: "Brot", back: "bread" }] }); });
    await p.click('[aria-label="Quick add a card"]'); await p.click('[role=radiogroup][aria-label="Card type"] >> text=Vocab');
    const deck = await p.locator('[aria-label="Deck"]').inputValue();
    ok("01-15 Vocab defaults to the biggest German deck (German::Klinik), not a new German::Vocab", deck === "German::Klinik", deck);
    await p.click('[role=radiogroup][aria-label="Card type"] >> text=Cloze');
    ok("01-15 …and back to Medicine::Inbox for cloze", (await p.locator('[aria-label="Deck"]').inputValue()) === "Medicine::Inbox");
    await ctx.close(); }

  // ---- 01-20: the ← Citrus chip only while the visit came from Citrus; an unknown action says so
  { const { ctx, p } = await ctxAt(null);
    await p.evaluate(async (pk) => { await (window as any).yuzu.importPack(pk); }, pack("ct", "Medicine::Citrus", 3));
    await p.goto(URL + "?from=citrus"); await p.waitForFunction(() => (window as any).yuzu?.loaded); await p.waitForTimeout(200);
    ok("01-20 ?from=citrus shows ← Citrus", (await p.locator(".back-citrus").count()) === 1);
    await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded); await p.waitForTimeout(200);
    ok("01-20 opening Yuzu directly afterwards drops the chip", (await p.locator(".back-citrus").count()) === 0);
    await p.goto(URL + "?from=citrus&do=bogus"); await p.waitForFunction(() => (window as any).yuzu?.loaded); await p.waitForTimeout(400);
    const snack = await p.locator(".kit-snack").innerText().catch(() => "");
    ok("01-20 an unknown do= says so", /bogus/.test(snack) && /doesn't know/.test(snack), snack);
    ok("01-20 …and the address is cleaned", !(await p.evaluate(() => location.search)));
    await ctx.close(); }
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails); process.exitCode = 1; }
  await browser.close(); server.kill();
}
