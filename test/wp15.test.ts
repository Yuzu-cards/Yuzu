import { test } from "node:test";
import assert from "node:assert/strict";
import { heatWeeks } from "../src/lib/heat.ts";
import { buildRoleplayPrompt, factList } from "../src/lib/roleplay.ts";

const DAY = 86400000;
process.env.TZ = process.env.TZ ?? "Asia/Riyadh";

test("heatmap: week columns start on Sunday, today is the last filled cell, legend in exact counts (04-17)", () => {
  // Thursday 12/11/2026, day starting 04:00 Riyadh
  const start = new Date("2026-11-12T04:00:00+03:00").getTime();
  const reviews = [{ ts: start + 3600e3, durationMs: 90000 }, { ts: start + 7200e3, durationMs: 30000 }, { ts: start - DAY + 3600e3 }, { ts: start - 200 * DAY }];
  const h = heatWeeks(start, reviews);
  assert.equal(h.days.length, 84);
  const filled = h.days.filter(Boolean); const last = h.days.findLastIndex((d) => d !== null);
  assert.equal(last % 7, 4, "today (Thursday) sits in row 4 (Sun = 0)");
  assert.equal(Math.floor(last / 7), 11, "…in the last week column");
  assert.equal(filled.length, 77 + 5);
  assert.equal(new Date(h.days[0]!.at + 12 * 3600e3).getDay(), 0, "the first cell is a Sunday");
  assert.deepEqual({ n: h.days[last]!.n, mins: h.days[last]!.mins }, { n: 2, mins: 2 });
  assert.equal(h.days[last - 1]!.n, 1); assert.equal(h.max, 2);
  assert.deepEqual(h.legend, [[0, "0"], [2, "1"], [3, "2"]]);
  assert.equal(h.days[last - 1]!.level, 2); assert.equal(h.days[last]!.level, 3);
  assert.ok(h.months[0] && h.months.includes("Nov"), h.months.join(","));
  const big = heatWeeks(start, Array.from({ length: 100 }, () => ({ ts: start + 1000 })));
  assert.deepEqual(big.legend, [[0, "0"], [1, "1–33"], [2, "34–66"], [3, "67–100"]]);
});

test("practice prompt: facts grouped by topic, German talk is its own mode (01-11)", () => {
  const facts = [{ q: "Tricuspid valve in IVDU", a: "", topic: "Cardiovascular" }, { q: "PERC rule items?", a: "Age ≥ 50 …", topic: "Cardiovascular" }, { q: "Reed–Sternberg cells", a: "Hodgkin lymphoma", topic: "Pathology" }];
  const list = factList(facts);
  assert.equal(list, "Cardiovascular:\n1. Tricuspid valve in IVDU\n2. PERC rule items? → Age ≥ 50 …\n\nPathology:\n3. Reed–Sternberg cells → Hodgkin lymphoma");
  assert.equal(factList([{ q: "a", a: "b" }]), "1. a → b", "no heading when there are no topics");
  const viva = buildRoleplayPrompt({ style: "oral", facts });
  assert.match(viva, /senior examiner/); assert.match(viva, /\n1\. /);
  const de = buildRoleplayPrompt({ style: "german", facts: [{ q: "die Blutabnahme", a: "blood draw. Plural: die Blutabnahmen", topic: "Klinik" }] });
  assert.match(de, /Oberarzt/); assert.match(de, /Speak German only/); assert.match(de, /"type":"vocab"/); assert.match(de, /German::Inbox/);
  assert.doesNotMatch(de, /senior examiner/);
});
