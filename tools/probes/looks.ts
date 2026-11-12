// Screenshots of every interface (Arcade / Clean / Paper) and text size on the real collection, for a design review.
// Usage: npx tsx tools/probes/looks.ts <profileDir (imported under port 4189)> <outDir> [uis=arcade,clean,paper] [width=412]
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const [dir, out] = [process.argv[2], process.argv[3]]; const UIS = (process.argv[4] ?? "arcade,clean,paper").split(","); const W = Number(process.argv[5] ?? 412);
const port = 4189; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" }); await new Promise((r) => setTimeout(r, 800));
const mobile = W < 700; const ctx = await chromium.launchPersistentContext(dir, { serviceWorkers: "block", viewport: { width: W, height: mobile ? 915 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
const page = ctx.pages()[0]; const errs: string[] = []; page.on("pageerror", (e) => errs.push(e.message));
const load = async () => { await page.goto(`http://127.0.0.1:${port}/`); await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/session/i.test(k)) localStorage.removeItem(k); }); await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 120000 }); await page.waitForTimeout(300); };
try {
  for (const ui of UIS) {
    const [mode, size = "normal"] = ui.split(":");
    await load(); await page.evaluate(([m, s]) => { localStorage.setItem("yuzu-ui", m); localStorage.setItem("yuzu-size", s); }, [mode, size]); await load();
    const tag = `${mode}${size !== "normal" ? "-" + size : ""}-${W}`;
    for (const t of ["Today", "Library", "Progress", "Settings"]) { await page.click(`nav.tabs >> text=${t}`); await page.waitForTimeout(250); await page.screenshot({ path: `${out}/${tag}-${t.toLowerCase()}.png` }); }
    await page.click("nav.tabs >> text=Today"); await page.click(".hero >> text=Study"); await page.waitForTimeout(400);
    if (await page.locator("button:has-text('Start')").first().isVisible().catch(() => false)) { await page.screenshot({ path: `${out}/${tag}-plan.png` }); await page.locator("button:has-text('Start')").first().click(); }
    await page.waitForSelector(".study .card-host", { timeout: 20000 }); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/${tag}-front.png` });
    await page.keyboard.press("Space"); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/${tag}-back.png` });
  }
} finally { console.log("errors:", errs.length ? errs : "none"); await ctx.close(); server.kill(); }
