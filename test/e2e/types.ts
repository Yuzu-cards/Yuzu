// New card types and study modes in a real browser: multiple-choice cards (tap an option, right/wrong shown with the
// explanation, Good/Again suggested), and — added as they land — image occlusion, exam countdown, interleaving drills.
import { chromium } from "playwright"; import { spawn } from "node:child_process";
const port = 4183; const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "-d", "docs"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch(); const errors: string[] = []; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); if (!cond) fails.push(name); };
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }); const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_FAILED|favicon/.test(m.text())) errors.push("console: " + m.text()); });
const y = <T>(f: string): Promise<T> => page.evaluate(f) as Promise<T>;
try {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  // ---- MCQ
  const pack = { yuzu_pack: 1, id: "mcq", name: "MCQ test", category: "Medicine::Emergency Medicine", cards: [
    { id: "q1", type: "mcq", question: "First-line drug for anaphylaxis?", options: ["Adrenaline IM", "Hydrocortisone IV", "Chlorphenamine"], answer: 0, explanation: "IM adrenaline into the anterolateral thigh." },
    { id: "q2", type: "mcq", question: "Peaked T waves suggest?", options: [{ text: "Hypokalaemia", why: "That gives U waves." }, { text: "Hyperkalaemia", correct: true, why: "Peaked T is the first change." }] },
  ] };
  const msg = await page.evaluate((p) => (window as any).yuzu.importPack(p), pack); ok("an MCQ pack imports", /2 cards added/.test(msg), msg);
  await page.reload(); await page.waitForSelector("text=cards ready", { timeout: 20000 }); await page.click(".hero >> text=Study");
  await page.waitForSelector(".mcq", { timeout: 15000 });
  const opts = await page.locator(".mcq-opt").count(); ok("options are drawn as tappable choices", opts >= 2, String(opts));
  const first = await page.locator(".mcq-opt span:nth-child(2)").allInnerTexts();
  const rightIdx = first.findIndex((t) => /Adrenaline IM|^Hyperkalaemia/.test(t)); const wrongIdx = first.findIndex((t, i) => i !== rightIdx);
  await page.locator(".mcq-opt").nth(wrongIdx).click(); await page.waitForSelector(".answer-bar");
  ok("a wrong pick is marked and the right one shown", (await page.locator(".mcq-opt.wrong").count()) === 1 && (await page.locator(".mcq-opt.right").count()) === 1);
  ok("Again is suggested after a wrong pick", (await page.locator(".answer-bar .again.suggest").count()) === 1 && (await page.locator(".answer-bar .good.suggest").count()) === 0);
  await page.click(".answer-bar .again"); await page.waitForTimeout(400);
  // the next card (possibly the same one again in learning) — pick the right one by key
  await page.waitForSelector(".mcq", { timeout: 5000 });
  const t2 = await page.locator(".mcq-opt span:nth-child(2)").allInnerTexts(); const ri = t2.findIndex((t) => /Adrenaline IM|^Hyperkalaemia/.test(t));
  await page.keyboard.press(String(ri + 1)); await page.waitForSelector(".answer-bar");
  ok("pressing a number picks that option; a right pick suggests Good", (await page.locator(".mcq-opt.right").count()) === 1 && (await page.locator(".answer-bar .good.suggest").count()) === 1);
  const back = await page.evaluate(() => (document.querySelector(".study .card-host") as any)?.shadowRoot?.textContent ?? "") + " " + (await page.locator(".mcq").innerText());
  ok("the explanation shows on the back", /anterolateral thigh|Peaked T is the first change/.test(back), back.slice(0, 160).replace(/\s+/g, " "));
  await page.screenshot({ path: "test/e2e/shots/mcq.png" });
  // ---- Image occlusion: draw two boxes in the editor, each becomes a card; study hides that box
  const ctx2 = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }); const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => errors.push("io: " + e.message)); p2.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_FAILED|favicon/.test(m.text())) errors.push("io console: " + m.text()); });
  await p2.goto(`http://127.0.0.1:${port}/`); await p2.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  const png = await p2.evaluate(() => { const c = document.createElement("canvas"); c.width = 600; c.height = 400; const g = c.getContext("2d")!; g.fillStyle = "#cfe"; g.fillRect(0, 0, 600, 400); g.fillStyle = "#c33"; g.fillRect(60, 60, 160, 100); g.fillStyle = "#33c"; g.fillRect(360, 200, 160, 120); return c.toDataURL("image/png").split(",")[1]; });
  await p2.click("nav.tabs >> text=Library"); await p2.click("text=＋ Image");
  await p2.setInputFiles('input[aria-label="Picture"]', { name: "heart.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await p2.waitForSelector('[data-testid="io-canvas"]'); const bb = (await p2.locator('[data-testid="io-canvas"]').boundingBox())!;
  const drawBox = async (x1: number, y1: number, x2: number, y2: number) => { await p2.mouse.move(bb.x + bb.width * x1, bb.y + bb.height * y1); await p2.mouse.down(); await p2.mouse.move(bb.x + bb.width * x2, bb.y + bb.height * y2, { steps: 4 }); await p2.mouse.up(); };
  await drawBox(0.1, 0.15, 0.37, 0.4); await drawBox(0.6, 0.5, 0.87, 0.8); await drawBox(0.5, 0.05, 0.505, 0.06); // the third is a stray tap, too small to count
  ok("dragging draws one box per drag (a tiny stray one is ignored)", (await p2.locator('input[aria-label^="Name of box"]').count()) === 2);
  await p2.fill('input[aria-label="Name of box 1"]', "Red room"); await p2.fill('input[aria-label="Name of box 2"]', "Blue room");
  await p2.click("button:has-text('Make 2 cards')"); await p2.waitForSelector("text=/cards? added/", { timeout: 10000 });
  ok("each box became a card of one note", (await p2.evaluate(() => { const y = (window as any).yuzu; const n = [...y.notes.values()].filter((n: any) => n.ntid === "yuzu-io"); return n.length === 1 && y.cardsOfNote(n[0].id).length === 2; })));
  await p2.evaluate(() => (document.querySelector(".sheet-backdrop .icon-btn") as HTMLElement)?.click());
  await p2.click("nav.tabs >> text=Today"); await p2.click(".hero >> text=Study"); await p2.waitForSelector(".study .card-host", { timeout: 15000 });
  const front = await p2.evaluate(() => (document.querySelector(".study .card-host") as any).shadowRoot.innerHTML);
  ok("study hides one box and outlines the other", (front.match(/class="io-box io-hide"/g) ?? []).length === 1 && (front.match(/class="io-box io-other"/g) ?? []).length === 1);
  await p2.click("text=Show answer"); await p2.waitForSelector(".answer-bar");
  const ioBack = await p2.evaluate(() => (document.querySelector(".study .card-host") as any).shadowRoot.innerHTML);
  ok("the back opens the box and shows its name", /class="io-box io-open"/.test(ioBack) && /(Red|Blue) room/.test(ioBack));
  await p2.screenshot({ path: "test/e2e/shots/occlusion.png" });
  // ---- Exam countdown and mixed drill
  const ctx3 = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }); const p3 = await ctx3.newPage();
  p3.on("pageerror", (e) => errors.push("exam: " + e.message)); p3.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_FAILED|favicon/.test(m.text())) errors.push("exam console: " + m.text()); });
  await p3.goto(`http://127.0.0.1:${port}/`); await p3.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  const cards = (sys: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: sys + i, type: "basic", front: `${sys} question ${i} about topic ${i * 7}`, back: `answer ${i}`, tags: ["auto::System::" + sys] }));
  await p3.evaluate((cs) => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "exam", category: "Medicine::Step 1", cards: cs }), [...cards("Cardio", 20), ...cards("Renal", 20)]);
  await p3.evaluate(async () => { const y = (window as any).yuzu; const list = [...y.cards.values()]; for (const c of list.slice(0, 8)) await y.answer(c.id, 3, 1500); for (const c of list.slice(20, 28)) await y.answer(c.id, 3, 1500); });
  const inDays = (n: number) => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  await p3.evaluate((date) => (window as any).yuzu.saveSettings({ newPerDay: 2, deadlines: [{ id: "e1", name: "Step 1", date, view: "decks", path: "" }] }), inDays(10));
  const es = await p3.evaluate(() => { const y = (window as any).yuzu; return y.examStatus(y.settings.deadlines[0]); });
  ok("exam status counts the scope", es.total === 40 && es.seen > 0 && es.unseen === 40 - es.seen && es.daysLeft >= 9 && es.daysLeft <= 11, JSON.stringify(es));
  ok("…needs more new cards a day than the limit allows → not on track", es.needPerDay > 2 && !es.onTrack && es.finishOn !== null, `${es.needPerDay}/day`);
  const drill = await p3.evaluate(() => { const y = (window as any).yuzu; const q = y.drillQueue(10); return q.map((c: any) => y.notes.get(c.nid).tags.find((t: string) => t.startsWith("auto::System::"))); });
  ok("the mixed drill alternates systems", drill.length === 10 && drill.every((t: string, i: number) => i === 0 || t !== drill[i - 1]), drill.join(","));
  await p3.click("nav.tabs >> text=Today"); await p3.waitForSelector("text=Step 1", { timeout: 5000 });
  ok("Today shows the countdown and its verdict", /10 days|9 days|11 days/.test(await p3.locator(".screen").innerText()) && /Needs \d+ new cards a day/.test(await p3.locator(".screen").innerText()));
  const hs = await p3.evaluate(async () => (await (window as any).yuzu.hubStatus())); ok("status.json asks about the exam when behind", hs.pending.some((t: string) => /Step 1 in \d+ days: needs/.test(t)) && hs.extra.exams?.[0]?.name === "Step 1", JSON.stringify(hs.pending));
  await p3.click("text=Practice with Claude"); await p3.waitForSelector('textarea[aria-label="Prompt for Claude"]');
  const pr = await p3.inputValue('textarea[aria-label="Prompt for Claude"]');
  ok("Practice with Claude builds a prompt from the weak cards", /\n1\. (Cardio|Renal) question \d+ about topic/.test(pr) && /Step 1/.test(pr) === false && /yuzu_pack/.test(pr), pr.slice(0, 120).replace(/\n/g, " "));
  await p3.click("button:has-text('Patient case')"); ok("…the style changes the role it plays", /emergency department consultant/.test(await p3.inputValue('textarea[aria-label="Prompt for Claude"]')));
  await p3.selectOption("select >> nth=0", { label: "Step 1 (exam)" }); ok("…and an exam can be chosen as the source", /revising for Step 1/.test(await p3.inputValue('textarea[aria-label="Prompt for Claude"]')));
  await p3.click('button[aria-label="Close practice"]');
  await p3.click("text=Mixed drill"); await p3.waitForSelector(".study .card-host", { timeout: 10000 });
  ok("the mixed drill opens as a study session", (await p3.locator(".study-top").count()) > 0);
  await p3.screenshot({ path: "test/e2e/shots/exam.png" });
  // ---- Hands-free review (speech mocked: the card is "said", then the answer "heard")
  const ctx4 = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }); const p4 = await ctx4.newPage();
  p4.on("pageerror", (e) => errors.push("voice: " + e.message)); p4.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_FAILED|favicon/.test(m.text())) errors.push("voice console: " + m.text()); });
  await p4.addInitScript(() => {
    (window as any).__said = []; Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speak(u: any) { (window as any).__said.push(u.text); setTimeout(() => u.onend && u.onend(), 5); }, cancel() {} } });
    (window as any).SpeechSynthesisUtterance = function (this: any, t: string) { this.text = t; };
    (window as any).SpeechRecognition = function (this: any) { this.start = () => { setTimeout(() => this.onresult && this.onresult({ resultIndex: 0, results: [[{ transcript: "okay, good" }]] }), 30); }; this.abort = () => {}; };
  });
  await p4.goto(`http://127.0.0.1:${port}/`); await p4.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  await p4.evaluate(() => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "v", category: "Medicine::Voice", cards: [{ id: "a", front: "Antidote for digoxin toxicity?", back: "Digoxin-specific Fab fragments" }, { id: "b", front: "Antidote for paracetamol overdose?", back: "N-acetylcysteine" }] }));
  await p4.reload(); await p4.waitForSelector("text=cards ready", { timeout: 20000 }); await p4.click(".hero >> text=Study"); await p4.waitForSelector(".study .card-host", { timeout: 15000 });
  await p4.click('button[aria-label="More"]'); await p4.click("text=Hands-free (read aloud, answer by voice)");
  await p4.waitForFunction(() => (window as any).yuzu.reviews.length >= 2, null, { timeout: 40000 }).catch(() => {});
  const vs = await p4.evaluate(() => ({ said: (window as any).__said, ratings: (window as any).yuzu.reviews.map((r: any) => r.rating) }));
  ok("hands-free reads the question, then the answer", vs.said.some((t: string) => /Antidote for (digoxin|paracetamol)/.test(t)) && vs.said.some((t: string) => /Fab fragments|acetylcysteine/.test(t)), JSON.stringify(vs.said).slice(0, 200));
  ok("…and grades each card by what is heard (\"okay, good\" = Good)", vs.ratings.length >= 2 && vs.ratings.every((r: number) => r === 3), JSON.stringify(vs.ratings));
  // ---- Reminders: permission asked from a tap, the facts the service worker reads are left in IndexedDB
  const ctx5 = await browser.newContext({ viewport: { width: 412, height: 915 }, permissions: ["notifications"] }); const p5 = await ctx5.newPage();
  p5.on("pageerror", (e) => errors.push("remind: " + e.message));
  await p5.addInitScript(`Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "granted", requestPermission: () => Promise.resolve("granted") } });`); // headless Chromium reports "denied" whatever is granted
  await p5.goto(`http://127.0.0.1:${port}/`); await p5.waitForFunction(() => (window as any).yuzu?.loaded, null, { timeout: 20000 });
  await p5.evaluate(() => (window as any).yuzu.importPack({ yuzu_pack: 1, id: "r", category: "Medicine::R", cards: [{ id: "a", front: "Q one", back: "A" }, { id: "b", front: "Q two", back: "B" }] }));
  const rm = await p5.evaluate(() => (window as any).yuzu.setReminders({ on: true, at: "18:30" })); const nudge = await p5.evaluate(() => (window as any).yuzu._db.getMeta("nudge", null));
  ok("reminders turn on and say honestly what this browser can do", /Reminders on|can't wake Yuzu/.test(rm), rm);
  ok("…the facts for the service worker are stored", !!nudge && nudge.on === true && nudge.at === "18:30" && nudge.due >= 2 && nudge.goalMet === false && typeof nudge.light === "object", JSON.stringify(nudge).slice(0, 160));
  const off = await p5.evaluate(async () => { const y = (window as any).yuzu; await y.setReminders({ on: false }); return (await y._db.getMeta("nudge", null)).on; }); ok("…and turning them off clears the flag", off === false);
} finally {
  console.log("errors:", errors.length ? errors : "none"); if (fails.length || errors.length) { console.log("FAILED:", fails); process.exitCode = 1; }
  await browser.close(); server.kill();
}
