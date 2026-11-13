// WP03: record merge between two devices, through the real store (syncNow's merge path) and an in-process fake GitHub.
//  06-2 delete on one device + edit on the other → the note comes back with its card on both, even after a reload (no undo copy left)
//  06-5 the same note edited on two devices → fields and tags merge; the same field → later wins, the other is a "Replaced edit" you can put back
//  06-6 suspend on one device + review on the other → both kept
//  10-18 answer → delete → undo delete → undo answer still works
import { chromium, type Page } from "playwright"; import { spawn } from "node:child_process";
import { fakeGitHub } from "../fake-github.ts";
const port = 5030 + Number(process.env.PORT_OFFSET ?? 0); /* PORT_OFFSET lets several copies run at once */ const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const gh = fakeGitHub(); const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const shots = process.env.SHOTS ?? "";
async function device(name: string, width = 412): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } }); const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(name + ": " + e.message));
  await p.route("https://api.github.com/**", async (route) => {
    const req = route.request(); const res = await gh.fetchImpl(req.url(), { method: req.method(), body: req.postData() ?? undefined } as any);
    await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), contentType: "application/octet-stream" });
  });
  await p.goto(`http://127.0.0.1:${port}/`); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 30000 });
  await p.evaluate((n) => { const y = (window as any).yuzu; return y.saveSettings({ deviceName: n, sync: { ...y.settings.sync, backend: "github", owner: "o", repo: "r", token: "t", auto: false } }); }, name);
  return p;
}
const sync = (p: Page) => p.evaluate(async () => { const y = (window as any).yuzu; while (y.syncStatus.state === "syncing") await new Promise((r) => setTimeout(r, 100)); await y.sync("manual"); return y.syncStatus.message as string; });
const counts = (p: Page) => p.evaluate(() => { const y = (window as any).yuzu; return `${y.notes.size}/${y.cards.size}`; });
const noteBy = (p: Page, front: string) => p.evaluate((f) => { const y = (window as any).yuzu; const n = [...y.notes.values()].find((x: any) => x.fields[0].startsWith(f)); return n ? { id: n.id, fields: n.fields, tags: n.tags.filter((t: string) => !t.startsWith("auto::")), cards: [...y.cards.values()].filter((c: any) => c.nid === n.id).map((c: any) => ({ id: c.id, reps: c.reps, s: c.suspended })) } : null; }, front);
const edit = (p: Page, id: string, fields: string[], tags: string[]) => p.evaluate(([i, f, t]) => (window as any).yuzu.updateNote(i, f, t), [id, fields, tags] as const);
const pack = { yuzu_pack: 1, id: "wp03", category: "Medicine::Cardio", cards: Array.from({ length: 8 }, (_, i) => ({ id: "c" + i, front: `Q cardio ${i}?`, back: `A ${i}` })) };
try {
  const A = await device("Phone"); await A.evaluate((p) => (window as any).yuzu.importPack(p), pack);
  await sync(A); const B = await device("Deck"); await sync(B); await sync(A);
  ok("both devices start with the same 8 notes / 8 cards", (await counts(A)) === "8/8" && (await counts(B)) === "8/8", `${await counts(A)} ${await counts(B)}`);

  // ---- 06-2: Phone deletes n2 and is reloaded (no undo copy in memory); Deck fixes a typo in n2 afterwards; Deck syncs first.
  const n2 = (await noteBy(A, "Q cardio 2?"))!;
  await A.evaluate((id) => (window as any).yuzu.deleteNotes([id]), n2.id);
  await A.reload(); await A.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 30000 });
  await edit(B, n2.id, ["Q cardio 2? typo fixed on Deck", ...n2.fields.slice(1)], []);
  await sync(B); const s1 = await sync(A);
  const a2 = await noteBy(A, "Q cardio 2?");
  ok("06-2: the deleting device takes the newer edit AND its card back in the same sync", a2?.fields[0] === "Q cardio 2? typo fixed on Deck" && a2.cards.length === 1, `${JSON.stringify(a2)} · "${s1}"`);
  await sync(B); await sync(A);
  const moved: string[] = [];
  for (let i = 0; i < 3; i++) { const m0 = { ...gh.files() }; await sync(A); await sync(B); const m1 = gh.files(); moved.push(Object.keys({ ...m0, ...m1 }).filter((k) => m0[k] !== m1[k] && k !== "manifest.json").join(",")); }
  const recs = moved[2].split(",").filter((k) => /^(notes|cards|tombstones)/.test(k));
  ok("06-2: the devices agree and no note or card file keeps changing (no ping-pong)", (await counts(A)) === "8/8" && (await counts(B)) === "8/8" && recs.length === 0, `${await counts(A)} ${await counts(B)} still moving per round: ${JSON.stringify(moved)}`);
  await A.reload(); await A.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 30000 });
  ok("06-2: after a reload no note without cards is reported", !(await A.evaluate(() => (window as any).yuzu.loadNotes.join(" "))).includes("no cards"));

  // ---- 06-5: different fields and tags on two devices
  const n1 = (await noteBy(A, "Q cardio 1?"))!;
  await edit(A, n1.id, [n1.fields[0] + " +Phone-front", ...n1.fields.slice(1)], ["tagA"]); await A.waitForTimeout(20);
  await edit(B, n1.id, [n1.fields[0], n1.fields[1] + " +Deck-back", ...n1.fields.slice(2)], ["tagB"]);
  await sync(A); await sync(B); await sync(A);
  const m1a = await noteBy(A, "Q cardio 1?"), m1b = await noteBy(B, "Q cardio 1?");
  ok("06-5: front from the Phone and back from the Deck are both kept, on both devices", JSON.stringify(m1a?.fields.slice(0, 2)) === JSON.stringify(["Q cardio 1? +Phone-front", "A 1 +Deck-back"]) && JSON.stringify(m1a?.fields) === JSON.stringify(m1b?.fields), JSON.stringify([m1a?.fields, m1b?.fields]));
  ok("06-5: both tags are kept", JSON.stringify(m1a?.tags.sort()) === '["tagA","tagB"]' && JSON.stringify(m1b?.tags.sort()) === '["tagA","tagB"]', JSON.stringify([m1a?.tags, m1b?.tags]));
  // the same field on both: later wins, the other is a Replaced edit on the device that kept the newer one
  const n3 = (await noteBy(A, "Q cardio 3?"))!;
  await edit(A, n3.id, ["Q cardio 3? (Phone's wording)", ...n3.fields.slice(1)], []); await A.waitForTimeout(20);
  await edit(B, n3.id, ["Q cardio 3? (Deck's wording, later)", ...n3.fields.slice(1)], []);
  await sync(A); await sync(B); await sync(A);
  const c3a = await noteBy(A, "Q cardio 3?"), c3b = await noteBy(B, "Q cardio 3?");
  const conf = await B.evaluate(() => (window as any).yuzu.editConflicts.map((c: any) => [c.lost, c.kept, c.lostOn]));
  ok("06-5: same field — the later edit wins on both", c3a?.fields[0] === "Q cardio 3? (Deck's wording, later)" && c3b?.fields[0] === c3a?.fields[0], JSON.stringify([c3a?.fields[0], c3b?.fields[0]]));
  ok("06-5: …and the Phone's wording is kept as a Replaced edit (once, on one device)", conf.length === 1 && conf[0][0] === "Q cardio 3? (Phone's wording)" && conf[0][2] === "Phone" && (await A.evaluate(() => (window as any).yuzu.editConflicts.length)) === 0, JSON.stringify(conf));
  ok("06-5: the sync history says so", /replaced by .*newer edit/.test(await B.evaluate(() => (window as any).yuzu.syncLog.map((l: any) => l.message).join(" | "))));
  await B.click("nav.tabs >> text=Settings"); await B.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await B.waitForTimeout(400);
  ok("06-5: Settings → Sync lists it under Replaced edits", (await B.locator("text=Replaced edits (1)").count()) === 1);
  if (shots) { await B.locator(".replaced-edits").scrollIntoViewIfNeeded(); await B.screenshot({ path: `${shots}/replaced-412-arcade.png` }); }
  await B.click("text=Use the replaced one"); await B.waitForTimeout(300);
  const back3 = await noteBy(B, "Q cardio 3?");
  ok("06-5: Use the replaced one puts the Phone's wording back, and it syncs as the newest edit", back3?.fields[0] === "Q cardio 3? (Phone's wording)" && (await B.evaluate(() => (window as any).yuzu.editConflicts.length)) === 0);
  await sync(B); await sync(A); ok("06-5: …on the Phone too", (await noteBy(A, "Q cardio 3?"))?.fields[0] === "Q cardio 3? (Phone's wording)");

  // ---- 06-6: suspend on the Phone, review on the Deck (later)
  const n4 = (await noteBy(A, "Q cardio 4?"))!; const c4 = n4.cards[0].id;
  await A.evaluate((id) => (window as any).yuzu.setSuspended(id, true), c4); await A.waitForTimeout(20);
  await B.evaluate((id) => (window as any).yuzu.answer(id, 3, 3000), c4);
  await sync(B); await sync(A); await sync(B);
  const s4a = (await noteBy(A, "Q cardio 4?"))!.cards[0], s4b = (await noteBy(B, "Q cardio 4?"))!.cards[0];
  ok("06-6: the card stays suspended AND keeps the Deck's review, on both devices", s4a.s && s4b.s && s4a.reps === 1 && s4b.reps === 1, JSON.stringify([s4a, s4b]));

  // ---- 10-18: answer → delete → undo delete → undo answer
  const n5 = (await noteBy(A, "Q cardio 5?"))!; const c5 = n5.cards[0].id;
  const r = await A.evaluate(async ([nid, cid]) => { const y = (window as any).yuzu; await y.answer(cid, 3, 2000); await y.deleteNotes([nid]); await y.undoDelete(); const u = await y.undoLast(); return { undone: !!u, reps: y.cards.get(cid)?.reps }; }, [n5.id, c5] as const);
  ok("10-18: after undoing the delete, ↶ still undoes the answer", r.undone && r.reps === 0, JSON.stringify(r));
  await sync(A); await sync(B);
  ok("10-18: …and the other device gets the note back unreviewed", (await noteBy(B, "Q cardio 5?"))?.cards[0]?.reps === 0);
  if (shots) {
    let last: Page = B;
    for (const [w, ui] of [[360, "clean"], [1440, "paper"]] as const) {
      const p = await B.context().newPage(); await p.setViewportSize({ width: w, height: 900 }); await p.addInitScript((u) => localStorage.setItem("yuzu-ui", u), ui);
      await last.close(); await p.goto(`http://127.0.0.1:${port}/`); await p.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 30000 });
      await p.evaluate(() => { const y = (window as any).yuzu; y.editConflicts = [{ nid: [...y.notes.keys()][1], field: 0, kept: "Kept wording from the Deck", lost: "Replaced wording from the Phone, a much longer sentence to see how it wraps on a narrow phone screen", lostOn: "Phone", keptOn: "this device", at: Date.now(), seen: Date.now() }]; y.bump(); });
      await p.click("nav.tabs >> text=Settings"); await p.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; })); await p.waitForTimeout(400);
      await p.locator(".replaced-edits").scrollIntoViewIfNeeded(); await p.screenshot({ path: `${shots}/replaced-${w}-${ui}.png` });
      last = p;
    }
  }
} catch (e) { fails.push("crashed: " + (e as Error).message); console.log(e); }
finally {
  ok("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close(); server.kill();
  console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join("; ")}` : "\nall passed"); process.exit(fails.length ? 1 : 0);
}
