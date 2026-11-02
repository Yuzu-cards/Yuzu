// Two browser contexts ("devices") sync through an in-process fake GitHub.
import { chromium } from "playwright"; import { spawn } from "node:child_process";
import { fakeGitHub } from "../fake-github.ts";
const port = 8771; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const gh = fakeGitHub(); const browser = await chromium.launch(); const errors: string[] = [];
async function device(name: string) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } }); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + ": " + e.message));
  page.on("dialog", (d) => d.accept());
  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request(); const res = await gh.fetchImpl(req.url(), { method: req.method(), body: req.postData() ?? undefined } as any);
    await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), contentType: "application/octet-stream" });
  });
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForTimeout(2500);
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await page.waitForTimeout(400);
  await page.fill('input[placeholder="Yuzu-cards"]', "o"); await page.locator("label:has-text('Repository') + input, .field:has(label:has-text('Repository')) input").first().fill("r");
  await page.fill('input[placeholder="github_pat_…"]', "t"); await page.fill('input[placeholder="S25 Ultra"]', name);
  return page;
}
const status = (page: any) => page.evaluate(() => [...document.querySelectorAll("p.small")].map((p) => p.textContent ?? "").find((t) => /pushed|pulled|Up to date|Syncing|Download|Upload|rejected|Another|Offline|Conflict|GitHub \d/.test(t)));
const syncOf = async (p: any) => { await p.evaluate(async () => { const y = (window as any).yuzu; while (y.syncStatus.state === "syncing") await new Promise((r) => setTimeout(r, 100)); await y.sync(); }); };
const counts = (page: any) => page.evaluate(() => document.body.innerText.match(/[\d,]+ notes · [\d,]+ cards · [\d,]+ reviews/)?.[0]);
try {
  const A = await device("A");
  await A.locator('input[type=file]').first().setInputFiles("test/fixtures/medicine-legacy.apkg");
  await A.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  await A.click("text=Sync now"); await A.waitForFunction(() => /pushed \d+ files/.test(document.body.innerText), null, { timeout: 120000 });
  console.log("A first sync:", await status(A), "| commits", gh.commits(), "| files", Object.keys(gh.files()).length);
  const B = await device("B");
  await B.click("text=Sync now"); await B.waitForFunction(() => /pulled|Up to date/.test(document.body.innerText), null, { timeout: 120000 });
  console.log("B first sync:", await status(B), "|", await counts(B), "(A:", await counts(A) + ")");
  // B studies 3 cards, then leaves the app (visibility hidden → immediate sync)
  const study = async (page: any, ratings: string[]) => {
    await page.click("nav.tabs >> text=Today"); await page.waitForTimeout(300); await page.click(".hero >> text=Study"); await page.waitForTimeout(400);
    if (await page.locator("text=25 cards").count()) await page.click("text=25 cards");
    for (const r of ratings) { await page.click("text=Show answer"); await page.click(`.answer-bar .${r}`); await page.waitForTimeout(250); }
    await page.click('[aria-label="Close"]'); await page.waitForTimeout(300);
  };
  await study(B, ["good", "good", "good"]);
  await B.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); });
  await B.waitForTimeout(3000); await B.click("nav.tabs >> text=Settings"); await B.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await B.waitForTimeout(300);
  console.log("B after study + leave:", await status(B), "|", await counts(B));
  // A pulls B's reviews
  await A.click("text=Sync now"); await A.waitForFunction(() => /pulled \d+ cards, 3 reviews/.test(document.body.innerText), null, { timeout: 60000 });
  console.log("A pulled:", await status(A), "|", await counts(A));
  // Race: both change something and sync at the same time.
  await study(A, ["good"]); await study(B, ["again"]);
  await A.click("nav.tabs >> text=Settings"); await A.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await B.click("nav.tabs >> text=Settings"); await B.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await A.waitForTimeout(300);
  await Promise.all([A.click("text=Sync now"), B.click("text=Sync now")]);
  const settled = /pushed|Up to date|pulled|retry in a minute/;
  await A.waitForFunction((re) => re.test([...document.querySelectorAll("p.small")].map((p) => p.textContent).join(" ")) && !/Syncing/.test(document.body.innerText), settled, { timeout: 60000 });
  await B.waitForFunction((re) => re.test([...document.querySelectorAll("p.small")].map((p) => p.textContent).join(" ")) && !/Syncing/.test(document.body.innerText), settled, { timeout: 60000 });
  console.log("race — A:", await status(A)); console.log("race — B:", await status(B));
  await A.click("text=Sync now"); await A.waitForTimeout(2500); await B.click("text=Sync now"); await B.waitForTimeout(2500);
  console.log("after race — A:", await status(A), "|", await counts(A)); console.log("after race — B:", await status(B), "|", await counts(B));
  // Inbox: a pack dropped into inbox/ shows up on A after a sync, is reviewed with one card dropped, added, then removed.
  gh.drop("hyperk.yuzu.json", JSON.stringify({ yuzu_pack: 1, id: "test-pack", name: "Test pack", category: "Medicine::Specialties::Emergency Medicine::Test", cards: [{ id: "a", type: "cloze", text: "K+ > {{c1::5.0}}" }, { id: "b", type: "basic", front: "Q2", back: "A2" }, { id: "c", type: "basic", front: "Q3", back: "A3" }] }));
  await syncOf(A); await A.click("nav.tabs >> text=Today"); await A.waitForTimeout(300);
  console.log("inbox card:", await A.locator("text=1 new pack from Claude").count());
  await A.click("text=Review"); await A.waitForTimeout(300); await A.click("text=Test pack"); await A.waitForTimeout(300);
  await A.click("text=Q3"); await A.waitForTimeout(200); await A.click("text=Add 2 cards"); await A.waitForTimeout(1500);
  const n1 = await A.evaluate(() => (window as any).yuzu.notes.size); console.log("notes after add:", n1, "| inbox left:", await A.evaluate(() => (window as any).yuzu.inbox.length), "| repo inbox files:", Object.keys(gh.files()).filter((k) => k.startsWith("inbox/")).length);
  await A.click("text=Remove"); await A.waitForTimeout(300); await A.click(".kit-sheet .kit-item.danger"); await A.waitForTimeout(800); // the 8-bit confirm sheet
  console.log("notes after remove:", await A.evaluate(() => (window as any).yuzu.notes.size));
  await syncOf(B); console.log("B inbox after sync:", await B.evaluate(() => (window as any).yuzu.inbox.length), "B notes:", await B.evaluate(() => (window as any).yuzu.notes.size));
  // Undo survives sync: B reviews one card, syncs, undoes it, syncs; A must end up without that review.
  const revBefore = await A.evaluate(() => (window as any).yuzu.reviews.length);
  await study(B, ["good"]); await syncOf(B); await syncOf(A);
  console.log("A reviews after B's review:", await A.evaluate(() => (window as any).yuzu.reviews.length), "(before", revBefore + ")");
  await B.evaluate(() => (window as any).yuzu.undoLast()); await syncOf(B); await syncOf(A);
  console.log("A reviews after B's undo:", await A.evaluate(() => (window as any).yuzu.reviews.length), "(should be", revBefore + ")");
  // Shared images: A adds images from a deck file, turns sharing on, syncs; B receives them on its next sync.
  await A.click("nav.tabs >> text=Settings"); await A.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await A.waitForTimeout(300);
  await A.locator('input[type=file][accept*=apkg]').nth(1).setInputFiles("test/fixtures/legacy-with-media.apkg"); await A.waitForFunction(() => /^Added .*images/m.test(document.body.innerText), null, { timeout: 60000 });
  await A.evaluate(() => (window as any).yuzu.saveSettings({ mediaSync: true })); await syncOf(A);
  console.log("repo media files:", Object.keys(gh.files()).filter((k) => k.startsWith("media/")).length);
  await syncOf(B); await B.waitForTimeout(500); console.log("B images after sync:", await B.evaluate(() => (window as any).yuzu.media.size));
  // Hooks sync: A writes a personal note on a card; B sees it after a sync.
  const nid = await A.evaluate(() => (window as any).yuzu.notes.keys().next().value);
  await A.evaluate((id) => (window as any).yuzu.setHook(id, "my hook: picture a yuzu"), nid); await syncOf(A); await syncOf(B);
  console.log("hook on B:", await B.evaluate((id) => (window as any).yuzu.hookFor(id), nid));
  console.log("history A:", await A.evaluate(() => [...document.querySelectorAll("details:not(.how) li")].map((l) => l.textContent?.replace(/^.*· /, "")).slice(0, 4)));
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
