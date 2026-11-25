// WP04 end to end, two devices on an in-memory Google whose Drive has no "My Apps" yet:
//  06-9  first connect makes one My Apps          06-14 three new images go up as one bundle
//  06-1  idle syncs on two devices push nothing   06-4  a sync right after another sees what the other device just pushed
//  06-15 an unreadable inbox file is shown in the Inbox and can be removed
//  06-13 a pack discarded offline is removed from Drive at the next sync
//  06-16 another app's capture taken on one device is listed on the other
import { chromium } from "playwright"; import { spawn } from "node:child_process";
import { fakeGoogle } from "../fake-google.ts";
const port = 5040 + Number(process.env.PORT_OFFSET ?? 0); const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const G = fakeGoogle(); const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const live = (name: string) => [...G.files.values()].filter((f) => f.name === name && !f.trashed);
const pack = { yuzu_pack: 1, id: "wp04", category: "Medicine::WP04", cards: Array.from({ length: 6 }, (_, i) => ({ id: "c" + i, front: `Question ${i}`, back: `answer ${i}` })) };
async function device(name: string) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } }); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + ": " + e.message));
  await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ status: 200, body: G.gisScript, contentType: "text/javascript" }));
  await page.route(/https:\/\/www\.googleapis\.com\/.*/, async (route) => {
    const req = route.request(); const h = await req.allHeaders(); const buf = req.postDataBuffer(); let res: Response;
    try { res = await G.fetchImpl(req.url(), { method: req.method(), headers: h, body: buf ? new Blob([buf as BlobPart]) : undefined } as any); } catch { await route.abort("connectionreset"); return; }
    await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("Content-Type") ?? "application/octet-stream" });
  });
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  await page.evaluate(async (n) => { await (window as any).yuzu.saveSettings({ deviceName: n }); }, name);
  return { page, ctx };
}
const waitSync = (p: any) => p.evaluate(async () => { const y = (window as any).yuzu; for (let i = 0; i < 100 && y.syncStatus.state === "syncing"; i++) await new Promise((r) => setTimeout(r, 100)); await y.sync("test"); for (let i = 0; i < 600 && y.syncStatus.state === "syncing"; i++) await new Promise((r) => setTimeout(r, 100)); return y.syncStatus; });
const idle = (p: any) => p.waitForFunction(() => { const y = (window as any).yuzu; return y.syncStatus.state !== "syncing" && !y.driveBusy; }, null, { timeout: 60000 });
const enc = (o: any) => new TextEncoder().encode(typeof o === "string" ? o : JSON.stringify(o));
try {
  const { page: A, ctx: ctxA } = await device("Phone");
  await A.evaluate((p) => (window as any).yuzu.importPack(p), pack);
  await A.click("nav.tabs >> text=Settings"); await A.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await A.click("button:has-text('Connect Google')");
  await A.waitForFunction(() => (window as any).yuzu?.syncBackend?.() === "drive", null, { timeout: 20000 });
  await A.waitForFunction(() => /media files on Drive/.test((window as any).yuzu.googleStatus.message), null, { timeout: 60000 }).catch(() => {});
  const s1 = await waitSync(A); await idle(A);
  for (let i = 0; i < 60 && !live("hub").length; i++) await A.waitForTimeout(250); // status.json (and so hub/) is written after the first good sync, a moment later
  ok("06-9: first connect on a Drive without My Apps makes exactly one", live("My Apps").length === 1 && live("Yuzu").length === 1 && live("hub").length === 1, `${live("My Apps").length} My Apps · ${live("Yuzu").length} Yuzu · ${live("hub").length} hub · ${s1.message}`);
  // ---- 06-14: three new pictures, one bundle (plus its table of contents)
  const b0 = [...G.files.values()].filter((f) => !f.trashed && f.props?.yzb === "1").length;
  await A.evaluate(async () => { const y = (window as any).yuzu; const add: any[] = []; for (let i = 0; i < 3; i++) { const blob = new Blob([new Uint8Array(700 + i * 800).fill(i + 1)], { type: "image/png" }); y.media.set(`wp04-${i}.png`, blob); add.push({ name: `wp04-${i}.png`, blob }); } await y._db.putMany("media", add); await y.googleRefresh("auto"); });
  await idle(A);
  const bundles = [...G.files.values()].filter((f) => !f.trashed && f.props?.yzb === "1").length - b0;
  ok("06-14: three new images make one bundle, not three", bundles === 1, `${bundles} bundles`);
  // ---- second device
  const { page: B } = await device("Deck");
  await B.click("nav.tabs >> text=Settings"); await B.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await B.click("button:has-text('Connect Google')"); await B.waitForFunction(() => (window as any).yuzu?.syncBackend?.() === "drive", null, { timeout: 20000 });
  const sB = await waitSync(B); ok("the second device pulls the collection", (await B.evaluate(() => (window as any).yuzu.cards.size)) === 6, sB.message);
  await idle(B); await idle(A);
  // ---- 06-1: settings differ only in per-device fields (name, theme): idle syncs push nothing
  await B.evaluate(() => (window as any).yuzu.saveSettings({ theme: "night", sfx: false })); await waitSync(B); await waitSync(A); await idle(A); await idle(B);
  const msgs: string[] = []; for (const p of [A, B, A, B]) msgs.push((await waitSync(p)).message);
  ok("06-1: two devices syncing in turn with nothing new push nothing", msgs.every((m) => m === "Up to date"), msgs.join(" | "));
  // ---- 06-4: A syncs, B pushes an edit, A syncs again at once: A must see the edit
  await waitSync(A);
  const t0 = Date.now();
  await B.evaluate(async () => { const y = (window as any).yuzu; const n = [...y.notes.values()].find((x: any) => x.fields[0] === "Question 0"); await y.updateNote(n.id, ["EDITED ON DECK", n.fields[1]], []); });
  const sB2 = await waitSync(B); const sA2 = await waitSync(A); const dt = Date.now() - t0;
  const seen = await A.evaluate(() => [...(window as any).yuzu.notes.values()].some((x: any) => x.fields[0] === "EDITED ON DECK"));
  ok("06-4: a sync soon after the last one pulls what the other device just pushed", seen && sA2.message !== "Up to date", `${sB2.message} → ${sA2.message} within ${dt} ms`);
  // ---- inbox: a junk file, a pack, and another app's capture
  G.seedFile("junk.json", ["My Apps", "Yuzu", "collection", "inbox"], enc('{"yuzu_pack":1,"cards":[{"front":"cut sh'), "application/json");
  G.seedFile("pack2.json", ["My Apps", "Yuzu", "collection", "inbox"], enc({ ...pack, id: "p2", name: "Pack two" }), "application/json");
  G.seedFile("orange-cap.json", ["My Apps", "Yuzu", "collection", "inbox"], enc({ yuzu_capture: 1, id: "o1", text: "Orange note about digoxin", app: "Orange" }), "application/json");
  await A.evaluate(() => (window as any).yuzu.sync("manual")); await idle(A);
  const st = await A.evaluate(() => ({ bad: (window as any).yuzu.inboxBad.map((x: any) => x.file), inbox: (window as any).yuzu.inbox.map((x: any) => x.file) }));
  ok("06-15: the unreadable file is kept as unreadable, the pack is offered", st.bad.join() === "junk.json" && st.inbox.join() === "pack2.json", JSON.stringify(st));
  await A.click("nav.tabs >> text=Settings"); await A.click("nav.tabs >> text=Today"); await A.waitForTimeout(300);
  await A.click("text=new pack from Claude"); await A.waitForSelector("text=1 file in your inbox couldn't be read");
  await A.click("button:has-text('Show text')"); ok("…Show text shows the file", (await A.locator(".wp04-bad-text").innerText()).includes("cut sh"));
  await A.screenshot({ path: "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad/wp04-inbox-412.png", fullPage: true });
  const shot = "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad/wp04-inbox";
  await A.setViewportSize({ width: 360, height: 800 }); await A.screenshot({ path: shot + "-360.png" });
  await A.evaluate(() => localStorage.setItem("yuzu-ui", "clean")); await A.setViewportSize({ width: 1440, height: 900 }); await A.reload(); await A.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  await A.click("text=new pack from Claude"); await A.waitForSelector("text=1 file in your inbox couldn't be read"); await A.click("button:has-text('Show text')"); await A.screenshot({ path: shot + "-1440-clean.png" });
  await A.evaluate(() => localStorage.removeItem("yuzu-ui")); await A.setViewportSize({ width: 412, height: 915 }); await A.reload(); await A.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  await A.click("text=new pack from Claude"); await A.waitForSelector("text=1 file in your inbox couldn't be read");
  await A.click("button.chip:has-text('Remove') >> nth=0"); await A.click(".sheet >> text=Remove file"); await A.waitForTimeout(800);
  ok("…Remove (after a confirmation) deletes it from Drive", live("junk.json").length === 0 && (await A.evaluate(() => (window as any).yuzu.inboxBad.length)) === 0);
  // ---- 06-13: discard the pack offline; the next good sync removes it from Drive
  await ctxA.setOffline(true);
  await A.evaluate(async () => { const y = (window as any).yuzu; await y.dismissInbox(y.inbox[0].sha); });
  ok("06-13: discarded offline — still on Drive for now", live("pack2.json").length === 1);
  await ctxA.setOffline(false); await A.waitForTimeout(300); await waitSync(A); await idle(A);
  ok("…the next sync removes it from Drive", live("pack2.json").length === 0);
  await waitSync(B); ok("…and the other device doesn't offer it", (await B.evaluate(() => (window as any).yuzu.inbox.length)) === 0);
  // ---- 06-16: Orange's capture was taken by the Phone; the Deck lists it
  await A.waitForFunction(() => true); for (let i = 0; i < 50 && !live("capture-capo1.json").length; i++) await new Promise((r) => setTimeout(r, 200));
  ok("Orange's capture is in the outbox for Claude, once", live("capture-capo1.json").length === 1 && live("orange-cap.json").length === 0);
  await B.click("nav.tabs >> text=Today"); await B.click("button:has-text('Capture')"); await B.waitForSelector("text=With Claude from your other devices", { timeout: 10000 }).catch(() => {});
  const txt = await B.evaluate(() => document.body.innerText);
  ok("06-16: the Deck shows the capture taken on the Phone", /Orange note about digoxin/.test(txt) && /kept on Phone/.test(txt), txt.match(/With Claude[\s\S]{0,120}/)?.[0] ?? "");
  await B.screenshot({ path: "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad/wp04-capture-412.png" });
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) { fails.push(String(e)); console.log("✗ crashed:", e); }
finally { await browser.close(); server.kill(); }
console.log(fails.length ? `FAILED: ${JSON.stringify(fails)}` : "all passed"); process.exit(fails.length ? 1 : 0);
