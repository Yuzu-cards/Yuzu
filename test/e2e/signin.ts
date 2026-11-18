// Google sign-in on browsers that block or lose Google's window (the Steam Deck, 18/11/2026), on an in-memory Google:
//  - a device that never signed in, with Google's script slow to load: the first tap on Connect opens the window inside
//    the tap (a strict browser blocks a window opened later), and the token client is built once
//  - "window closed" before the answer: a late token is kept for 8 s, and no second window is opened
//  - "window closed" with no answer, or a blocked window: the device switches to "In this page" and says so
//  - "In this page": Yuzu goes to Google and comes back; the token is kept, wiped from the address, Drive becomes home
//  - an answer in the address that this device didn't ask for is ignored; a sync or pull-down never leaves the page
import { chromium, type Page } from "playwright"; import { spawn } from "node:child_process";
import { fakeGoogle } from "../fake-google.ts";
const port = 5300 + Number(process.env.PORT_OFFSET ?? 0); const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const BASE = `http://127.0.0.1:${port}/`;
const G = fakeGoogle(); const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const SCOPE = "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email";
/** A stand-in for Google's script. `strict`: like a strict browser, a window may only open while the tap's event is still being handled. */
const gis = (how: "strict" | "closed-then-token" | "closed-no-token") => `window.__gis = { built: 0, opened: [] }; window.google = { accounts: { oauth2: { revoke() {}, hasGrantedAllScopes() { return true; },
  initTokenClient(o) { window.__gis.built++; return { requestAccessToken(r) {
    const inTap = !!(window.event && /click|pointerup|mouseup|keydown|touchend/.test(window.event.type)); window.__gis.opened.push({ inTap, prompt: (r || {}).prompt });
    const token = () => o.callback({ access_token: "tok" + Date.now(), expires_in: 3600, scope: "${SCOPE}" });
    if (${JSON.stringify(how)} === "strict") { if (!inTap) return setTimeout(() => o.error_callback({ type: "popup_failed_to_open" }), 10); return setTimeout(token, 20); }
    setTimeout(() => o.error_callback({ type: "popup_closed" }), 20);
    if (${JSON.stringify(how)} === "closed-then-token") setTimeout(token, 2500);
  } }; } } } };`;
async function device(how: Parameters<typeof gis>[0], { slowScript = 0, url = BASE } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://accounts.google.com/gsi/client", async (route) => { if (slowScript) await new Promise((r) => setTimeout(r, slowScript)); await route.fulfill({ status: 200, body: gis(how), contentType: "text/javascript" }); });
  await page.route(/https:\/\/www\.googleapis\.com\/.*/, async (route) => {
    const req = route.request(); const h = await req.allHeaders(); const buf = req.postDataBuffer(); let res: Response;
    try { res = await G.fetchImpl(req.url(), { method: req.method(), headers: h, body: buf ? new Blob([buf as BlobPart]) : undefined } as any); } catch { await route.abort("connectionreset"); return; }
    await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("Content-Type") ?? "application/octet-stream" });
  });
  // Google's own sign-in page: answers at once by sending the browser back to the return address with a token
  const asked: URL[] = [];
  await page.route(/https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth.*/, async (route) => {
    const u = new URL(route.request().url()); asked.push(u);
    const back = `${u.searchParams.get("redirect_uri")}#access_token=tokpage&token_type=Bearer&expires_in=3599&scope=${encodeURIComponent(SCOPE)}&state=${u.searchParams.get("state")}`;
    await route.fulfill({ status: 302, headers: { Location: back } });
  });
  await page.goto(url); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  return { page, ctx, asked };
}
const openGoogle = async (p: Page) => { await p.click("nav.tabs >> text=Settings"); await p.evaluate(() => { (document.getElementById("s-google") as HTMLDetailsElement).open = true; }); };
const connected = (p: Page) => p.evaluate(() => ({ on: (window as any).yuzu.googleConnected(), backend: (window as any).yuzu.syncBackend(), msg: (window as any).yuzu.googleStatus.message, mode: localStorage.getItem("yuzu-google-mode"), gis: (window as any).__gis }));
try {
  // ---- 1: a device that never signed in, Google's script slow to arrive, a strict browser
  { const { page, ctx } = await device("strict", { slowScript: 2500 });
    await page.waitForFunction(() => !!(window as any).__gis, null, { timeout: 15000 }); // the script arrived at start-up, before any tap
    await openGoogle(page); await page.click("button:has-text('Connect Google')");
    await page.waitForFunction(() => (window as any).yuzu.syncBackend() === "drive", null, { timeout: 15000 }).catch(() => {});
    const c = await connected(page);
    ok("never signed in, slow script: the first tap opens Google's window inside the tap", c.on && c.gis.opened.length === 1 && c.gis.opened[0].inTap, JSON.stringify(c.gis.opened) + " · " + c.msg);
    ok("…and Drive becomes this device's home", c.backend === "drive");
    ok("…the token client is built once, at start-up", c.gis.built === 1, `${c.gis.built} built`);
    await ctx.close(); }
  // ---- 2: "window closed" first, then the answer
  { const { page, ctx } = await device("closed-then-token");
    await page.waitForFunction(() => !!(window as any).__gis, null, { timeout: 15000 });
    await openGoogle(page); await page.click("button:has-text('Connect Google')");
    await page.waitForFunction(() => (window as any).yuzu.googleConnected(), null, { timeout: 15000 }).catch(() => {});
    const c = await connected(page);
    ok("\"window closed\" before the answer: the late token is kept", c.on, c.msg);
    ok("…no second window was opened, and the device stays on the small window", c.gis.opened.length === 1 && c.mode !== "page", `${c.gis.opened.length} windows · mode ${c.mode}`);
    await ctx.close(); }
  // ---- 3: "window closed" and nothing comes: switch to the page, say so
  { const { page, ctx } = await device("closed-no-token");
    await page.waitForFunction(() => !!(window as any).__gis, null, { timeout: 15000 });
    await openGoogle(page); await page.click("button:has-text('Connect Google')");
    await page.waitForFunction(() => localStorage.getItem("yuzu-google-mode") === "page", null, { timeout: 15000 }).catch(() => {});
    const shown = await page.locator("#s-google").innerText();
    const c = await connected(page);
    ok("a window that closes without an answer: after the 8 s grace the device switches to \"In this page\"", c.mode === "page" && !c.on, `mode ${c.mode}`);
    ok("…and says what to do in plain words", /opens in this page and comes back/.test(shown), shown.slice(0, 200));
    ok("…the choice shows as \"In this page\" with the last step", await page.locator("#s-google button[aria-pressed=true]:has-text('In this page')").count() === 1 && /Last step: .*window: popup_closed/.test(shown));
    await ctx.close(); }
  // ---- 4: "In this page": to Google and back
  { const { page, ctx, asked } = await device("strict");
    await openGoogle(page); await page.click("#s-google button:has-text('In this page')");
    await page.click("button:has-text('Connect Google')");
    await page.waitForFunction(() => (window as any).yuzu?.loaded && (window as any).yuzu.syncBackend() === "drive", null, { timeout: 20000 }).catch(() => {});
    const c = await connected(page); const url = page.url();
    const q = asked[0]?.searchParams;
    ok("\"In this page\": Yuzu goes to Google with this page as the return address", !!q && q.get("redirect_uri") === BASE && q.get("response_type") === "token" && (q.get("state") ?? "").length >= 16, asked[0]?.toString().slice(0, 160));
    ok("…comes back signed in, Drive becomes home", c.on && c.backend === "drive", c.msg);
    ok("…and the token is wiped from the address", !/access_token|tokpage/.test(url), url);
    ok("…no small window was ever opened", (c.gis?.opened?.length ?? 0) === 0);
    // the hour is up: a sync never leaves the page
    await page.evaluate(() => { const t = JSON.parse(localStorage.getItem("yuzu-google")!); t.expires = Date.now() - 1; localStorage.setItem("yuzu-google", JSON.stringify(t)); });
    const before = asked.length; await page.click("nav.tabs >> text=Today");
    await page.evaluate(() => (window as any).yuzu.renewOnTap()); await page.waitForTimeout(500);
    ok("in page mode a lapsed hour never leaves the page from a sync or a pull-down", asked.length === before && page.url().startsWith(BASE) && /Reconnect/.test(await page.evaluate(() => (window as any).yuzu.googleStatus.message)));
    await ctx.close(); }
  // ---- 5: an answer in the address this device didn't ask for
  { const { page, ctx } = await device("strict", { url: `${BASE}#access_token=evil&expires_in=3600&scope=${encodeURIComponent(SCOPE)}&state=forged` });
    const c = await connected(page); const stored = await page.evaluate(() => localStorage.getItem("yuzu-google"));
    ok("a token in the address that wasn't asked for is ignored and wiped", !c.on && !/evil/.test(stored ?? "") && !/evil/.test(page.url()), c.msg);
    await ctx.close(); }
  ok("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("✗ crashed:", e); fails.push("crash"); }
finally { await browser.close(); server.kill(); }
console.log(fails.length ? `FAILED ${fails.length}: ${fails.join("; ")}` : "all sign-in checks passed"); process.exit(fails.length ? 1 : 0);
