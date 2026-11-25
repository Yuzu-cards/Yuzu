// Subject designs: one card per body system (and a German card), screenshotted in study, front and back, per interface.
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 5490; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" }); await new Promise((r) => setTimeout(r, 800));
const out = process.argv[2] ?? "/tmp"; const ui = process.argv[3] ?? "arcade"; const w = Number(process.argv[4] ?? 412); const level = process.argv[5] ?? "rich"; const slate = process.argv[6] !== "light";
const SYS = ["Cardiovascular", "Respiratory", "Neurology", "Gastrointestinal", "Renal", "Endocrine", "Hematology & Oncology", "Infectious Disease", "Musculoskeletal & Trauma", "Dermatology", "Obstetrics & Gynecology", "Pediatrics", "Psychiatry", "Toxicology & Environmental", "ENT & Eye", "Immunology"];
const TEXT: Record<string, string> = { Cardiovascular: "First-line treatment for stable angina: {{c1::a beta-blocker}} plus sublingual nitrate as needed.", Respiratory: "Most common cause of community-acquired pneumonia: {{c1::Streptococcus pneumoniae}}." };
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 915 : 800 }, deviceScaleFactor: 1, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
await ctx.addInitScript(`localStorage.setItem("yuzu-ui", "${ui}");`); const p = await ctx.newPage(); const errs: string[] = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(`http://127.0.0.1:${port}/`); await p.waitForFunction(() => (window as any).yuzu?.loaded);
await p.evaluate(async ([sys, text, level, slate]) => { const y = (window as any).yuzu; await y.saveSettings({ cardArt: level, nightCards: slate, burySiblings: false, newPerDay: 50 });
  await y.importPack({ yuzu_pack: 1, id: "art", category: "Medicine::Art", ordered: true, cards: (sys as string[]).map((s, i) => ({ id: String(i), text: (text as any)[s] ?? `${s}: a {{c1::typical answer}} on a card long enough to wrap onto a second line, with an extra.`, extra: "Extra: a short explanation of why.", tags: ["auto::System::" + s] })) });
  await y.importPack({ yuzu_pack: 1, id: "de", category: "Languages::German::Goethe A1", cards: [{ type: "vocab", word: "Herz", article: "das", meaning: "heart", example: "Das Herz schlägt schnell." }] }); }, [SYS, TEXT, level, slate] as const);
await p.click("nav.tabs >> text=Library"); await p.locator(".tree-row", { hasText: "Medicine" }).first().click(); await p.locator(".tree-row", { hasText: "Art" }).first().click();
await p.click("button.btn.primary:has-text('Study')"); await p.waitForTimeout(500);
for (let i = 0; i < SYS.length; i++) {
  await p.locator(".study-body .paper").screenshot({ path: `${out}/art-${ui}-${w}-${level}-${String(i).padStart(2, "0")}-q.png` });
  await p.keyboard.press(" "); await p.waitForTimeout(120);
  if (i < 2) await p.locator(".study-body .paper").screenshot({ path: `${out}/art-${ui}-${w}-${level}-${String(i).padStart(2, "0")}-a.png` });
  // the text never runs under the drawing
  const clash = await p.evaluate(() => { const paper = document.querySelector(".study .paper") as HTMLElement; const host = paper.querySelector(".card-host") as HTMLElement; const pr = paper.getBoundingClientRect(); const hr = host.getBoundingClientRect(); const cs = getComputedStyle(paper, "::after"); return cs.content === "none" ? "no art" : hr.right <= pr.right - parseFloat(cs.right) - parseFloat(cs.width) + 1 ? "" : `text ${hr.right} > art ${pr.right - parseFloat(cs.right) - parseFloat(cs.width)}`; });
  if (clash) console.log(SYS[i], clash);
  await p.keyboard.press("3"); await p.waitForTimeout(250);
}
console.log(ui, w, level, errs.length ? errs.join(" | ") : "no errors");
await browser.close(); server.kill();
