// Read and make cards (1.10.0, after SuperMemo / RemNote's incremental reading): a pasted text is cut into lines; the
// words you tap become gaps; the lines with gaps become an ordered cloze deck (line numbers kept, so the previous-line
// strip shows the story around each card). Pure functions, tested in test/story.test.ts.

/** The text cut into lines: at sentence ends (. ! ? … followed by a capital, a quote or a bracket) and at line breaks. */
export function splitLines(text: string, max = 400): string[] {
  return (text ?? "").replace(/\r/g, "").split(/\n+/).flatMap((para) => para.split(/(?<=[.!?…»"“”])\s+(?=[\p{Lu}„"«»(\d])/u)).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, max);
}
/** A line as tokens: words (gap-able) and what sits between them. */
export function tokens(line: string): { t: string; word: boolean }[] {
  const out: { t: string; word: boolean }[] = []; let last = 0;
  for (const m of line.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)) { if (m.index! > last) out.push({ t: line.slice(last, m.index), word: false }); out.push({ t: m[0], word: true }); last = m.index! + m[0].length; }
  if (last < line.length) out.push({ t: line.slice(last), word: false });
  return out;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/**
 * The cloze text for a line with the chosen word tokens as gaps. Neighbouring chosen words (with only spaces between)
 * become one gap. `each`: every gap its own card (c1, c2…); else all gaps on one card (c1).
 */
export function clozeLine(line: string, chosen: Set<number>, each = false): string {
  const tk = tokens(line); let out = ""; let n = 0;
  for (let i = 0; i < tk.length; i++) {
    if (!chosen.has(i)) { out += esc(tk[i].t); continue; }
    let j = i; while (j + 2 < tk.length && /^\s+$/.test(tk[j + 1].t) && chosen.has(j + 2)) j += 2;
    n++; out += `{{c${each ? n : 1}::${esc(tk.slice(i, j + 1).map((x) => x.t).join(""))}}}`; i = j;
  }
  return out;
}
/** The pack for the chosen gaps: one card per line that has a gap; line numbers are the line's place in the text. */
export function readPack(o: { title: string; category: string; lang?: string; lines: string[]; gaps: Map<number, Set<number>>; each?: boolean; source?: string }) {
  const slug = o.title.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "text";
  const cards = o.lines.map((line, i) => ({ line, i, g: o.gaps.get(i) })).filter((x) => x.g && x.g.size).map((x) => ({ id: `l${x.i + 1}`, seq: (x.i + 1) * 10, type: "cloze" as const, text: clozeLine(x.line, x.g!, o.each) }));
  // the id comes from the text too: saving the same text again updates its cards; another text with the same title never overwrites them
  let h = 5381; for (const ch of o.lines.slice(0, 5).join("\n")) h = (Math.imul(h, 33) ^ ch.charCodeAt(0)) >>> 0;
  return { yuzu_pack: 1 as const, id: `read-${slug}-${h.toString(36)}`, name: o.title, category: o.category, ordered: true, prevLine: true, ...(o.lang ? { lang: o.lang } : {}), ...(o.source ? { source: o.source } : {}), cards };
}
