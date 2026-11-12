// Edge cases a real phone meets: Yuzu open in two tabs, storage full, starting offline, midnight passing during a session.
import { chromium, type Page, type BrowserContext } from "playwright"; import { spawn } from "node:child_process";
const port = 4184; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`;
async function open(ctx: BrowserContext, label: string, wait = true): Promise<Page> {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(label + ": " + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon|save failed/.test(m.text())) errors.push(label + " console: " + m.text()); });
  await p.goto(URL); if (wait) await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 }); return p;
}
const pack = { yuzu_pack: 1, id: "edge", category: "Medicine::Edge", cards: Array.from({ length: 12 }, (_, i) => ({ id: "c" + i, front: `Edge question ${i}`, back: `answer ${i}` })) };
try {
  // ---- Two tabs: the second waits; "Use Yuzu here" moves the collection across; the first stops writing
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const A = await open(ctx, "A"); await A.evaluate((p) => (window as any).yuzu.importPack(p), pack);
  const B = await open(ctx, "B", false); await B.waitForSelector("text=Open in another tab", { timeout: 10000 });
  ok("a second tab doesn't open the collection while the first has it", !(await B.evaluate(() => (window as any).yuzu.loaded)));
  await A.evaluate(async () => { const y = (window as any).yuzu; const c = [...y.cards.values()][0]; await y.answer(c.id, 3, 2000); });
  await B.click("text=Use Yuzu here"); await B.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 15000 });
  ok("Use Yuzu here opens it in the second tab, with what the first saved", await B.evaluate(() => (window as any).yuzu.reviews.length === 1 && (window as any).yuzu.cards.size === 12));
  await A.waitForSelector("text=Open in another tab", { timeout: 10000 }); await A.waitForTimeout(1200); await A.waitForSelector("text=Open in another tab", { timeout: 10000 });
  ok("…and the first tab steps aside (nothing stale left to write)", !(await A.evaluate(() => (window as any).yuzu?.loaded ?? false)));
  await B.evaluate(async () => { const y = (window as any).yuzu; const n = [...y.notes.keys()][0]; await y.deleteNotes([n]); });
  await A.click("text=Use Yuzu here"); await A.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 15000 });
  const back = await A.evaluate(async () => { const y = (window as any).yuzu; return { notes: y.notes.size, tomb: Object.keys(await y._db.getMeta("tombstones", {})).length, reviews: y.reviews.length }; });
  ok("…and back again: the deletion made in the other tab is kept, with its tombstone", back.notes === 11 && back.tomb >= 1 && back.reviews === 1, JSON.stringify(back));
  await ctx.close();
  // ---- Storage full: a failing write is said plainly
  const c2 = await browser.newContext({ viewport: { width: 412, height: 915 } }); const S = await open(c2, "S"); await S.evaluate((p) => (window as any).yuzu.importPack(p), pack);
  await S.evaluate(() => { const orig = IDBObjectStore.prototype.put; (window as any).__full = true; IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...a: any[]) { if ((window as any).__full) throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); return (orig as any).apply(this, a); } as any; });
  await S.evaluate(async () => { const y = (window as any).yuzu; const c = [...y.cards.values()][1]; await y.answer(c.id, 3, 2000); }).catch(() => {});
  await S.waitForTimeout(300); const toast = await S.locator(".toast").innerText().catch(() => "");
  ok("storage full shows a plain banner with a way to keep a copy", /storage for Yuzu is full/.test(toast) && /Back up now/.test(toast), toast.slice(0, 120));
  await S.evaluate(async () => { (window as any).__full = false; const y = (window as any).yuzu; const c = [...y.cards.values()][2]; await y.answer(c.id, 3, 2000); }); await S.waitForTimeout(300);
  ok("…and it clears once a save works again", (await S.locator(".toast:has-text('storage')").count()) === 0);
  await c2.close();
  // ---- Offline start: once loaded, the app opens with no connection, and studying works
  const c3 = await browser.newContext({ viewport: { width: 412, height: 915 } }); const O = await open(c3, "O"); await O.evaluate((p) => (window as any).yuzu.importPack(p), pack);
  await O.evaluate(async () => { const r = await navigator.serviceWorker.ready; for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((x) => setTimeout(x, 100)); return !!r; });
  await O.reload(); await O.waitForFunction(() => (window as any).yuzu?.loaded && !!navigator.serviceWorker.controller, null, { timeout: 20000 });
  await c3.setOffline(true); await O.reload(); await O.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 }).catch(() => {});
  ok("opens offline from the app cache", await O.evaluate(() => !!(window as any).yuzu?.loaded).catch(() => false));
  const off = await O.evaluate(async () => { const y = (window as any).yuzu; const c = [...y.cards.values()].find((c: any) => c.state === "new"); await y.answer(c.id, 3, 1500); return y.reviews.length; }).catch(() => -1);
  ok("…and a card can be studied offline", off >= 1, String(off)); await c3.setOffline(false); await c3.close();
  // ---- Midnight: the day turns over during an open session (day starts at 04:00 by default; pinned clock)
  const c4 = await browser.newContext({ viewport: { width: 412, height: 915 }, timezoneId: "Asia/Riyadh" }); const M = await c4.newPage();
  M.on("pageerror", (e) => errors.push("M: " + e.message));
  await M.clock.install({ time: new Date("2026-11-12T03:50:00+03:00") }); await M.goto(URL); await M.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  await M.evaluate((p) => (window as any).yuzu.importPack(p), pack);
  const d1 = await M.evaluate(async () => { const y = (window as any).yuzu; for (const c of [...y.cards.values()].slice(0, 3)) await y.answer(c.id, 3, 1500); return { start: new Date(y.dayStart()).toISOString(), today: y.stats().today }; });
  ok("before 04:00 the reviews count for the previous study day", d1.start === "2026-11-11T01:00:00.000Z" && d1.today === 3, JSON.stringify(d1));
  await M.clock.runFor(15 * 60 * 1000); await M.waitForTimeout(200);
  const d2 = await M.evaluate(() => { const y = (window as any).yuzu; return { start: new Date(y.dayStart()).toISOString(), today: y.stats().today }; });
  ok("after 04:00 a new day starts without reopening the app", d2.start === "2026-11-12T01:00:00.000Z" && d2.today === 0, JSON.stringify(d2));
  await M.click("nav.tabs >> text=Today"); const txt = await M.locator(".screen").innerText();
  ok("…and Today shows the new day (0 reviews today)", /\b0\s*\n?\s*reviews today/.test(txt), txt.slice(0, 160).replace(/\n/g, " | "));
  await c4.close();
  // ---- Interfaces and layout: Paper sticks from the first paint; the jump row opens a group; a desktop gets the side rail
  const c5 = await browser.newContext({ viewport: { width: 412, height: 915 } }); const L = await open(c5, "L"); await L.evaluate((p) => (window as any).yuzu.importPack(p), pack);
  await L.click("nav.tabs >> text=Settings"); await L.click('[aria-label="Interface"] >> text=Paper');
  ok("choosing Paper switches the interface at once", (await L.evaluate(() => document.documentElement.dataset.ui)) === "paper");
  await L.reload(); const first = await L.evaluate(() => ({ ui: document.documentElement.dataset.ui, bg: getComputedStyle(document.body).backgroundColor }));
  ok("…and it is there from the first paint after a reload (light background)", first.ui === "paper" && first.bg === "rgb(243, 244, 249)", JSON.stringify(first));
  await L.waitForFunction(() => (window as any).yuzu?.loaded); await L.click("nav.tabs >> text=Settings"); await L.click('[aria-label="Text size"] >> text=Large');
  ok("text size Large scales the reading area", (await L.evaluate(() => getComputedStyle(document.querySelector(".screen")!).zoom)) === "1.15");
  await L.click('.jump-row >> text=Reminders'); await L.waitForTimeout(600);
  ok("the jump row opens and scrolls to a group", await L.evaluate(() => { const d = document.getElementById("s-remind") as HTMLDetailsElement; const r = d.getBoundingClientRect(); return d.open && r.top < innerHeight - 150 && r.top > -5; }), String(await L.evaluate(() => { const d = document.getElementById("s-remind") as HTMLDetailsElement; return d.open + " " + Math.round(d.getBoundingClientRect().top) + " " + scrollY; })));
  ok("each group says whether it syncs or stays on this device", (await L.locator("details.section > summary .where").count()) >= 10);
  await L.setViewportSize({ width: 1280, height: 860 }); await L.click("nav.tabs >> text=Today"); await L.waitForTimeout(200);
  const rail = await L.evaluate(() => { const n = (document.querySelector("nav.tabs") as HTMLElement).getBoundingClientRect(); const c = document.querySelector(".today-cols"); return { w: Math.round(n.width), h: Math.round(n.height), cols: c ? getComputedStyle(c).gridTemplateColumns.split(" ").length : 0 }; });
  ok("on a desktop the tabs become a side rail and Today has two columns", rail.w === 96 && rail.h >= 800 && rail.cols === 2, JSON.stringify(rail));
  await c5.close();
  // ---- A card forgotten again and again goes to Claude by itself (the default since 12/11/2026)
  const c6 = await browser.newContext({ viewport: { width: 412, height: 915 } }); const LC = await open(c6, "LC"); await LC.evaluate((p) => (window as any).yuzu.importPack(p), pack);
  const lch = await LC.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ leechThreshold: 2 }); const c = [...y.cards.values()][0];
    for (let i = 0; i < 3; i++) { const cur = y.cards.get(c.id); y.cards.set(c.id, { ...cur, state: "review", step: 0, stability: 5, reps: Math.max(3, cur.reps), due: Date.now() - 1000, lastReview: Date.now() - 5 * 86400000 }); await y.answer(c.id, 1, 1500); }
    await new Promise((r) => setTimeout(r, 200)); const m = y.improveFor(c.nid); return { lapses: y.cards.get(c.id).lapses, reasons: m?.r, text: m?.t, inList: y.improveList().some((x: any) => x.note.id === c.nid), plan: y.settings.planScreen, streak: y.settings.showStreak, citrus: y.settings.citrusPlans, retire: y.settings.retireAutoYears }; });
  ok("a leech is marked for Claude to rewrite (it goes out through the Drive outbox)", lch.lapses >= 2 && lch.inList && lch.reasons?.includes("confusion") && /Forgotten \d+ times/.test(lch.text ?? ""), JSON.stringify(lch));
  ok("the Q&A defaults: no 'how long?' screen, no streak, Citrus reads only, retiring on a tap", lch.plan === false && lch.streak === false && lch.citrus === false && lch.retire === 0);
  await c6.close();
  // ---- Sketchy out: fields named Sketchy… emptied, sketchy tags dropped, a copy kept to put back; an import can't bring it back
  const c7 = await browser.newContext({ viewport: { width: 412, height: 915 } }); await c7.addInitScript("window.__name = (f) => f"); /* tsx names inner arrow functions */ const SK = await open(c7, "SK");
  const sk = await SK.evaluate(async () => { const y = (window as any).yuzu; const now = Date.now();
    const nt = { id: "ak", name: "AnKingOverhaul", kind: "cloze", css: "", fields: ["Text", "Extra", "Sketchy", "Sketchy 2", "Pathoma"], templates: [{ name: "Cloze", qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}<br>{{Extra}}" }] };
    y.notetypes.set("ak", nt); await y._db.putMany("notetypes", [nt]);
    const mk = (i: number, sketchy: boolean) => ({ id: "n" + i, ntid: "ak", guid: "g" + i, fields: [`Fact {{c1::${i}}}`, "extra", sketchy ? "<img src=sk.jpg> Sketchy story" : "", sketchy ? "more" : "", "pathoma"], tags: sketchy ? ["#AK_Step1_v12::^Resources::Sketchy::Micro", "cardio"] : ["cardio"], created: now, modified: now });
    const notes = [mk(1, true), mk(2, true), mk(3, false)]; for (const n of notes) y.notes.set(n.id, n); await y._db.putMany("notes", notes);
    const before = y.sketchyCount(); const r = await y.stripSketchyOnce(); const n1 = y.notes.get("n1");
    const after = y.sketchyCount(); const kept = await y.sketchyBackupSize(); const back = await y.restoreSketchy(); const n1b = y.notes.get("n1");
    return { before, r, after, kept, n1: { f2: n1.fields[2], f3: n1.fields[3], f4: n1.fields[4], tags: n1.tags }, back, n1b: { f2: n1b.fields[2], tags: n1b.tags }, keep: y.keepSketchy, again: await y.stripSketchyOnce() }; });
  ok("Sketchy fields are emptied and sketchy tags dropped; other fields and tags untouched", sk.before.notes === 2 && sk.r?.notes === 2 && sk.after.notes === 0 && sk.n1.f2 === "" && sk.n1.f3 === "" && sk.n1.f4 === "pathoma" && sk.n1.tags.join() === "cardio", JSON.stringify(sk).slice(0, 300));
  ok("…a copy stays on this device, and Put Sketchy back restores it (and keeps it from being stripped again)", sk.kept === 2 && sk.back === 2 && /Sketchy story/.test(sk.n1b.f2) && sk.n1b.tags.some((t: string) => /Sketchy/.test(t)) && sk.keep === true && sk.again === null);
  await c7.close();
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails); process.exitCode = 1; }
  await browser.close(); server.kill();
}
