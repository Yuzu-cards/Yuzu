// Google layer end to end against an in-memory Google: connect, Drive as the media master copy (upload what's here,
// fetch what a card needs, on-the-spot fetch while studying), the shift calendar → light days and coach tips, and
// study blocks written back. Fails on any JavaScript error.
import { chromium } from "playwright"; import { spawn } from "node:child_process";
import { fakeGoogle } from "../fake-google.ts";
const port = 4181; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const G = fakeGoogle(); const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); const in3 = new Date(); in3.setDate(in3.getDate() + 3);
G.seedEvent("Night shift ER", `${iso(tomorrow)}T19:00:00+03:00`, `${iso(tomorrow)}T07:00:00+03:00`);
const in4 = new Date(in3); in4.setDate(in4.getDate() + 1); G.seedEvent("Day shift", iso(in3), iso(in4), true); // all-day: exclusive end, as Google sends it
G.seedEvent("Dentist", `${iso(in3)}T10:00:00+03:00`, `${iso(in3)}T11:00:00+03:00`);
// Drive already holds one of the fixture's images (as if the phone had sent it); the device will lack it until fetched.
import fs from "node:fs"; import { execSync } from "node:child_process";
const tmp = "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad/apkg"; fs.mkdirSync(tmp, { recursive: true }); execSync(`cd ${tmp} && unzip -o -q ../../../../../../home/claude/yuzu/test/fixtures/legacy-with-media.apkg`);
const media = JSON.parse(fs.readFileSync(`${tmp}/media`, "utf8")) as Record<string, string>;
const onDrive = Object.entries(media)[0]; G.seedFile(onDrive[1], "media", new Uint8Array(fs.readFileSync(`${tmp}/${onDrive[0]}`)));
async function device(name: string) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } }); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + ": " + e.message)); page.on("dialog", (d) => d.accept());
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_FAILED|favicon/.test(m.text())) errors.push(name + " console: " + m.text()); });
  await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ status: 200, body: G.gisScript, contentType: "text/javascript" }));
  await page.route(/https:\/\/www\.googleapis\.com\/.*/, async (route) => {
    const req = route.request(); const h = await req.allHeaders(); const buf = req.postDataBuffer();
    const res = await G.fetchImpl(req.url(), { method: req.method(), headers: h, body: buf ? new Blob([buf as BlobPart]) : undefined } as any);
    await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("Content-Type") ?? "application/octet-stream" });
  });
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet", { timeout: 15000 });
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  return page;
}
try {
  const A = await device("A");
  // Import the fixture WITHOUT its media (collection only): the cards reference 3 files the device lacks.
  await A.evaluate(async () => { const y = (window as any).yuzu; await y.saveSettings({ mediaDownload: true }); });
  await A.locator("input[type=file]").first().setInputFiles("test/fixtures/legacy-with-media.apkg");
  await A.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  // The import brought the 3 files in; drop two so Drive has something to give and the device something to send.
  const names = Object.values(media);
  await A.waitForFunction(() => (window as any).yuzu.media.size >= 3, null, { timeout: 60000 }); await A.waitForTimeout(500);
  await A.evaluate(async (ns) => { const y = (window as any).yuzu; const db = y._db; for (const n of ns) { y.media.delete(n); } await db.deleteMany("media", ns); y.mediaUrls?.clear?.(); }, [onDrive[1], names[1]]);
  const localOnly = names[2];
  // Connect
  await A.fill('input[placeholder="….apps.googleusercontent.com"]', "123.apps.googleusercontent.com"); await A.keyboard.press("Tab"); await A.waitForTimeout(200);
  await A.click("button:has-text('Connect Google')");
  await A.waitForFunction(() => /files on Drive/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
  const status = await A.evaluate(() => (window as any).yuzu.googleStatus);
  ok("connects and lists Drive", /amro@example.com/.test(status.message) && /files on Drive/.test(status.message), status.message);
  const st = await A.evaluate(() => (window as any).yuzu.driveState());
  ok("Drive index complete", st?.complete === true, JSON.stringify(st));
  // Background round: the local-only file went up, the Drive-only file came down
  await A.waitForFunction((n) => (window as any).yuzu.media.has(n), onDrive[1], { timeout: 20000 }).catch(() => {});
  const up = [...G.files.values()].some((f) => f.name === localOnly);
  ok("sends a file Drive lacked", up, [...G.files.values()].map((f) => f.name).join(", "));
  ok("fetches a file the cards need", await A.evaluate((n) => (window as any).yuzu.media.has(n), onDrive[1]));
  const sizeOk = await A.evaluate(async (n) => (window as any).yuzu.media.get(n)?.size, onDrive[1]) === fs.statSync(`${tmp}/${onDrive[0]}`).size;
  ok("fetched bytes intact", sizeOk);
  ok("the missing third file is not invented", !(await A.evaluate((n) => (window as any).yuzu.media.has(n), names[1])));
  // Calendar → shifts → weights → coach
  const shifts = await A.evaluate(() => (window as any).yuzu.shifts);
  ok("reads shifts from the calendar (night + day, not the dentist)", shifts.length === 2 && shifts.some((s: any) => s.night) && !shifts.some((s: any) => /Dentist/.test(s.title)), JSON.stringify(shifts.map((s: any) => s.title)));
  const w = await A.evaluate((t) => { const y = (window as any).yuzu; return [y.dayWeight(new Date(t + "T12:00:00").getTime()), y.dayWeight(new Date(t + "T12:00:00").getTime() + 86400000)]; }, iso(tomorrow));
  ok("night shift makes tomorrow and the morning after light", w[0] === 0.5 && w[1] === 0.5, JSON.stringify(w));
  await A.click("nav.tabs >> text=Today"); await A.waitForTimeout(500);
  ok("coach: night shift tomorrow", /Night shift tomorrow/.test(await A.evaluate(() => document.body.innerText)));
  ok("Settings lists the calendars", (await A.evaluate(() => (window as any).yuzu.calendars.length)) === 2);
  // Study blocks skip the night-shift days
  const before = G.events.length; const n = await A.evaluate(() => (window as any).yuzu.addStudyBlocks(7));
  ok("study blocks written for the week, skipping the night and the morning after", n === 5 && G.events.length === before + 5, `${n} added`);
  ok("block has the Yuzu title and 25 min", G.events.slice(before).every((e: any) => /Yuzu/.test(e.summary) && new Date(e.end.dateTime).getTime() - new Date(e.start.dateTime).getTime() === 25 * 60000));
  // Study a card whose image is on Drive but not here: it appears without a sync
  await A.evaluate(async (n) => { const y = (window as any).yuzu; y.media.delete(n); await y._db.deleteMany("media", [n]); y.mediaUrls?.clear?.(); }, onDrive[1]);
  await A.evaluate(() => (window as any).yuzu.mediaUrl("nonexistent.png"));
  await A.evaluate((n) => (window as any).yuzu.mediaUrl(n), onDrive[1]); await A.waitForTimeout(800);
  ok("a card asking for a Drive file fetches it on the spot", await A.evaluate((n) => (window as any).yuzu.media.has(n), onDrive[1]));
  // Token expiry → a tap is needed → the coach says so
  await A.evaluate(() => { const t = JSON.parse(localStorage.getItem("yuzu-google")!); t.expires = Date.now() - 1; localStorage.setItem("yuzu-google", JSON.stringify(t)); });
  await A.evaluate(() => (window as any).yuzu.googleRefresh("test"));
  await A.waitForTimeout(300); const st2 = await A.evaluate(() => (window as any).yuzu.googleStatus);
  ok("silent renewal keeps it connected", st2.state !== "error", st2.message);
  await A.screenshot({ path: "test/e2e/shots/google-settings.png", fullPage: false });
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails); process.exitCode = 1; }
  await browser.close(); server.kill();
}
