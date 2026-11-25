// The German gothic design: a vocab card and a sentence cloze in a German deck, light and dark, phone and desktop; and a
// Mephisto-deck card, which must be left exactly as its own design (no art, no theme).
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 5495; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" }); await new Promise((r) => setTimeout(r, 800));
const out = process.argv[2] ?? "/tmp"; const browser = await chromium.launch(); let bad = 0;
for (const [w, dark] of [[412, false], [412, true], [1280, true], [1280, false]] as const) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 915 : 800 }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
  const p = await ctx.newPage(); const errs: string[] = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${port}/`); await p.waitForFunction(() => (window as any).yuzu?.loaded);
  await p.evaluate(async (d) => { const y = (window as any).yuzu; await y.saveSettings({ nightCards: d, burySiblings: false });
    await y.importPack({ yuzu_pack: 1, id: "g", category: "Languages::German::Goethe A1", ordered: true, cards: [
      { id: "1", type: "vocab", word: "Gewitter", article: "das", meaning: "thunderstorm", plural: "Gewitter", example: "Das Gewitter zieht über die Stadt." },
      { id: "2", text: "Wenn ich Zeit {{c1::hätte}}, würde ich nach Wien fahren.", extra: "Konjunktiv II von haben." }] });
    await y.importPack({ yuzu_pack: 1, id: "m", category: "German::Mephisto::Geschichte", cards: [{ id: "1", text: "<div style='background:#120a0a !important;color:#e8d5b0 !important;padding:12px !important'>Der Teufel {{c1::lacht}}.</div>" }] }); }, dark);
  for (const [deck, n] of [["Goethe A1", 2], ["Mephisto", 1]] as const) {
    await p.click("nav.tabs >> text=Library"); if (await p.locator(".crumbs button").count()) await p.locator(".crumbs button").first().click();
    for (const step of deck === "Mephisto" ? ["German", "Mephisto"] : ["Languages", "German", "Goethe A1"]) await p.locator(".tree-row", { hasText: step }).first().click();
    await p.click("button.btn.primary:has-text('Study')"); await p.waitForTimeout(600);
    for (let i = 0; i < n; i++) {
      const tag = `${deck === "Mephisto" ? "meph" : "de"}-${w}-${dark ? "dark" : "light"}-${i}`;
      await p.locator(".study-body .paper").screenshot({ path: `${out}/${tag}-q.png` }); await p.keyboard.press(" "); await p.waitForTimeout(400);
      await p.locator(".study-body .paper").screenshot({ path: `${out}/${tag}-a.png` });
      const info = await p.evaluate(() => { const paper = document.querySelector(".study .paper") as HTMLElement; const h = paper.querySelector(".card-host") as HTMLElement; const vw = h.shadowRoot!.querySelector(".vw"); return { art: paper.dataset.art ?? "", theme: h.dataset.theme ?? "", vw: vw ? getComputedStyle(vw).fontFamily : "", body: getComputedStyle(h.shadowRoot!.querySelector(".card")!).fontFamily, fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family).join(",") }; });
      const want = deck === "Mephisto" ? info.art === "" && info.theme === "" : info.art === "German" && info.theme === "German" && /EB Garamond/.test(info.body) && (i > 0 || /Unifraktur/.test(info.vw));
      if (!want) bad++; console.log(tag, want ? "ok" : "WRONG", JSON.stringify(info));
      await p.keyboard.press("3"); await p.waitForTimeout(300);
    }
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  }
  if (errs.length) { bad++; console.log("errors", errs); } await ctx.close();
}
await browser.close(); server.kill(); console.log(bad ? `${bad} WRONG` : "german design checks ok"); process.exit(bad ? 1 : 0);
