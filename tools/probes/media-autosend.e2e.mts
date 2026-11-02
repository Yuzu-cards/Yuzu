// PC with Anki's folder linked sends the phone what it's missing on each sync (fake GitHub; OPFS stands in for the folder).
import { chromium } from "playwright"; import { spawn } from "node:child_process";
import { fakeGitHub } from "../../test/fake-github.ts";
const port = 8783; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const gh = fakeGitHub(); const browser = await chromium.launch(); const errors: string[] = [];
async function device(name: string) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } }); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + ": " + e.message)); page.on("dialog", (d) => d.accept());
  await page.route("https://api.github.com/**", async (route) => { const req = route.request(); const res = await gh.fetchImpl(req.url(), { method: req.method(), body: req.postData() ?? undefined } as any); await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), contentType: "application/octet-stream" }); });
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForTimeout(2500);
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await page.waitForTimeout(400);
  await page.fill('input[placeholder="Yuzu-cards"]', "o"); await page.locator(".field:has(label:has-text('Repository')) input").first().fill("r");
  await page.fill('input[placeholder="github_pat_…"]', "t"); await page.fill('input[placeholder="S25 Ultra"]', name);
  return page;
}
const syncOf = async (p: any) => p.evaluate(async () => { const y = (window as any).yuzu; while (y.syncStatus.state === "syncing") await new Promise((r) => setTimeout(r, 100)); await y.sync(); return y.syncStatus.message; });
const media = (page: any) => page.evaluate(() => { const m = (window as any).yuzu.mediaStatus(); return `${m.images.stored}/${m.images.total} images, ${m.sounds.stored}/${m.sounds.total} sounds`; });
const addRefs = (page: any, from: number, to: number) => page.evaluate(`(async () => { const st = window.yuzu; const ns = [...st.notes.values()].slice(${from}, ${to}); for (let k = 0; k < ns.length; k++) { const i = ${from} + k; const n = ns[k]; const f = [...n.fields]; f[0] += i % 5 === 4 ? " [sound:wort " + i + ".mp3]" : ' <img src="Bild ' + i + '.png">'; await st.updateNote(n.id, f, n.tags); } })()`);
try {
  const PC = await device("PC Mokage");
  await PC.locator("input[type=file]").first().setInputFiles("test/fixtures/medicine-legacy.apkg");
  await PC.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 });
  // strip the fixture's own media refs so the test is about our files only
  await PC.evaluate(`(async () => { const st = window.yuzu; for (const n of [...st.notes.values()]) { const f = n.fields.map((x) => x.replace(/<img[^>]*>/gi, "").replace(/\\[sound:[^\\]]+\\]/g, "")); if (f.join() !== n.fields.join()) await st.updateNote(n.id, f, n.tags); } })()`);
  await addRefs(PC, 0, 60);
  await PC.evaluate(`(async () => { const root = await navigator.storage.getDirectory(); const d = await root.getDirectoryHandle("collection.media", { create: true }); const c = new OffscreenCanvas(1400, 1000); const g = c.getContext("2d");
    for (let i = 0; i < 120; i++) { const name = i % 5 === 4 ? "wort " + i + ".mp3" : "bild " + i + ".png"; let blob; if (name.endsWith(".mp3")) blob = new Blob([new Uint8Array(20000).fill(i)]); else { g.fillStyle = "hsl(" + i * 9 + ",60%,50%)"; g.fillRect(0, 0, 1400, 1000); blob = await c.convertToBlob({ type: "image/png" }); } const fh = await d.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(blob); await w.close(); }
    window.showDirectoryPicker = async (o) => o && o.id === "anki-media" ? d : root.getDirectoryHandle("Downloads", { create: true }); })()`);
  console.log("PC sync 1:", await syncOf(PC));
  const Phone = await device("S25 Ultra");
  console.log("Phone sync 1:", await syncOf(Phone), "·", await media(Phone));
  console.log("Phone sync 2 (publishes what it lacks):", await syncOf(Phone));
  // PC links the folder (one tap)
  await PC.click("text=1. Pick Anki's media folder"); await PC.waitForSelector("text=/Linked to/");
  console.log("PC UI:", await PC.evaluate(() => document.body.innerText.match(/✓ Linked[^\n]*/)?.[0]), "|", await PC.evaluate(() => document.body.innerText.match(/S25 Ultra: [^\n]*/)?.[0]));
  for (let i = 0; i < 4; i++) console.log(` PC sync: ${await syncOf(PC)}`);
  for (let i = 0; i < 3; i++) console.log(` Phone sync: ${await syncOf(Phone)} · ${await media(Phone)}`);
  // next time: new cards with new media on the PC (Anki update) → one PC sync + one phone sync
  await addRefs(PC, 60, 100); await PC.evaluate(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("collection.media"); for (let i = 60; i < 100; i++) { const name = i % 5 === 4 ? "wort " + i + ".mp3" : "bild " + i + ".png"; await d.getFileHandle(name).catch(() => null); } })()`);
  console.log("\nNEW CARDS ->", await syncOf(PC)); console.log(" phone:", await syncOf(Phone), "·", await media(Phone)); console.log(" PC:", await syncOf(PC)); console.log(" phone:", await syncOf(Phone), "·", await media(Phone)); console.log(" phone:", await syncOf(Phone), "·", await media(Phone));
  const ok = await Phone.evaluate(`(async () => { const u = window.yuzu.mediaUrl("Bild 70.png"); const im = new Image(); im.src = u; await im.decode(); return im.naturalWidth + "x" + im.naturalHeight + " " + window.yuzu.media.get("wort 74.mp3")?.type; })()`); console.log(" phone renders Bild 70.png:", ok);
  // the phone as master: a brand-new tablet (no Anki folder anywhere) gets its media from the phone
  await PC.evaluate(() => (window as any).yuzu.unlinkAnkiFolder());
  const Tab = await device("Tablet");
  console.log("\nTABLET:", await syncOf(Tab), "·", await media(Tab)); console.log(" tablet:", await syncOf(Tab));
  // new media the tablet wants that no one shared yet: make it so by giving the phone one extra file only it has
  await Phone.evaluate(`(async () => { const st = window.yuzu; const n = [...st.notes.values()][150]; await st.updateNote(n.id, [n.fields[0] + ' <img src="only-on-phone.png">', ...n.fields.slice(1)], n.tags); const c = new OffscreenCanvas(300, 200); c.getContext("2d").fillRect(0, 0, 300, 200); await st.addMediaFrom([new File([await c.convertToBlob({ type: "image/png" })], "only-on-phone.png")], {}); })()`);
  console.log(" phone:", await syncOf(Phone)); console.log(" tablet:", await syncOf(Tab)); console.log(" phone (serves):", await syncOf(Phone)); console.log(" tablet:", await syncOf(Tab), "·", await media(Tab));
  console.log(" debug phone:", await Phone.evaluate(() => { const y = (window as any).yuzu; return JSON.stringify({ has: y.media.has("only-on-phone.png"), wants: Object.values(y.mediaWants).map((w: any) => [w.device, w.total, w.missing.slice(0, 3)]), note: y.sendNote }); }));
  console.log(" debug tablet:", await Tab.evaluate(() => { const y = (window as any).yuzu; return JSON.stringify({ wants: Object.values(y.mediaWants).map((w: any) => [w.device, w.total, w.missing.slice(0, 3)]) }); }));
  console.log(" tablet has only-on-phone.png:", await Tab.evaluate(() => (window as any).yuzu.media.has("only-on-phone.png")));
  console.log("repo files:", Object.keys(gh.files()).filter((p) => p.startsWith("wants/") || p.startsWith("media/")).length);
} finally { console.log("errors:", errors.length ? errors : "none"); await browser.close(); server.kill(); }
