// WP18: Today keeps its numbers through display-only changes (sync status, progress, "w"), across tab switches, and
// recomputes on real data changes; the start-up Sketchy check runs once; Full backup writes the whole collection in chunks.
import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
const port = 5180 + Number(process.env.PORT_OFFSET ?? 0); const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const pack = { yuzu_pack: 1, id: "wp18", category: "Medicine::Speed", cards: Array.from({ length: 30 }, (_, i) => ({ id: "c" + i, front: `Speed question ${i}`, back: `answer ${i}`, ...(i < 3 ? { tags: ["Sketchy::Micro"] } : {}) })) };
try {
  for (const vp of [{ width: 412, height: 915 }, { width: 1440, height: 900 }]) {
    const ctx = await browser.newContext({ viewport: vp, acceptDownloads: true }); const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon|save failed/.test(m.text())) errors.push("console: " + m.text()); });
    await p.goto(`http://127.0.0.1:${port}/`); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
    await p.evaluate((pk) => (window as any).yuzu.importPack(pk), pack);
    await p.click("nav.tabs >> text=Today"); await p.waitForSelector("svg.ring");
    // count the expensive pieces from here on
    await p.evaluate(() => { const y = (window as any).yuzu; const w = (window as any); w.__q = 0; w.__t = 0; const q = y.queue.bind(y), t = y.tree.bind(y); y.queue = (...a: any[]) => { w.__q++; return q(...a); }; y.tree = (...a: any[]) => { w.__t++; return t(...a); }; });
    const lead = () => p.locator(".hero .lead").first().innerText();
    const before = await lead(); const dv = await p.evaluate(() => (window as any).yuzu.getDataVersion());
    await p.evaluate(async () => { const y = (window as any).yuzu; for (let i = 0; i < 5; i++) { y.uiBump(); y.setSync("syncing", "Sending " + i); y.fitting = { progress: i / 5 }; y.uiBump(); await new Promise((r) => requestAnimationFrame(r)); } y.fitting = null; y.setSync("idle", "Synced"); });
    const after = await p.evaluate(() => ({ q: (window as any).__q, dv: (window as any).yuzu.getDataVersion() }));
    ok(`${vp.width}px: sync status and progress redraw Today without recomputing the queue`, after.q === 0 && after.dv === dv && (await lead()) === before, JSON.stringify(after));
    await p.keyboard.press("w"); await p.waitForSelector(".sheet-backdrop", { timeout: 5000 });
    ok(`${vp.width}px: "w" opens the workload sheet without recomputing Today`, (await p.evaluate(() => (window as any).__q)) === 0 && (await p.locator(".sheet").count()) > 0);
    for (let i = 0; i < 4 && (await p.locator(".sheet-backdrop").count()); i++) { await p.keyboard.press("Escape"); await p.waitForTimeout(300); if (await p.locator(".sheet-backdrop").count()) { await p.mouse.click(5, 5); await p.waitForTimeout(300); } }
    await p.click("nav.tabs >> text=Library"); await p.waitForTimeout(200); await p.click("nav.tabs >> text=Today"); await p.waitForSelector("svg.ring");
    ok(`${vp.width}px: back on Today from another tab with nothing changed: nothing recomputed`, (await p.evaluate(() => (window as any).__q)) === 0);
    // a real change: answer a card → Today's numbers move
    const m0 = Number((before.match(/([\d,]+) cards/) ?? [])[1]?.replace(/,/g, ""));
    await p.evaluate(async () => { const y = (window as any).yuzu; const c = y.queue("")[0]; await y.answer(c.id, 3, 3000); });
    await p.waitForTimeout(200); const now = await lead(); const m1 = Number((now.match(/([\d,]+) cards/) ?? [])[1]?.replace(/,/g, ""));
    ok(`${vp.width}px: answering a card updates Today (ready ${m0} → ${m1})`, m1 === m0 - 1, now.slice(0, 80));
    if (vp.width === 412) {
      // start-up Sketchy check: strips once, then later starts skip the count while the notes are unchanged
      const s1 = await p.evaluate(async () => { const y = (window as any).yuzu; return { r: await y.stripSketchyOnce(), left: y.sketchyCount().notes }; });
      ok("Sketchy check strips the tagged notes", (s1.r === null || s1.r.notes === 3) && s1.left === 0, JSON.stringify(s1));
      const s2 = await p.evaluate(async () => { const y = (window as any).yuzu; let n = 0; const raw = y.sketchyCountRaw.bind(y); y.sketchyCountRaw = () => { n++; return raw(); }; y.sketchyMemo = null; await y.stripSketchyOnce(); await y.stripSketchyOnce(); return { n, clean: await y._db.getMeta("sketchyClean", "") }; });
      ok("…and a later start doesn't count Sketchy again (flag saved for these notes)", s2.n === 0 && !!s2.clean, JSON.stringify(s2));
      // Full backup: chunked file, same content
      await p.click("nav.tabs >> text=Settings"); await p.evaluate(() => document.querySelectorAll("details.section").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
      const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), p.locator("button", { hasText: "Full backup" }).first().click()]);
      const file = await dl.path(); const data = JSON.parse(fs.readFileSync(file!, "utf8"));
      const want = await p.evaluate(() => ({ cards: (window as any).yuzu.cards.size, notes: (window as any).yuzu.notes.size, reviews: (window as any).yuzu.reviews.length }));
      ok("Full backup downloads the whole collection", data.app === "yuzu" && data.cards.length === want.cards && data.notes.length === want.notes && data.reviews.length === want.reviews, `${data.cards?.length}/${want.cards}`);
    }
    await ctx.close();
  }
} catch (e: any) { fails.push("crash: " + e.message); console.log(e); }
finally { await browser.close(); server.kill(); }
if (errors.length) { console.log("page errors:", errors.slice(0, 5)); fails.push("page errors"); }
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed"); process.exit(fails.length ? 1 : 0);
