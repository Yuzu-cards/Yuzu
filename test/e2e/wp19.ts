// WP19: storage (per-record journals over the buckets, the version 2 → 3 upgrade, folding, a reload in the middle of a
// fold), start-up progress, the Sketchy copy's size, the chunked full backup, and no screens left alive in memory.
import { chromium, type Page } from "playwright"; import { spawn } from "node:child_process";
const port = 5190 + Number(process.env.WP_PORT ?? 0); const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const URL = `http://127.0.0.1:${port}/`;
const watch = (p: Page, label: string) => { p.on("pageerror", (e) => errors.push(label + ": " + e.message)); p.on("console", (m) => { if (m.type() === "error" && !/ERR_|favicon/.test(m.text())) errors.push(label + " console: " + m.text()); }); };
const loaded = (p: Page) => p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 30000 });
const pack = { yuzu_pack: 1, id: "wp19", category: "Medicine::Store", cards: Array.from({ length: 120 }, (_, i) => ({ id: "c" + i, front: `Store question ${i}`, back: `answer ${i}` })) };
/** Raw IndexedDB reads, without the app's code. */
const raw = (p: Page) => p.evaluate(async () => {
  const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open("yuzu"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = (s: string) => new Promise<any[]>((res) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); });
  const out = { version: db.version, stores: [...db.objectStoreNames], cardsJ: (await all("cards_j")).length, notesJ: (await all("notes_j")).length, bucketCards: (await all("cards_b")).reduce((n, b) => n + b.rows.length, 0) };
  db.close(); return out;
});
const sig = (p: Page) => p.evaluate(() => { const y = (window as any).yuzu; return [...y.cards.values()].map((c: any) => `${c.id}:${c.reps}:${c.due}:${c.suspended ? 1 : 0}`).sort().join("|"); });
try {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 412, height: 915 } });
  await ctx.addInitScript("window.__name = (f) => f");
  // ---- 1. A database written by Yuzu 1.7.0 (version 2: buckets only) opens, upgrades in place and keeps everything
  const A = await ctx.newPage(); watch(A, "A"); await A.goto(URL); await loaded(A);
  await A.evaluate((p) => (window as any).yuzu.importPack(p), pack);
  await A.evaluate(async () => { const y = (window as any).yuzu; const cs = [...y.cards.values()].slice(0, 5); for (const c of cs) await y.answer(c.id, 3, 1500); await y.flushWrites(); });
  const dump = await A.evaluate(async () => { const y = (window as any).yuzu; await y._db.foldJournals(); return { notetypes: [...y.notetypes.values()], notes: [...y.notes.values()], cards: [...y.cards.values()], reviews: y.reviews, settings: await y._db.getMeta("settings", {}) }; });
  const before = await sig(A); await A.close();
  // rebuild it as 1.7.0 would have left it, from a page of the same site that doesn't run the app
  const R = await ctx.newPage(); watch(R, "R"); await R.goto(URL + "manifest.webmanifest");
  await R.evaluate(async (d) => {
    await new Promise((res, rej) => { const r = indexedDB.deleteDatabase("yuzu"); r.onsuccess = res; r.onerror = rej; r.onblocked = res; });
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("yuzu", 2);
      r.onupgradeneeded = () => { const db = r.result;
        for (const s of ["notetypes", "notes", "cards", "reviews", "meta", "media"]) { const os = db.createObjectStore(s, { keyPath: s === "meta" ? "key" : s === "media" ? "name" : "id" }); if (s === "cards") { os.createIndex("nid", "nid"); os.createIndex("due", "due"); } if (s === "reviews") { os.createIndex("cid", "cid"); os.createIndex("ts", "ts"); } if (s === "notes") os.createIndex("ntid", "ntid"); }
        db.createObjectStore("notes_b", { keyPath: "b" }); db.createObjectStore("cards_b", { keyPath: "b" }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const bucketOf = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % 256; };
    const buckets = (rows: any[]) => { const m = new Map<number, any[]>(); for (const r of rows) { const b = bucketOf(r.id); (m.get(b) ?? m.set(b, []).get(b)!).push(r); } return [...m].map(([b, rows]) => ({ b, rows })); };
    const t = db.transaction(["notetypes", "notes_b", "cards_b", "reviews", "meta"], "readwrite");
    for (const x of d.notetypes) t.objectStore("notetypes").put(x); for (const x of buckets(d.notes)) t.objectStore("notes_b").put(x); for (const x of buckets(d.cards)) t.objectStore("cards_b").put(x);
    for (const x of d.reviews) t.objectStore("reviews").put(x); t.objectStore("meta").put({ key: "settings", value: d.settings });
    await new Promise((res) => { t.oncomplete = res; }); db.close();
  }, dump);
  await R.close();
  const B = await ctx.newPage(); watch(B, "B"); await B.goto(URL); await loaded(B);
  const r1 = await raw(B);
  ok("a version 2 database (1.7.0) is upgraded to version 3 with the two journals added", r1.version === 3 && r1.stores.includes("cards_j") && r1.stores.includes("notes_j"), JSON.stringify(r1));
  ok("…and every card, note and review is still there, unchanged", (await sig(B)) === before && await B.evaluate(() => (window as any).yuzu.reviews.length === 5 && (window as any).yuzu.notes.size === 120));
  await B.reload(); await loaded(B);
  ok("…opening it again (the upgrade already done) changes nothing", (await sig(B)) === before && (await raw(B)).version === 3);

  // ---- 2. An answer writes one small journal row, not a bucket of hundreds of cards
  const bucketsBefore = await B.evaluate(async () => { const db = await (window as any).yuzu._db.openDb(); return new Promise<string>((res) => { const q = db.transaction("cards_b").objectStore("cards_b").getAll(); q.onsuccess = () => res(JSON.stringify(q.result)); }); });
  await B.evaluate(async () => { const y = (window as any).yuzu; const cs = [...y.cards.values()].filter((c: any) => c.reps === 0).slice(0, 20); for (const c of cs) await y.answer(c.id, 3, 1500); await y.flushWrites(); });
  const r2 = await raw(B);
  const bucketsAfter = await B.evaluate(async () => { const db = await (window as any).yuzu._db.openDb(); return new Promise<string>((res) => { const q = db.transaction("cards_b").objectStore("cards_b").getAll(); q.onsuccess = () => res(JSON.stringify(q.result)); }); });
  ok("20 answers: 20 rows in the cards journal and no bucket rewritten", r2.cardsJ === 20 && bucketsAfter === bucketsBefore, JSON.stringify(r2));
  const s2 = await sig(B); await B.reload(); await loaded(B);
  ok("…and after a reload the answers are all there (the journal is laid over the buckets)", (await sig(B)) === s2 && await B.evaluate(() => (window as any).yuzu.reviews.length === 25));

  // ---- 3. A bulk change after an answer, and a deletion after an answer: the bucket copy wins, nothing comes back
  const ids = await B.evaluate(async () => { const y = (window as any).yuzu; const cs = [...y.cards.values()].filter((c: any) => c.reps === 0).slice(0, 3); for (const c of cs) await y.answer(c.id, 3, 1500); await y.flushWrites(); return cs.map((c: any) => c.id); });
  await B.evaluate(async (ids) => { const y = (window as any).yuzu; await y.bulk([ids[0]], { suspended: true }); await y.deleteNotes([y.cards.get(ids[1]).nid]); }, ids);
  const s3 = await sig(B); await B.reload(); await loaded(B);
  const after3 = await B.evaluate((ids) => { const y = (window as any).yuzu; const a = y.cards.get(ids[0]); return { suspended: a?.suspended, reps: a?.reps, gone: !y.cards.has(ids[1]), kept: y.cards.get(ids[2])?.reps }; }, ids);
  ok("an answer then a bulk change: both kept after a reload (suspended, and its review counted)", after3.suspended === true && after3.reps === 1 && after3.kept === 1, JSON.stringify(after3));
  ok("an answer then deleting the note: it stays deleted (the journal row went with it)", after3.gone && (await sig(B)) === s3);

  // ---- 4. Folding: the journal moves into the buckets; a reload in the middle of a fold loses nothing
  await B.evaluate(async () => { const y = (window as any).yuzu; const cs = [...y.cards.values()].filter((c: any) => c.reps === 0).slice(0, 60); for (const c of cs) await y.answer(c.id, 3, 1500); await y.flushWrites(); });
  const s4 = await sig(B); const j4 = (await raw(B)).cardsJ;
  // the page reloads between two steps of the fold (the first step's buckets are written, the rest still in the journal)
  await B.evaluate(() => { (window as any).yuzu._db.foldJournals(() => { location.reload(); return new Promise(() => {}); }); }).catch(() => {});
  await B.waitForTimeout(500); await loaded(B); const j4b = (await raw(B)).cardsJ;
  ok("a reload in the middle of a fold: every card as it was", (await sig(B)) === s4 && j4b > 0 && j4b < j4, `journal ${j4} → ${j4b} rows`);
  const moved = await B.evaluate(() => (window as any).yuzu._db.foldJournals());
  const r4 = await raw(B);
  ok("…folding again finishes the job: the journal is empty", r4.cardsJ === 0 && r4.notesJ === 0 && moved === j4b, `moved ${moved}, ${JSON.stringify(r4)}`);
  await B.reload(); await loaded(B);
  ok("…and after the fold a reload reads the same cards from the buckets alone", (await sig(B)) === s4 && (await raw(B)).bucketCards === 119);
  const twice = await B.evaluate(async () => { const y = (window as any).yuzu; return [await y._db.foldJournals(), await y._db.foldJournals()]; });
  ok("folding with nothing to fold is harmless", twice[0] === 0 && twice[1] === 0 && (await sig(B)) === s4);
  // a note edit goes to the notes journal too
  await B.evaluate(async () => { const y = (window as any).yuzu; const n = [...y.notes.values()][0]; await y.updateNote(n.id, ["Edited front", n.fields[1]], n.tags.filter((t: string) => !t.startsWith("auto::"))); });
  const nj = (await raw(B)).notesJ; await B.reload(); await loaded(B);
  ok("a note edit: one notes-journal row, and the edit is there after a reload", nj === 1 && await B.evaluate(() => [...(window as any).yuzu.notes.values()].some((n: any) => n.fields[0] === "Edited front")), `notes journal ${nj}`);
  // leaving the app folds the journal
  await B.evaluate(async () => { const y = (window as any).yuzu; const c = [...y.cards.values()].find((c: any) => c.reps === 0); await y.answer(c.id, 3, 1000); await y.flushWrites(); Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await B.waitForFunction(async () => { const y = (window as any).yuzu; const db = await y._db.openDb(); return new Promise((res) => { const q = db.transaction(["cards_j", "notes_j"]).objectStore("cards_j").count(); q.onsuccess = () => res(q.result === 0); }); }, null, { timeout: 10000 }).catch(() => {});
  ok("leaving the app (page hidden) folds the journal", (await raw(B)).cardsJ === 0);
  await B.close();

  // ---- 5. Start-up: progress reaches 100 %, the Sketchy copy's size comes from its own small key
  const C = await ctx.newPage(); watch(C, "C"); await C.goto(URL); await loaded(C);
  ok("start-up reports its progress (100 % when loaded)", await C.evaluate(() => (window as any).yuzu.loadProgress === 1));
  await C.evaluate(async () => { const y = (window as any).yuzu; await y._db.setMeta("sketchyUndo", Array.from({ length: 7 }, (_, i) => ({ id: "x" + i, fields: [], tags: [] }))); });
  await C.reload(); await loaded(C);
  const sk = await C.evaluate(async () => { const y = (window as any).yuzu; const a = await y.sketchyBackupSize(); const key = await y._db.getMeta("sketchyUndoN", null); await y._db.setMeta("sketchyUndo", []); const b = await y.sketchyBackupSize(); return { a, key, b }; });
  ok("the Sketchy copy's size is read once, then kept in its own small key and in memory", sk.a === 7 && sk.key === 7 && sk.b === 7, JSON.stringify(sk));

  // ---- 6. The full backup, written in slices, is the same as the one-piece backup
  const same = await C.evaluate(async () => { const y = (window as any).yuzu; const fr: number[] = []; const blob = await y.backupBlob(false, (f: number) => fr.push(f)); const a = JSON.parse(await blob.text()); const b = JSON.parse(JSON.stringify(y.backup())); delete a.at; delete b.at; const ks = (o: any) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])); return { same: ks(a) === ks(b), last: fr[fr.length - 1], n: a.cards.length }; });
  ok("the full backup written in slices equals the one-piece backup, with progress to 100 %", same.same && same.last === 1 && same.n === 119, JSON.stringify(same));
  await C.close(); await ctx.close();

  // ---- 7. Screens don't stay alive in memory: study sessions and tab changes, then DOM nodes after garbage collection
  // (clicks go through the page itself: Playwright's element handles keep nodes alive and would show a false leak)
  const ctx2 = await browser.newContext({ serviceWorkers: "block", viewport: { width: 412, height: 915 } }); await ctx2.addInitScript("window.__name = (f) => f");
  const L = await ctx2.newPage(); watch(L, "L"); await L.goto(URL); await loaded(L); await L.evaluate((p) => (window as any).yuzu.importPack(p), pack);
  await L.evaluate(() => (window as any).yuzu.saveSettings({ newPerDay: 400 })); await L.waitForTimeout(1500);
  const cdp = await ctx2.newCDPSession(L); await cdp.send("HeapProfiler.enable");
  const nodes = async () => { await cdp.send("HeapProfiler.collectGarbage"); await L.waitForTimeout(200); await cdp.send("HeapProfiler.collectGarbage"); return ((await cdp.send("Memory.getDOMCounters")) as any).nodes as number; };
  const clk = async (sel: string, text = "") => { await L.waitForFunction(([sel, text]) => [...document.querySelectorAll(sel)].some((e) => e.textContent!.includes(text)), [sel, text], { timeout: 15000 }); await L.evaluate(([sel, text]) => { ([...document.querySelectorAll(sel)].find((e) => e.textContent!.includes(text)) as HTMLElement).click(); }, [sel, text]); };
  const cycle = async () => {
    await clk("nav.tabs button", "Today"); await L.waitForTimeout(200); await clk(".screen button.btn.primary", "Study"); await L.waitForFunction(() => !!document.querySelector(".study .card-host"));
    for (let i = 0; i < 5; i++) { await clk(".show-bar .btn.primary"); await L.waitForFunction(() => !!document.querySelector(".answer-bar")); await clk(".answer-bar .good"); await L.waitForFunction(() => !!document.querySelector(".show-bar, .done")); }
    await clk(".study-top button[aria-label=Close]"); await L.waitForFunction(() => !!document.querySelector("nav.tabs"));
    for (const t of ["Library", "Progress", "Settings", "Today"]) { await clk("nav.tabs button", t); await L.waitForTimeout(250); }
  };
  await cycle(); const n0 = await nodes();
  for (let i = 0; i < 3; i++) await cycle();
  const n1 = await nodes();
  ok("3 more study sessions and 12 tab changes leave no screens behind in memory", n1 - n0 < 400, `${n0} → ${n1} DOM nodes`);
  await ctx2.close();
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails); process.exitCode = 1; }
  await browser.close(); server.kill();
}
