// WP14: the exam countdown on Today and the Progress labels, in the real app (with screenshots at phone and desktop widths).
import { chromium, type Page } from "playwright"; import { spawn } from "node:child_process";
const port = 5140 + Number(process.env.PORT_OFFSET ?? 0); const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`; const SHOTS = process.env.SHOTS ?? "";
const pack = (id: string, category: string, n: number) => ({ yuzu_pack: 1, id, category, cards: Array.from({ length: n }, (_, i) => ({ id: id + i, front: `${category} question ${i}`, back: `answer ${i}` })) });
async function setup(p: Page) {
  await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 30000 });
  for (const [id, cat, n] of [["de", "German::Klinik", 107], ["en", "Medicine::Endocrine", 300], ["mi", "Step 1::Micro", 300], ["ph", "Step 1::Pharm", 300], ["ca", "Medicine::Cardio", 300], ["re", "Medicine::Renal", 300], ["pa", "Step 1::Path", 300]] as const)
    await p.evaluate((pk) => (window as any).yuzu.importPack(pk), pack(id, cat, n));
  await p.evaluate(async () => { const y = (window as any).yuzu; const d = new Date(Date.now() + 30 * 86400000); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await y.saveSettings({ newPerDay: 12, deadlines: [{ id: "g", name: "Goethe B2", date: iso, path: "German", view: "decks" }] }); });
}
try {
  for (const [w, h, ui] of [[412, 915, "arcade"], [360, 800, "paper"], [1440, 900, "clean"]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${w}: ${e.message}`));
    await p.addInitScript((u) => { try { localStorage.setItem("yuzu-ui", u); } catch {} }, ui);
    await setup(p);
    const e = await p.evaluate(() => { const y = (window as any).yuzu; return y.examStatus(y.settings.deadlines[0], Date.now(), { setTo: true }); });
    if (w === 412) { ok("German gets 2 of 12 a day among 7 categories, so it is not on track", e.share === 2 && !e.onTrack && e.setTo > 12, JSON.stringify({ share: e.share, onTrack: e.onTrack, setTo: e.setTo, need: e.needPerDay })); }
    const box = p.locator(".card-box", { hasText: "Goethe B2" }).first(); await box.waitFor({ timeout: 15000 }); await box.scrollIntoViewIfNeeded();
    const txt = await box.innerText();
    ok(`${w}: the countdown says the real share and a dd/mm/yyyy date`, /gets about 2 of your 12 new cards a day/.test(txt) && /\d\d\/\d\d\/\d{4}, after the exam/.test(txt) && !/\d{4}-\d\d-\d\d/.test(txt), txt.replace(/\n/g, " | ").slice(0, 300));
    ok(`${w}: Set N a day raises the limit to what the exam really needs`, txt.includes(`Set ${e.setTo} a day`));
    if (SHOTS) await box.screenshot({ path: `${SHOTS}/wp14-today-${w}-${ui}.png` });
    await p.click("nav.tabs >> text=Progress").catch(async () => { await p.click("text=Progress"); });
    await p.waitForSelector("text=Last 7 days", { timeout: 15000 });
    const prog = await p.locator(".screen").innerText();
    ok(`${w}: Progress says "Last 7 days" and "seen"`, /Last 7 days/.test(prog) && !/This week/.test(prog) && /of \d[\d,]* seen/.test(prog), prog.slice(0, 200).replace(/\n/g, " | "));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/wp14-progress-${w}-${ui}.png`, fullPage: false });
    await ctx.close();
  }
  // the exam tomorrow: too late, no Set button
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } }); const p = await ctx.newPage(); await setup(p);
  await p.evaluate(async () => { const y = (window as any).yuzu; const d = new Date(Date.now() + 86400000 + 3 * 3600e3); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; await y.saveSettings({ deadlines: [{ id: "g", name: "Goethe B2", date: iso, path: "German", view: "decks" }] }); });
  const box = p.locator(".card-box", { hasText: "Goethe B2" }).first(); await box.waitFor({ timeout: 15000 }); const t2 = await box.innerText();
  ok("exam tomorrow: too late for new cards, and no Set button", /Too late for the 107 new cards: review the weakest 30/.test(t2) && !/Set \d+ a day/.test(t2), t2.replace(/\n/g, " | ").slice(0, 200));
  if (SHOTS) await box.screenshot({ path: `${SHOTS}/wp14-today-toolate.png` });
  await ctx.close();
} catch (e) { ok("no exception", false, String(e)); }
ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "));
await browser.close(); server.kill(); console.log(fails.length ? `${fails.length} FAILED` : "all passed"); process.exit(fails.length ? 1 : 0);
