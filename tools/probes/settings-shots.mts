// Screenshots of Settings (all groups open) at phone and desktop sizes, in each interface: node --import tsx tools/probes/settings-shots.mts <outdir> [tag]
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const out = process.argv[2]; const tag = process.argv[3] ?? "now"; const port = 5390;
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" }); await new Promise((r) => setTimeout(r, 800));
const b = await chromium.launch();
for (const [w, h] of [[412, 915], [1280, 800]] as const) for (const ui of ["arcade", "paper"]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage();
  await p.addInitScript((u) => { localStorage.setItem("yuzu-ui", u); }, ui);
  await p.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ status: 200, body: "window.google={accounts:{oauth2:{initTokenClient(){return{requestAccessToken(){}}}}}}", contentType: "text/javascript" }));
  await p.goto(`http://127.0.0.1:${port}/`); await p.waitForFunction(() => (window as any).yuzu?.loaded);
  await p.evaluate(() => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "s", category: "Medicine::Demo", cards: [{ id: "a", front: "Q", back: "A" }] }));
  await p.click("nav.tabs >> text=Settings"); await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/${tag}-${w}-${ui}-closed.png`, fullPage: true });
  await p.evaluate(() => document.querySelectorAll("details.section").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/${tag}-${w}-${ui}-open.png`, fullPage: true });
  await ctx.close();
}
await b.close(); server.kill();
