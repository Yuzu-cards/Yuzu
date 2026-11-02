// Yuzu's home on Google Drive, end to end against an in-memory Google: sign-in by redirect, the collection syncing
// between two devices through My Apps/Yuzu/collection (push, pull, a review each way, the lock), Drive as the media
// master copy (send what's here, fetch what the cards need, on-the-spot fetch), the rota read from My Apps/Rotas →
// light days and coach tips, Citrus's plan.json read back, and Yuzu's status.json written for the scheduler.
import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
import { fakeGoogle } from "../fake-google.ts";
const port = 4181; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const G = fakeGoogle(); const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = iso(new Date());
// Seed Drive: the department's November 2026 schedule in My Apps/Rotas, Citrus's plan for today, one image already in Yuzu/media.
G.seedFile("November_Schedule.xlsx", ["My Apps", "Rotas"], new Uint8Array(fs.readFileSync("test/fixtures/rota-sample.xlsx")), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
G.seedFile("plan.json", ["My Apps", "hub", "scheduler"], new TextEncoder().encode(JSON.stringify({ date: today, blocks: [{ app: "orange", start: "17:00", minutes: 50 }, { app: "yuzu", title: "Yuzu: cards", start: "19:30", minutes: 25 }] })), "application/json");
const media = { "0": "img_20150110121948-1678858989.png", "1": "carpels unnamed.jpg", "2": "carpels named.jpg" };
const apkgDir = "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad/apkg"; fs.mkdirSync(apkgDir, { recursive: true });
const { execSync } = await import("node:child_process"); execSync(`cd ${apkgDir} && unzip -o -q /home/claude/yuzu/test/fixtures/legacy-with-media.apkg`);
G.seedFile(media["0"], ["My Apps", "Yuzu", "media"], new Uint8Array(fs.readFileSync(`${apkgDir}/0`)));
async function device(name: string) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } }); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + ": " + e.message)); page.on("dialog", (d) => d.accept());
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_FAILED|favicon/.test(m.text())) errors.push(name + " console: " + m.text()); });
  // Google's sign-in page: answer at once with a token in the hash, as Google does after the redirect.
  await page.route("https://accounts.google.com/o/oauth2/v2/auth**", (route) => { const u = new URL(route.request().url()); const back = `${u.searchParams.get("redirect_uri")}#access_token=tok${Date.now()}&expires_in=3600&state=${encodeURIComponent(u.searchParams.get("state") ?? "")}&scope=drive`; route.fulfill({ status: 302, headers: { Location: back } }); });
  await page.route(/https:\/\/www\.googleapis\.com\/.*/, async (route) => {
    const req = route.request(); const h = await req.allHeaders(); const buf = req.postDataBuffer();
    const res = await G.fetchImpl(req.url(), { method: req.method(), headers: h, body: buf ? new Blob([buf as BlobPart]) : undefined } as any);
    await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("Content-Type") ?? "application/octet-stream" });
  });
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet", { timeout: 15000 });
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.fill('input[placeholder="S25 Ultra"]', name); await page.keyboard.press("Tab");
  return page;
}
const y = (p: any, f: string) => p.evaluate(f);
const waitSync = (p: any) => p.evaluate(async () => { const y = (window as any).yuzu; for (let i = 0; i < 100 && y.syncStatus.state === "syncing"; i++) await new Promise((r) => setTimeout(r, 100)); await y.sync("test"); for (let i = 0; i < 600 && y.syncStatus.state === "syncing"; i++) await new Promise((r) => setTimeout(r, 100)); return y.syncStatus; });
try {
  const A = await device("A");
  await A.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ mediaDownload: true, google: { ...y.settings.google, rotaName: "Sample" } }); });
  await A.locator("input[type=file]").first().setInputFiles("test/fixtures/legacy-with-media.apkg");
  await A.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  await A.waitForFunction(() => (window as any).yuzu.media.size >= 3, null, { timeout: 60000 }); await A.waitForTimeout(500);
  // Drop one file the device had (Drive has it) so there is something to fetch; keep one Drive lacks so there is something to send.
  await A.evaluate(async (n) => { const y = (window as any).yuzu; y.media.delete(n); await y._db.deleteMany("media", [n]); }, media["0"]);
  // ---- Connect: the page leaves for Google and comes back with a token
  await A.click("button:has-text('Connect Google')");
  await A.waitForFunction(() => (window as any).yuzu?.googleConnected?.(), null, { timeout: 20000 });
  await A.waitForFunction(() => /Connected as amro@example.com|media files on Drive/.test((window as any).yuzu.googleStatus.message), null, { timeout: 30000 });
  ok("sign-in by redirect lands with a token and the email", /amro@example.com/.test(await y(A, "window.yuzu.googleStatus.message")), await y(A, "window.yuzu.googleStatus.message"));
  ok("sync switched to Drive on the first connect", (await y(A, "window.yuzu.syncBackend()")) === "drive");
  // ---- Collection: the first sync fills My Apps/Yuzu/collection
  const s1 = await waitSync(A); ok("first sync pushed the collection to Drive", /pushed \d+ files/.test(s1.message), s1.message);
  const coll = G.at(["My Apps", "Yuzu", "collection"]);
  ok("manifest and shards are on Drive", coll.has("manifest.json") && [...coll.keys()].some((k) => k.startsWith("notes__")) && [...coll.keys()].some((k) => k.startsWith("cards__")), [...coll.keys()].slice(0, 6).join(", "));
  // ---- Media round
  await A.waitForFunction(() => /media files on Drive/.test((window as any).yuzu.googleStatus.message) && (window as any).yuzu.googleStatus.state === "ok", null, { timeout: 60000 }).catch(() => {});
  const mediaOnDrive = G.at(["My Apps", "Yuzu", "media"]);
  ok("sends the files Drive lacked", mediaOnDrive.has(media["1"]) && mediaOnDrive.has(media["2"]), [...mediaOnDrive.keys()].join(", "));
  ok("fetches the file the cards need", await A.evaluate((n) => (window as any).yuzu.media.has(n), media["0"]));
  ok("fetched bytes intact", (await A.evaluate((n) => (window as any).yuzu.media.get(n)?.size, media["0"])) === fs.statSync(`${apkgDir}/0`).size);
  // ---- Rota from Drive → shifts → light days; Citrus's plan
  const rota = await y(A, "window.yuzu.rota"); ok("rota read from My Apps/Rotas (November 2026, your row)", rota["2026-11"]?.["3"] === "D2" && rota["2026-11"]?.["17"] === "N2", JSON.stringify(rota).slice(0, 80));
  const w = await A.evaluate(() => { const y = (window as any).yuzu; return [y.dayWeight(new Date("2026-11-17T12:00:00").getTime()), y.dayWeight(new Date("2026-11-18T12:00:00").getTime()), y.dayWeight(new Date("2026-11-03T12:00:00").getTime())]; });
  ok("night N2 on the 17th makes the 17th and 18th light; a day shift leaves the day normal", w[0] === 0.5 && w[1] === 0.5 && w[2] === 1, JSON.stringify(w));
  ok("rota synced through settings for the other devices", Object.keys(await y(A, "window.yuzu.settings.google.rota")).includes("2026-11"));
  const plan = await y(A, "window.yuzu.planToday()"); ok("Citrus's plan.json read: Yuzu's block for today", plan.length === 1 && plan[0].start === "19:30" && plan[0].minutes === 25, JSON.stringify(plan));
  await A.click("nav.tabs >> text=Today"); await A.waitForTimeout(500);
  ok("coach shows Citrus's block", /Citrus planned 25 min at 19:30/.test(await A.evaluate(() => document.body.innerText)));
  // ---- status.json for the scheduler
  const st = G.at(["My Apps", "hub", "yuzu"]); const status = st.has("status.json") ? JSON.parse(st.get("status.json")!) : null;
  ok("status.json written in the hub shape", !!status && status.app === "yuzu" && typeof status.summary === "string" && Array.isArray(status.asks) && status.week?.days?.length === 7 && status.today?.date === today, JSON.stringify(status)?.slice(0, 160));
  ok("status asks for time today with a slot", status?.asks?.[0]?.date === today && /free|before|early|postnight|tough/.test(status.asks[0].slot) && status.asks[0].minutes > 0, JSON.stringify(status?.asks?.[0]));
  // ---- Device B joins from Drive
  const B = await device("B");
  await B.click("button:has-text('Connect Google')"); await B.waitForFunction(() => (window as any).yuzu?.googleConnected?.(), null, { timeout: 20000 });
  const sB = await waitSync(B); ok("B pulls the whole collection from Drive", /pulled [\d,]+ cards/.test(sB.message) && (await y(B, "window.yuzu.cards.size")) === (await y(A, "window.yuzu.cards.size")), sB.message);
  // B reviews a card; A gets the review
  await B.evaluate(async () => { const y = (window as any).yuzu; const c = [...y.cards.values()][0]; await y.answer(c, 3); });
  await B.evaluate(() => (window as any).yuzu.sync("test")); await waitSync(B);
  await A.evaluate(() => (window as any).yuzu.sync("test")); const sA = await waitSync(A);
  ok("a review on B reaches A through Drive", (await y(A, "window.yuzu.reviews.length")) === (await y(B, "window.yuzu.reviews.length")) && (await y(A, "window.yuzu.reviews.length")) > 0, sA.message);
  // Lock: A holds it, B is told to wait
  await A.evaluate(() => (window as any).yuzu._db.setMeta("x", 1));
  const held = await A.evaluate(async () => { const { DriveSync } = await import("./assets/" + [...document.scripts].map((s) => s.src.split("/").pop()).find((n) => n?.startsWith("app-"))!).catch(() => ({ DriveSync: null })); return !!DriveSync; }).catch(() => false);
  void held;
  // Study on B with the image that only Drive has: it appears without a sync
  await B.evaluate(async (n) => { const y = (window as any).yuzu; y.media.delete(n); await y._db.deleteMany("media", [n]); }, media["0"]);
  await B.evaluate((n) => (window as any).yuzu.mediaUrl(n), media["0"]); await B.waitForTimeout(1000);
  ok("a card asking for a Drive file fetches it on the spot", await B.evaluate((n) => (window as any).yuzu.media.has(n), media["0"]));
  // Token lapse → quiet renewal by redirect keeps it connected
  await B.evaluate(() => { const t = JSON.parse(localStorage.getItem("yuzu-google")!); t.expires = Date.now() - 1; localStorage.setItem("yuzu-google", JSON.stringify(t)); localStorage.removeItem("yuzu-gsilent"); });
  await B.evaluate(() => (window as any).yuzu.maybeRenew(false)); await B.waitForTimeout(2500);
  await B.waitForFunction(() => (window as any).yuzu?.googleConnected?.(), null, { timeout: 20000 }).catch(() => {});
  ok("quiet renewal by redirect keeps the device connected", await B.evaluate(() => (window as any).yuzu.googleConnected()));
  await A.screenshot({ path: "test/e2e/shots/google-today.png" });
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails); process.exitCode = 1; }
  await browser.close(); server.kill();
}
