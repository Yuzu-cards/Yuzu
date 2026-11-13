// WP01: card HTML/CSS security in the real app — hostile deck HTML and note-type CSS go through import/restore and a
// study pass (front, answer, every link and button tapped), with the Yuzu skin and with the deck's own look.
import { chromium, type Page, type BrowserContext } from "playwright"; import { spawn } from "node:child_process";
const port = 5010 + Number(process.env.PORT_OFFSET ?? 0); const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`;
async function open(ctx: BrowserContext, label: string): Promise<Page> {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(label + ": " + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon|Failed to load resource/.test(m.text())) errors.push(label + " console: " + m.text()); });
  p.on("dialog", (d) => { errors.push(label + " dialog: " + d.message()); d.dismiss().catch(() => {}); });
  await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 }); return p;
}
const S = "top.__pwn=(top.__pwn||0)+1;try{top.__steal=JSON.stringify(top.yuzu.settings.sync)}catch(e){}";
const PAYLOADS = [
  `<iframe srcdoc="&lt;script&gt;${S.replace(/"/g, "&quot;")}&lt;/script&gt;"></iframe>`,
  `<img src="http://127.0.0.1:1/x.png"onerror="${S}">`,
  `<img src="http://127.0.0.1:1/x.png"/onerror="${S}">`,
  `<a class="tapme" href="jav&#x61;script:${S}">tap me</a>`,
  `<a class="tapme" href="java\tscript:${S}">tap me</a>`,
  `<form><button class="tapme" formaction="javascript:${S}">go</button></form>`,
  `<svg/onload="${S}"></svg><img/src=x/onerror=${S}>`,
  `<meta http-equiv="refresh" content="0;url=about:blank#hijacked">`,
];
const MED = "Symptom onset = 2 weeks before admission; dose given once = daily";
try {
  for (const style of ["yuzu", "deck"]) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } }); const p = await open(ctx, style);
    await p.evaluate(async ({ PAYLOADS, MED }) => {
      const y = (window as any).yuzu;
      await y.importPack({ yuzu_pack: 1, id: "xss", category: "Test::XSS", cards: [{ id: "med", front: MED, back: "K<sup>+</sup> &gt; 6.5 → calcium" }, ...PAYLOADS.map((h: string, i: number) => ({ id: "x" + i, front: "Q" + i + " " + h, back: "A" + i + " " + h }))] });
      // 10-3: a backup whose note type CSS closes the <style> and adds a handler (restore overwrites note types)
      const nt = { ...y.notetypes.get("yuzu-basic") }; nt.css = ".card{color:red}</style><img src='http://127.0.0.1:1/x' onerror=\"localStorage.setItem('pwn','notetypeCss')\"><style>";
      await y.restore({ app: "yuzu", notetypes: [nt] });
    }, { PAYLOADS, MED });
    await p.evaluate((s) => (window as any).yuzu.saveSettings({ cardStyle: s, planScreen: false }), style);
    await p.click("nav.tabs >> text=Today"); await p.click(".hero >> text=Study"); await p.waitForSelector(".study .card-host", { timeout: 15000 });
    const texts: string[] = [];
    for (let i = 0; i < PAYLOADS.length + 1; i++) {
      await p.waitForTimeout(250);
      texts.push(await p.locator(".study .card-host").evaluate((el) => el.shadowRoot!.querySelector(".card")!.textContent!.trim()));
      await p.click("text=Show answer"); await p.waitForSelector(".answer-bar"); await p.waitForTimeout(250);
      await p.locator(".study .card-host").evaluate((el) => { for (const t of el.shadowRoot!.querySelectorAll<HTMLElement>(".tapme, a, button:not(.yz-sound)")) t.click(); });
      await p.waitForTimeout(250);
      if (!(await p.locator(".answer-bar .good").count())) break;
      await p.click(".answer-bar .good");
    }
    const r = await p.evaluate(() => ({ pwn: (window as any).__pwn ?? 0, steal: (window as any).__steal ?? null, ls: localStorage.getItem("pwn"), url: location.href }));
    ok(`${style}: no deck script ran (iframe srcdoc, glued/slashed handlers, entity and tab javascript: links, formaction, svg onload)`, r.pwn === 0 && !r.steal, JSON.stringify(r));
    ok(`${style}: note-type CSS cannot break out of its <style> (10-3)`, r.ls === null, String(r.ls));
    ok(`${style}: the app was not navigated away (meta refresh, links)`, r.url === URL || r.url === URL + "#", r.url);
    const med = texts.find((t) => t.startsWith("Symptom")) ?? "";
    ok(`${style}: "onset = 2 weeks … once = daily" is shown exactly (10-5)`, med === MED, med);
    ok(`${style}: the hostile cards still show their own text`, texts.filter((t) => /^Q\d/.test(t)).length >= PAYLOADS.length - 1, texts.join(" | ").slice(0, 200));
    if (style === "yuzu") await p.screenshot({ path: "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad/wp01-study.png" });
    await ctx.close();
  }
  // Cloze, sound button and image still work after cleaning (the editor preview path uses the same CardView).
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } }); const p = await open(ctx, "features");
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const msg = await p.evaluate((png) => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "feat", category: "Test::Feat", cards: [
    { id: "c", type: "cloze", text: "Hyperkalaemia: give {{c1::calcium gluconate}} first", image: png },
    { id: "v", type: "vocab", word: "Hund", article: "der", meaning: "dog" },
    { id: "bad", front: "Bad picture", back: "x", image: "data:text/html;base64,PHNjcmlwdD4=" },
  ] }), png);
  ok("a pack picture of an unknown type is reported, not silently dropped (10-13)", /1 picture or sound left out/.test(msg), msg);
  await p.evaluate(() => (window as any).yuzu.saveSettings({ planScreen: false }));
  await p.click("nav.tabs >> text=Today"); await p.click(".hero >> text=Study"); await p.waitForSelector(".study .card-host", { timeout: 15000 });
  const seen: any[] = [];
  for (let i = 0; i < 4; i++) {
    await p.waitForTimeout(250); if (!(await p.locator(".study .card-host").count())) break;
    seen.push(await p.locator(".study .card-host").evaluate((el) => { const r = el.shadowRoot!; return { cloze: !!r.querySelector("span.cloze[data-cloze]"), img: (r.querySelector("img") as HTMLImageElement | null)?.src.slice(0, 5) ?? null, sound: !!r.querySelector("button.yz-sound[data-src^='tts:']"), styles: r.querySelectorAll("style").length }; }));
    await p.click("text=Show answer"); await p.waitForSelector(".answer-bar"); if (!(await p.locator(".answer-bar .good").count())) break; await p.click(".answer-bar .good");
  }
  ok("cloze gap, stored picture (blob:) and German voice button survive cleaning", seen.some((s) => s.cloze && s.img === "blob:") && seen.some((s) => s.sound) && seen.every((s) => s.styles >= 2), JSON.stringify(seen));
  await ctx.close();
} catch (e) { console.error(e); fails.push("crashed: " + String(e)); }
ok("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close(); server.kill();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed"); process.exit(fails.length ? 1 : 0);
