// 1.9.0 at full scale: 146k cards with a 2,000-line ordered story and capped decks — queue, line order, dictionary.
import { Store } from "../../src/lib/store.ts";
const s = new Store(); (s as any).touch = () => {}; (s as any).persist = async (_w: string, p: Promise<unknown>) => p.catch(() => undefined);
s.notetypes.set("t", { id: "t", name: "Basic", kind: "standard", fields: ["Front", "Back"], templates: [], css: "" } as any);
s.notetypes.set("yuzu-vocab", { id: "yuzu-vocab", name: "V", kind: "standard", fields: ["Word", "Meaning", "Audio", "Source", "Article", "Plural", "Example", "Lang"], templates: [], css: "" } as any);
const decks = ["Medicine::Cardio::A", "Medicine::Renal::B", "Medicine::Neuro", "Languages::German::Goethe A1", "Mephisto::Faust", "Step 1::Pharm"];
let n = 0;
for (let i = 0; i < 100000; i++) {
  const deck = decks[i % decks.length]; const id = "n" + i; const vocab = deck.includes("Goethe") && i % 2 === 0;
  s.notes.set(id, { id, ntid: vocab ? "yuzu-vocab" : "t", guid: id, fields: vocab ? ["Wort" + i, "word " + i, "", "", "der", "", "", "de-DE"] : ["front text number " + i, "back " + i], tags: [], created: (i * 7919) % 100000, modified: 1, ...(deck === "Mephisto::Faust" ? { seq: i } : {}) } as any);
  for (let k = 0; k < (i % 3 === 0 ? 2 : 1); k++) { n++; s.cards.set(`${id}-${k}`, { id: `${id}-${k}`, nid: id, ord: k, state: i % 4 === 0 ? "review" : "new", suspended: false, flag: 0, due: i % 4 === 0 ? Date.now() - 1000 : i, stability: 5, difficulty: 5, reps: 1, lapses: 0, lastReview: Date.now() - 5 * 864e5, step: 0, created: i, mod: 0, source: deck } as any); }
}
s.loaded = true;
const t = (label: string, f: () => unknown, reps = 3) => { let best = 1e9; let r: unknown; for (let i = 0; i < reps; i++) { const a = performance.now(); r = f(); best = Math.min(best, performance.now() - a); } console.log(`${label}: ${best.toFixed(0)} ms`); return r; };
console.log(`${n} cards`);
t("queue(all), no deck options", () => s.queue(""));
s.settings = { ...s.settings, deckOpts: { "Mephisto::Faust": { ordered: true, prevLine: true, newPerDay: 10 }, "Languages::German": { newPerDay: 15 } } };
const q = t("queue(all), ordered story + two caps", () => s.queue("")) as any[];
console.log("  story cards in today's new:", q.filter((c) => c.state === "new" && c.source === "Mephisto::Faust").length, "· German:", q.filter((c) => c.state === "new" && c.source.startsWith("Languages")).length);
t("queue(Mephisto)", () => s.queue("Mephisto"));
const story = [...s.cards.values()].find((c) => c.source === "Mephisto::Faust")!;
t("lineOf (first, builds the order)", () => { (s as any).lineCache.clear(); return s.lineOf(story); }, 1);
t("lineOf (cached)", () => s.lineOf(story));
t("lexicon build", () => { (s as any).lex = null; return s.lexicon(); }, 1);
t("meaningOf (cached dictionary)", () => s.meaningOf("Wortes"));
t("lineProgress", () => s.lineProgress("Mephisto::Faust"));
{ const a = performance.now(); const deck = new Map<string, string>(); for (const c of s.cards.values()) if (!deck.has(c.nid)) deck.set(c.nid, c.source); console.log("  part: note→deck map", (performance.now() - a).toFixed(0), "ms");
  const b = performance.now(); let k = 0; for (const n of s.notes.values()) { const d = deck.get(n.id); if (d && s.langFor(d)) k++; } console.log("  part: language per note", (performance.now() - b).toFixed(0), "ms", k); }
{ (s as any).lex = null; let worst = 0, last = performance.now(); const tick = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; }, 1);
  const a = performance.now(); s.warmLexicon(); while ((s as any).lexWarming) await new Promise((r) => setTimeout(r, 5)); clearInterval(tick);
  console.log(`warmLexicon in slices: ${(performance.now() - a).toFixed(0)} ms total, longest block ${worst.toFixed(0)} ms, same as a full build: ${s.lexicon().size === (() => { (s as any).lex = null; return s.lexicon().size; })()}`); }
