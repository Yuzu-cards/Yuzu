// WP05 end to end against an in-memory Google, two devices on Drive:
//  - settings merge field by field (05-2): a study setting on A survives a colour change on B
//  - status.json (06-7, 06-8): a device behind never overwrites a fresher status; a binned status.json is recreated
//  - Drive backups (06-10): Bring back deleted leaves retired cards retired; Roll back is the collection as it was
//  - restore from a file (05-6, 10-7): a question first, a visible result, this device's own settings kept, absurd values clamped
import { chromium } from "playwright"; import { spawn } from "node:child_process"; import fs from "node:fs";
import { fakeGoogle } from "../fake-google.ts";
const port = 5050 + Number(process.env.PORT_OFFSET ?? 0); const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const G = fakeGoogle(); const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const HUB = ["My Apps", "hub", "yuzu"];
const scratch = "/tmp/claude-0/-home-claude/a4e6c5d5-ff32-5a83-8739-0d47ab59416d/scratchpad"; fs.mkdirSync(`${scratch}/wp05`, { recursive: true });
async function device(name: string) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } }); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + ": " + e.message));
  page.on("dialog", (d) => { errors.push(name + ": a native dialog opened: " + d.message()); d.dismiss(); });
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_FAILED|ERR_CONNECTION_RESET|favicon/.test(m.text())) errors.push(name + " console: " + m.text()); });
  await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ status: 200, body: G.gisScript, contentType: "text/javascript" }));
  await page.route(/https:\/\/www\.googleapis\.com\/.*/, async (route) => {
    const req = route.request(); const h = await req.allHeaders(); const buf = req.postDataBuffer(); let res: Response;
    try { res = await G.fetchImpl(req.url(), { method: req.method(), headers: h, body: buf ? new Blob([buf as BlobPart]) : undefined } as any); } catch { await route.abort("connectionreset"); return; }
    await route.fulfill({ status: res.status, body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("Content-Type") ?? "application/octet-stream" });
  });
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector("text=Nothing to study yet", { timeout: 15000 });
  await page.click("nav.tabs >> text=Settings"); await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.fill('input[placeholder="S25 Ultra"]', name); await page.keyboard.press("Tab");
  return page;
}
const y = (p: any, f: string) => p.evaluate(f);
const waitSync = (p: any) => p.evaluate(async () => { const y = (window as any).yuzu; for (let i = 0; i < 600 && (y.syncStatus.state === "syncing" || y.syncAgain); i++) await new Promise((r) => setTimeout(r, 100)); await y.sync("manual"); await new Promise((r) => setTimeout(r, 200)); for (let i = 0; i < 600 && (y.syncStatus.state === "syncing" || y.syncAgain); i++) await new Promise((r) => setTimeout(r, 100)); await y.sync("manual"); for (let i = 0; i < 600 && (y.syncStatus.state === "syncing" || y.syncAgain); i++) await new Promise((r) => setTimeout(r, 100)); return y.syncStatus; }); // twice: a sync already running (auto) can make the first call a no-op; "manual" takes a fresh look at the changes feed
const status = () => { const m = G.at(HUB); return m.has("status.json") ? JSON.parse(m.get("status.json")!) : null; };
try {
  const A = await device("Phone");
  await A.locator("input[type=file]").first().setInputFiles("test/fixtures/legacy-with-media.apkg");
  await A.waitForFunction(() => /Imported/.test(document.body.innerText), null, { timeout: 120000 }).catch(async (e) => { await A.screenshot({ path: `${scratch}/wp05/import-fail.png`, fullPage: false }); console.log((await A.evaluate(() => document.body.innerText)).slice(0, 1500)); throw e; });
  await A.click("button:has-text('Connect Google')");
  await A.waitForFunction(() => (window as any).yuzu?.syncBackend?.() === "drive", null, { timeout: 20000 });
  const s1 = await waitSync(A); ok("A's first sync", s1.state === "ok", s1.message);
  const B = await device("Deck");
  await B.click("button:has-text('Connect Google')"); await B.waitForFunction(() => (window as any).yuzu?.syncBackend?.() === "drive", null, { timeout: 20000 });
  const sB = await waitSync(B); ok("B pulls the collection", (await y(B, "window.yuzu.cards.size")) === (await y(A, "window.yuzu.cards.size")) && (await y(B, "window.yuzu.cards.size")) > 0, sB.message);

  // ---- 05-2: field by field
  await A.evaluate(() => (window as any).yuzu.saveSettings({ newPerDay: 45 }));
  await B.evaluate(() => (window as any).yuzu.saveSettings({ theme: "night", swipe: false }));
  await waitSync(A); await waitSync(B); await waitSync(A);
  const nA = await y(A, "[window.yuzu.settings.newPerDay, window.yuzu.settings.theme, window.yuzu.settings.swipe, window.yuzu.settings.deviceName]"), nB = await y(B, "[window.yuzu.settings.newPerDay, window.yuzu.settings.theme, window.yuzu.settings.swipe, window.yuzu.settings.deviceName]");
  ok("05-2: A's New cards/day survives B's colour change", nA[0] === 45 && nB[0] === 45, JSON.stringify({ nA, nB }));
  ok("…and B's colours and swipe stay on B", nB[1] === "night" && nA[1] !== "night" && nB[2] === false && nA[2] === true && nA[3] === "Phone" && nB[3] === "Deck", JSON.stringify({ nA, nB }));
  await B.evaluate(() => (window as any).yuzu.saveSettings({ dailyGoal: 180 })); await A.evaluate(() => (window as any).yuzu.saveSettings({ deadlines: [{ id: "s1", name: "Step 1", date: "2027-03-01", view: "decks", path: "" }] }));
  await waitSync(B); await waitSync(A); await waitSync(B);
  ok("05-2: two study settings changed on two devices both arrive", (await y(A, "window.yuzu.settings.dailyGoal")) === 180 && (await y(B, "window.yuzu.settings.deadlines.length")) === 1, await y(A, "JSON.stringify([window.yuzu.settings.dailyGoal, window.yuzu.settings.deadlines.length, window.yuzu.syncStatus.message])") + " / " + await y(B, "JSON.stringify([window.yuzu.settings.dailyGoal, window.yuzu.settings.deadlines.length, window.yuzu.syncStatus.message])"));

  // ---- 06-8: a device that is behind does not overwrite a fresher status
  await A.evaluate(async () => { const y = (window as any).yuzu; for (const c of [...y.cards.values()].slice(0, 3)) await y.answer(c.id, 3); });
  await waitSync(A); const wA = await A.evaluate(() => (window as any).yuzu.writeHubStatus(true));
  ok("A (3 reviews today) wrote status.json", status()?.device === "Phone" && status()?.extra?.reviewedToday === 3, JSON.stringify([status()?.device, status()?.extra?.reviewedToday, await y(A, "window.yuzu.syncStatus.message"), await y(A, "window.yuzu.reviewedToday().reviews")]));
  const wroteB = await B.evaluate(() => (window as any).yuzu.writeHubStatus(true));
  ok("06-8: B, not yet pulled A's reviews, leaves A's fresher status alone", !wroteB && status()?.device === "Phone" && status()?.extra?.reviewedToday === 3, JSON.stringify({ wroteB, device: status()?.device, n: status()?.extra?.reviewedToday }));
  await waitSync(B); const wroteB2 = await B.evaluate(() => (window as any).yuzu.writeHubStatus(true));
  ok("…after its sync B holds the same numbers and may write", wroteB2 && status()?.device === "Deck" && status()?.extra?.reviewedToday === 3, JSON.stringify({ wroteB2, device: status()?.device, n: status()?.extra?.reviewedToday }));
  // ---- 06-7: status.json binned on Drive
  const sid = [...G.files.values()].find((f) => f.name === "status.json" && !f.trashed)!.id; G.files.get(sid)!.trashed = true;
  ok("status.json is in the bin", !G.at(HUB).has("status.json"));
  await A.evaluate(async () => { const y = (window as any).yuzu; await y.answer([...y.cards.values()][5].id, 3); }); await waitSync(A); await waitSync(B); await waitSync(A);
  const wroteA = await A.evaluate(() => (window as any).yuzu.writeHubStatus(true));
  ok("06-7: the next write recreates status.json where Citrus looks", wroteA && status()?.device === "Phone" && G.files.get(sid)!.trashed, JSON.stringify({ wroteA, s: status()?.device }));

  // ---- 06-10: Drive backups
  const bmsg = await A.evaluate(() => (window as any).yuzu.backupNow(true)); ok("backup taken", /Backed up/.test(bmsg), bmsg);
  const day = await A.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  const before = await A.evaluate(() => { const y = (window as any).yuzu; return { notes: y.notes.size, cards: y.cards.size, reviews: y.reviews.length }; });
  const setup = await A.evaluate(async () => {
    const y = (window as any).yuzu; const cards = [...y.cards.values()];
    const byNote = new Map<string, any[]>(); for (const c of cards) byNote.set(c.nid, [...(byNote.get(c.nid) ?? []), c]);
    const singles = [...byNote.entries()].filter(([, cs]) => cs.length === 1).map(([nid]) => nid);
    const retireNid = singles[0], deleteNid = singles[1]; const retireCid = byNote.get(retireNid)![0].id;
    await y.masterCards([retireCid], "you"); await y.deleteNotes([deleteNid]);
    // a note added after the backup (as the editor would: note + card)
    const n0 = y.notes.get(singles[2]); const c0 = byNote.get(singles[2])![0]; const t = Date.now();
    const note = { ...n0, id: "wp05-new", guid: "wp05-new", fields: ["Added after the backup", "yes"], created: t, modified: t }; const card = { ...c0, id: "wp05-newc", nid: "wp05-new", state: "new", reps: 0, lapses: 0, mod: t };
    y.notes.set(note.id, note); y.cards.set(card.id, card); await y._db.putMany("notes", [note]); await y._db.putMany("cards", [card]);
    for (const c of [...y.cards.values()].slice(0, 3)) await y.answer(c.id, 1);
    return { retireCid, retireNid, deleteNid };
  });
  const pv = await A.evaluate((d) => (window as any).yuzu.previewBackup(d, "missing"), day);
  ok("06-10: Bring back deleted counts the deleted note and leaves the retired card out", pv.notes === 1 && pv.retiredSkipped === 1, JSON.stringify(pv));
  const r1 = await A.evaluate((d) => (window as any).yuzu.restoreBackup(d, "missing"), day);
  const st1 = await A.evaluate((s) => { const y = (window as any).yuzu; return { del: y.notes.has(s.deleteNid), retired: y.cards.has(s.retireCid), log: y.mastery.log.some((e: any) => e.id === s.retireCid) }; }, setup);
  ok("…brings back the deleted note, not the retired card (still in the Mastered log)", st1.del && !st1.retired && st1.log, JSON.stringify({ r1, st1 }));
  const pa = await A.evaluate((d) => (window as any).yuzu.previewBackup(d, "all"), day);
  ok("Roll back counts what goes: the note added since and the reviews made since", pa.notesRemoved === 1 && pa.reviewsRemoved === 3 && pa.unretired === 1, JSON.stringify(pa));
  await A.evaluate((d) => (window as any).yuzu.restoreBackup(d, "all"), day);
  const after = await A.evaluate((s) => { const y = (window as any).yuzu; return { notes: y.notes.size, cards: y.cards.size, reviews: y.reviews.length, added: y.notes.has("wp05-new"), retired: y.cards.has(s.retireCid), log: y.mastery.log.some((e: any) => e.id === s.retireCid) }; }, setup);
  ok("06-10: Roll back is the collection as it was (notes, cards, reviews)", after.notes === before.notes && after.cards === before.cards && after.reviews === before.reviews && !after.added && after.retired && !after.log, JSON.stringify({ before, after }));
  await waitSync(A); await waitSync(B); await waitSync(A);
  const onB = await B.evaluate((s) => { const y = (window as any).yuzu; return { notes: y.notes.size, reviews: y.reviews.length, added: y.notes.has("wp05-new"), retired: y.cards.has(s.retireCid), log: y.mastery.log.some((e: any) => e.id === s.retireCid) }; }, setup);
  const onA = await A.evaluate((s) => ({ log: (window as any).yuzu.mastery.log.some((e: any) => e.id === s.retireCid) }), setup);
  ok("…and the other device follows (the Mastered log entry does not come back)", onB.notes === before.notes && onB.reviews === before.reviews && !onB.added && onB.retired && !onB.log && !onA.log, JSON.stringify(onB));

  // ---- 05-6 / 10-7: restore a backup file
  await A.click("nav.tabs >> text=Settings"); await A.evaluate(() => document.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await A.evaluate(() => (window as any).yuzu.saveSettings({ theme: "night", newPerDay: 33 }));
  const nt0 = await A.evaluate(() => { const nt = [...(window as any).yuzu.notetypes.values()][0]; return { id: nt.id, name: nt.name }; });
  const file = { app: "yuzu", version: 1, at: new Date("2026-10-13T10:00:00").getTime(), settings: { newPerDay: -5, dailyGoal: 0, deviceName: "old-phone", theme: "gameboy", scheduler: { desiredRetention: 0 }, sync: { backend: "github", owner: "attacker", repo: "evil", token: "", auto: true } }, notetypes: [{ ...nt0, name: "Overwritten", fields: [], templates: [] }], cards: [], reviews: [] };
  fs.writeFileSync(`${scratch}/wp05/restore.json`, JSON.stringify(file)); fs.writeFileSync(`${scratch}/wp05/bad.json`, "{not json");
  const restoreInput = A.locator('#s-data input[type=file]');
  await restoreInput.setInputFiles(`${scratch}/wp05/bad.json`); await A.waitForTimeout(300);
  ok("05-6: a file that isn't a backup says so in the Data section", /Restore failed/.test(await A.locator("#s-data").innerText()));
  await restoreInput.setInputFiles(`${scratch}/wp05/restore.json`); await A.waitForTimeout(300);
  const sheet = await A.locator(".sheet, [role=dialog]").last().innerText().catch(() => "");
  ok("05-6: restoring asks first, with the date and what is in it", /Merge the backup from 13\/10\/2026/.test(sheet), sheet.slice(0, 200));
  await A.screenshot({ path: `${scratch}/wp05/restore-sheet.png` });
  await A.click("button:has-text('Merge backup')"); await A.waitForTimeout(800);
  const dataText = await A.locator("#s-data").innerText();
  ok("05-6: the result shows in the Data section", /Restored: 0 cards/.test(dataText), dataText.slice(-200));
  const st = await A.evaluate((id) => { const y = (window as any).yuzu; const s = y.settings; return { npd: s.newPerDay, goal: s.dailyGoal, ret: s.scheduler.desiredRetention, name: s.deviceName, theme: s.theme, backend: s.sync.backend, owner: s.sync.owner, nt: y.notetypes.get(id).name }; }, nt0.id);
  ok("10-7: this device's name, sync target and colours are kept", st.name === "Phone" && st.backend === "drive" && st.owner !== "attacker" && st.theme === "night", JSON.stringify(st));
  ok("10-7: absurd values are clamped (new 0, goal 1, recall 70%)", st.npd === 0 && st.goal === 1 && st.ret === 0.7, JSON.stringify(st));
  ok("10-7: a note type this device has is not overwritten", st.nt === nt0.name, st.nt);
  await A.screenshot({ path: `${scratch}/wp05/data.png` });
  // the Settings tags
  const tags = await A.evaluate(() => Object.fromEntries(["s-study", "s-media", "s-google"].map((id) => [id, document.querySelector(`#${id} > summary .where`)?.textContent ?? ""])));
  ok("05-5: mixed groups say so", /syncs · 3 this device/.test(tags["s-study"]) && /this device · 2 sync/.test(tags["s-media"]) && /syncs · sign-in this device/.test(tags["s-google"]), JSON.stringify(tags));
  await A.locator("#s-study > summary").screenshot({ path: `${scratch}/wp05/tag-study.png` });
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails); process.exitCode = 1; }
  await browser.close(); server.kill();
}
