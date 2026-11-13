// WP02 in a real browser: packs and curation files with wrong values never lock the user out, imports are all-or-nothing,
// re-imports repair and respect deletions, and the messages say what really happened.
import { chromium, type Page, type BrowserContext } from "playwright"; import { spawn } from "node:child_process";
const port = 5020 + Number(process.env.WP02_PORT ?? 0); const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`; const shots = process.env.WP02_SHOTS ?? "";
async function open(ctx: BrowserContext, label: string): Promise<Page> {
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(label + ": " + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon|save failed/.test(m.text())) errors.push(label + " console: " + m.text()); });
  await p.goto(URL); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 }); return p;
}
const reload = async (p: Page) => { await p.reload(); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 }); };
const crashed = async (p: Page) => (await p.locator("text=Something went wrong").count()) > 0 || (await p.locator("nav.tabs").count()) === 0;
const fresh = () => browser.newContext({ viewport: { width: 412, height: 915 } });
try {
  // ---- 10-1: wrongly typed values in a pack
  let ctx = await fresh(); let P = await open(ctx, "types");
  const msg1 = await P.evaluate(() => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "bad", category: "Medicine::Bad", cards: [{ front: "Q", back: "A", tags: ["step1", 2026] }, { front: "Q2", back: { x: 1 } }, { type: "cloze", text: "a {{c1::b}}", extra: 5 }] }));
  ok("a pack with a numeric tag, an object back and a numeric extra imports", /^3 cards added/.test(msg1), msg1);
  await reload(P); ok("…and Yuzu still opens after a reload", !(await crashed(P)));
  for (const tab of ["Library", "Settings", "Today"]) { await P.click(`nav.tabs >> text=${tab}`); await P.waitForTimeout(250); }
  ok("…and every tab opens", !(await crashed(P)));
  // ---- 10-1: a collection already damaged by the old version opens again (repaired on load)
  await P.evaluate(async () => { const y = (window as any).yuzu; await y._db.putMany("notes", [{ id: "pbroken", ntid: "yuzu-basic", guid: "pbroken", fields: ["Broken front", { x: 1 }, "", ""], tags: ["ok", 2026], created: 1, modified: 1 }]); await y._db.putMany("cards", [{ id: "pbroken-0", nid: "pbroken", ord: 0, state: "new", suspended: false, flag: 0, due: 1, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: 0, step: 0, created: 1, mod: 1, source: "Medicine::Bad" }]); });
  await reload(P);
  const rep = await P.evaluate(() => { const n = (window as any).yuzu.notes.get("pbroken"); return { tags: n.tags, f: n.fields, notes: (window as any).yuzu.loadNotes }; });
  ok("stored notes with bad values are repaired at launch", !(await crashed(P)) && rep.tags.every((t: unknown) => typeof t === "string") && rep.f.every((f: unknown) => typeof f === "string") && rep.notes.some((x: string) => /not text/.test(x)), JSON.stringify(rep));
  await P.click("nav.tabs >> text=Settings"); await P.waitForTimeout(300); ok("…and Settings opens with them", !(await crashed(P)));
  await ctx.close();

  // ---- 10-4 / 10-19: storage full during an import: nothing half-saved, a banner, and a clean retry
  ctx = await fresh(); P = await open(ctx, "quota");
  const pack = { yuzu_pack: 1, id: "q", category: "Medicine::Quota", cards: Array.from({ length: 30 }, (_, i) => ({ id: "c" + i, type: "cloze", text: `Quota fact ${i}: {{c1::answer ${i}}}` })) };
  await P.evaluate(() => { const orig = IDBObjectStore.prototype.put; (window as any).__orig = orig; IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...a: any[]) { if (this.name === "cards_b") throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); return (orig as any).apply(this, a); } as any; });
  const qerr = await P.evaluate((p) => (window as any).yuzu.importPack(p).then(() => "no error", (e: any) => e.message), pack);
  const mem = await P.evaluate(() => ({ n: (window as any).yuzu.notes.size, c: (window as any).yuzu.cards.size }));
  await P.waitForTimeout(300); const toast = await P.locator(".toast").innerText().catch(() => "");
  ok("a full disk mid-import says so and adds nothing (not even in memory)", /Nothing was added/.test(qerr) && /storage for Yuzu is full/.test(qerr) && mem.n === 0 && mem.c === 0, `${qerr} ${JSON.stringify(mem)}`);
  ok("…with the storage-full banner", /storage for Yuzu is full/.test(toast), toast.slice(0, 100));
  await P.evaluate(() => { IDBObjectStore.prototype.put = (window as any).__orig; });
  await reload(P); const disk = await P.evaluate(() => ({ n: (window as any).yuzu.notes.size, c: (window as any).yuzu.cards.size }));
  ok("…and the disk holds no notes without cards", disk.n === 0 && disk.c === 0, JSON.stringify(disk));
  const retry = await P.evaluate((p) => (window as any).yuzu.importPack(p), pack);
  ok("…so the retry adds everything", /^30 cards added/.test(retry) && (await P.evaluate(() => (window as any).yuzu.cards.size)) === 30, retry);
  // ---- 10-4: notes left without cards by the old version: re-import repairs them, and so does the next launch
  await P.evaluate(async () => { const y = (window as any).yuzu; const notes = [...y.notes.values()].slice(0, 10); const ids = notes.flatMap((n: any) => y.cardsOfNote(n.id).map((c: any) => c.id)); await y._db.deleteMany("cards", ids); });
  await P.evaluate(() => { const y = (window as any).yuzu; for (const n of [...y.notes.values()].slice(10, 20)) for (const c of y.cardsOfNote(n.id)) y.cards.delete(c.id); }); // in memory only, like a half-finished import
  const rmsg = await P.evaluate((p) => (window as any).yuzu.importPack(p), pack);
  ok("re-importing makes the missing cards again (in the pack's category)", /^10 repaired \(10 missing cards made again\), 20 unchanged/.test(rmsg) && (await P.evaluate(() => [...(window as any).yuzu.cards.values()].filter((c: any) => c.source === "Medicine::Quota").length)) === 30, rmsg);
  await reload(P);
  const boot = await P.evaluate(() => { const y = (window as any).yuzu; const nids = new Set([...y.cards.values()].map((c: any) => c.nid)); return { lonely: [...y.notes.keys()].filter((id) => !nids.has(id)).length, cards: y.cards.size, notes: y.loadNotes }; });
  ok("…and launch makes the cards of notes the disk had left without any", boot.lonely === 0 && boot.cards === 30 && boot.notes.some((x: string) => /had no cards/.test(x)), JSON.stringify(boot));
  await ctx.close();

  // ---- 10-4: a reload in the middle of a big import leaves no notes without cards
  ctx = await fresh(); P = await open(ctx, "midway");
  await P.evaluate(() => { (window as any).yuzu.importPack({ yuzu_pack: 1, id: "big", category: "Medicine::Big", cards: Array.from({ length: 8000 }, (_, i) => ({ id: "b" + i, front: `Big question number ${i}`, back: `answer ${i}` })) }); });
  await P.waitForTimeout(150); await reload(P);
  const mid = await P.evaluate(() => { const y = (window as any).yuzu; const nids = new Set([...y.cards.values()].map((c: any) => c.nid)); return { notes: y.notes.size, cards: y.cards.size, lonely: [...y.notes.keys()].filter((id) => !nids.has(id)).length }; });
  ok("reload mid-import: all or nothing, never notes without cards", mid.lonely === 0 && (mid.notes === 0 || mid.notes === 8000) && mid.cards === mid.notes, JSON.stringify(mid));
  await ctx.close();

  // ---- 10-6: one bad picture
  ctx = await fresh(); P = await open(ctx, "image");
  const imsg = await P.evaluate(() => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "img", category: "Medicine::Img", cards: [{ front: "Good card", back: "A" }, { front: "Card with a broken picture", back: "B", image: "data:image/png;base64,%%%%not base64" }] }));
  await reload(P); const icount = await P.evaluate(() => ({ n: (window as any).yuzu.notes.size, c: (window as any).yuzu.cards.size }));
  ok("one unreadable picture: both cards saved, the picture named as left out", /^2 cards added, 1 picture could not be read/.test(imsg) && icount.n === 2 && icount.c === 2, `${imsg} ${JSON.stringify(icount)}`);

  // ---- 10-15: deleted notes stay deleted
  const tpack = { yuzu_pack: 1, id: "tomb", category: "Medicine::Tomb", cards: [{ id: "x", front: "Deleted question", back: "A" }, { front: "Deleted too", back: "B" }] };
  await P.evaluate((p) => (window as any).yuzu.importPack(p), tpack);
  await P.evaluate(async () => { const y = (window as any).yuzu; const ids = [...y.notes.values()].filter((n: any) => /^Deleted/.test(n.fields[0])).map((n: any) => n.id); await y.deleteNotes(ids); });
  const tmsg = await P.evaluate((p) => (window as any).yuzu.importPack(p), tpack);
  ok("re-importing a pack does not bring back notes the user deleted", tmsg === "Nothing added — 2 cards you deleted (left out)" && (await P.evaluate(() => [...(window as any).yuzu.notes.values()].filter((n: any) => /^Deleted/.test(n.fields[0])).length)) === 0, tmsg);
  const back = await P.evaluate((p) => (window as any).yuzu.importPack(p, { restoreDeleted: true }), tpack);
  ok("…unless asked", /^2 cards added/.test(back) && (await P.evaluate(() => Object.keys((window as any).yuzu.tombstones).filter((k) => k.startsWith("n:")).length)) === 0, back);

  // ---- 10-17 / 10-1: curation with a deck called "toString" and numbers in edits
  await P.evaluate(() => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "ts", category: "toString", cards: [{ front: "Proto deck question", back: "A" }] }));
  const nid = await P.evaluate(() => [...(window as any).yuzu.notes.values()].find((n: any) => n.fields[0] === "Proto deck question").id);
  const cmsg = await P.evaluate((id) => (window as any).yuzu.importCuration({ yuzu_curation: 1, decks: {}, edits: [{ id, fields: { "0": 42, "1": null } }], tags: { "": [id], good: [id, 7] }, merges: [{ keep: 5 }], packs: [{ yuzu_pack: 1, cards: "nope" }] }), nid);
  const cur = await P.evaluate((id) => { const y = (window as any).yuzu; const n = y.notes.get(id); return { f: n.fields, tags: n.tags, src: y.cardsOfNote(id)[0].source }; }, nid);
  ok("a curation file can't corrupt a deck called toString, and numbers in edits become text", cur.src === "toString" && cur.f[0] === "42" && cur.f[1] === "A" && cur.tags.includes("good") && /1 card improved/.test(cmsg) && /Not a Yuzu card pack/.test(cmsg), JSON.stringify(cur) + " " + cmsg);
  await reload(P); ok("…and Yuzu opens after it", !(await crashed(P)));

  // ---- 10-14: a very long deck name doesn't widen the page
  await P.evaluate(() => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "long", category: "::::" + "Verylongdeckname".repeat(300) + "::::Renal::", cards: [{ front: "Long deck question", back: "A" }] }));
  const lsrc = await P.evaluate(() => { const y = (window as any).yuzu; const n = [...y.notes.values()].find((n: any) => n.fields[0] === "Long deck question"); return y.cardsOfNote(n.id)[0].source; });
  await P.click("nav.tabs >> text=Library"); await P.waitForTimeout(400);
  const sw = await P.evaluate(() => document.documentElement.scrollWidth);
  ok("deck paths are cleaned (no empty levels, parts capped) and the Library doesn't scroll sideways", /^Verylongdeckname.{64}::Renal$/.test(lsrc) && sw <= 412, `${lsrc.length} chars, scrollWidth ${sw}`);
  if (shots) await P.screenshot({ path: `${shots}/wp02-library-long.png` });
  await ctx.close();

  // ---- 01-3: quick add of a card that is already there keeps the form and says so
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); P = await open(ctx, "quick");
  const text = "Hyperkalaemia: give {{c1::calcium gluconate}} then {{c2::insulin with dextrose}}";
  await P.click('button[aria-label="Quick add a card"]');
  await P.fill('textarea[aria-label="Cloze text"]', text); await P.click("button:has-text('Save card')"); await P.waitForTimeout(300);
  const s1 = await P.locator(".kit-snack").innerText().catch(() => "");
  ok("quick add: a new card says Saved and clears the form", /^Saved to/.test(s1) && (await P.inputValue('textarea[aria-label="Cloze text"]')) === "", s1);
  await P.fill('textarea[aria-label="Cloze text"]', text); await P.click("button:has-text('Save card')"); await P.waitForTimeout(300);
  const s2 = await P.locator(".kit-snack").innerText().catch(() => "");
  ok("…the same card again: 'Already in your collection', and the text stays", /Already in your collection/.test(s2) && (await P.inputValue('textarea[aria-label="Cloze text"]')) === text && (await P.evaluate(() => (window as any).yuzu.notes.size)) === 1, s2);
  if (shots) await P.screenshot({ path: `${shots}/wp02-quick-dupe.png` });
  await ctx.close();

  ok("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
} catch (e) { console.error(e); fails.push("crashed: " + (e as Error).message); }
finally { await browser.close(); server.kill(); }
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join("\n- ")}` : "\nAll WP02 checks passed");
process.exit(fails.length ? 1 : 0);
