// WP16: Library search reads every field (ranked, Arabic digits), Overfilled answers at once, honest note/card counts and
// bulk actions on every card of a note, housekeeping tags hidden in the Tags view.
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 5160 + Number(process.env.PORT_OFFSET ?? 0) % 10; /* own range 5160–5169 */
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const shots = process.env.SHOTS ?? "";
try {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: "block" });
  await ctx.addInitScript("window.__name = (f) => f");
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${port}/`); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  const long = Array.from({ length: 9 }, (_, i) => `<li>point ${i} about the antidote</li>`).join("");
  await p.evaluate(({ long }) => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "wp16", category: "Medicine::Search", cards: [
    { id: "a", front: "Adenosine dose for SVT", back: "6 mg rapid IV push, then 12 mg", source: "ERC 2025", tags: ["cardio", "AnkiHub_Deleted", "88768"] },
    { id: "b", front: "Pneumothorax", back: "Air in the pleural space", tags: ["resp"] },
    { id: "c", front: "Signs of tension pneumothorax in a trauma patient", back: "Tracheal deviation", tags: ["resp"] },
    { id: "d", front: "Bowel care", back: "manual disimpaction", tags: ["pneumothorax_list"] },
    { id: "e", front: "Calcium gluconate", back: "كالسيوم غلوكونات ١٠٪", tags: [] },
    { id: "f", front: "Too much", back: `<ul>${long}</ul>`, tags: [] },
  ] }), { long });
  await p.evaluate(() => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "wp16v", category: "German::Wortschatz", cards: [
    { type: "vocab", word: "der Schmerz", meaning: "pain" }, { type: "vocab", word: "das Fieber", meaning: "fever" }, { type: "vocab", word: "die Lunge", meaning: "lung" } ] }));
  await p.click("nav.tabs >> text=Library"); await p.waitForSelector(".seg");
  const inp = p.locator('input[placeholder^="Search"]');
  const header = () => p.locator("h2", { hasText: /\d+ (card|note)/ }).first().innerText().catch(() => "");
  const titles = () => p.locator(".list-row .t").evaluateAll((els) => els.map((e) => (e.firstChild?.textContent ?? "").trim()));
  async function search(s: string) { await inp.fill(s); await p.waitForFunction((s) => { const h = [...document.querySelectorAll("h2")].map((x) => x.textContent ?? ""); return !h.some((t) => /earching/.test(t)) && h.some((t) => /\d+ (card|note)/.test(t)); }, s, { timeout: 10000 }).catch(() => {}); await p.waitForTimeout(250); return titles(); }

  // 03-4: the back and the Source are searched
  ok("search finds text on the back (\"6 mg rapid\")", (await search("6 mg rapid")).join() === "Adenosine dose for SVT");
  ok("search finds the Source field (\"ERC 2025\")", (await search("ERC 2025")).join() === "Adenosine dose for SVT");
  ok("search finds a word that is only on the back (\"disimpaction\")", (await search("disimpaction")).join() === "Bowel care");
  // 10-8: Arabic-Indic and Persian digits, both in the card and in the query
  ok("Arabic-Indic digits in the query find Arabic-Indic digits on the card", (await search("١٠٪")).join() === "Calcium gluconate");
  ok("Persian digits and Latin digits find them too", (await search("۱۰٪")).join() === "Calcium gluconate" && (await search("10٪")).join() === "Calcium gluconate");
  // 03-5: ranking, housekeeping tags left out
  const r = await search("pneumothorax");
  ok("ranking: the card titled exactly \"Pneumothorax\" comes first, the tag-only hit last", r[0] === "Pneumothorax" && r[r.length - 1] === "Bowel care" && r.length === 3, r.join(" | "));
  ok("sort shows \"best match\" while searching", (await p.locator('select[aria-label="Sort"]').inputValue()) === "best");
  ok("housekeeping tags are not searched by default (\"ankihub\" typed partly: \"deleted\")", (await search("deleted")).length === 0);
  ok("…but are when the query is a tag (tag:ankihub)", (await search("tag:ankihub_deleted")).join() === "Adenosine dose for SVT");
  if (shots) await p.screenshot({ path: `${shots}/wp16-search.png` });
  await inp.fill(""); await p.waitForTimeout(300);

  // 03-1: Overfilled answers at once
  const chip = p.locator("button.chip", { hasText: "Overfilled" }); const t0 = Date.now(); await chip.click();
  await p.waitForFunction(() => document.querySelectorAll(".list-row").length > 0, null, { timeout: 5000 }).catch(() => {});
  ok("Overfilled lists the crammed card quickly", (await titles()).join() === "Too much" && Date.now() - t0 < 3000, `${Date.now() - t0} ms`);
  await chip.click(); await p.waitForTimeout(200);

  // 03-14: housekeeping tags hidden at the Tags root
  await p.click(".seg >> text=Tags"); await p.waitForSelector("text=Tags");
  const tagRows = await p.locator("button.tree-row .name").allInnerTexts();
  ok("Tags view hides AnkiHub_* and number-only tags, shows real tags", tagRows.includes("cardio") && !tagRows.includes("AnkiHub_Deleted") && !tagRows.includes("88768"), tagRows.join(","));
  await p.click(".seg >> text=Decks"); await p.waitForTimeout(200);

  // 03-3: honest counts; All + Suspend covers both directions of each vocab note
  await p.click("button.tree-row >> text=German"); await p.click("button.tree-row >> text=Wortschatz"); await p.click("text=Show cards in Wortschatz");
  const h = await header(); ok("the list header counts notes and cards", /3 notes · 6 cards/.test(h), h);
  await p.click("button.chip >> text=Select"); const all = p.getByRole("button", { name: /^All \d/ }).first();
  ok("\"All\" names the card count", /All 6 cards/.test(await all.innerText()));
  await all.click(); ok("the bar says how many cards are selected", /6 cards selected/.test(await p.locator(".bulk-bar").innerText()));
  await p.click(".bulk-bar >> text=Pause"); await p.waitForTimeout(400);
  const susp = await p.evaluate(() => [...(window as any).yuzu.cards.values()].filter((c: any) => c.source === "German::Wortschatz" && c.suspended).length);
  ok("Suspend on All suspends every card of every note (both directions)", susp === 6, `${susp} of 6`);
  await p.click("button.chip >> text=Select"); await p.locator(".list-row").first().click();
  ok("tapping one row selects all its note's cards", /2 cards selected/.test(await p.locator(".bulk-bar").innerText()));
  await p.click(".bulk-bar >> text=More…"); await p.click(".kit-sheet >> text=Unpause"); await p.waitForTimeout(400);
  const susp2 = await p.evaluate(() => [...(window as any).yuzu.cards.values()].filter((c: any) => c.source === "German::Wortschatz" && c.suspended).length);
  ok("…and Unsuspend acts on both", susp2 === 4, `${susp2} still paused`);
  if (shots) await p.screenshot({ path: `${shots}/wp16-counts.png` });
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e: any) { fails.push("crashed: " + (e?.message ?? e)); console.log(e); }
await browser.close(); server.kill();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join("; ")}` : "\nall WP16 checks passed");
process.exit(fails.length ? 1 : 0);
