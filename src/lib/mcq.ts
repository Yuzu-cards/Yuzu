// Multiple-choice cards ("Yuzu MCQ" notes). The Options field holds one option per line; the right one starts with "*",
// and an explanation for that option may follow " || ":   *IV calcium gluconate || Stabilises the membrane
export interface McqOption { text: string; correct: boolean; why: string }
export const MCQ_ID = "yuzu-mcq";
export function parseOptions(field: string): McqOption[] {
  return field.split(/\r?\n|<br\s*\/?>/i).map((l) => l.trim()).filter(Boolean).map((l) => {
    const correct = l.startsWith("*"); const body = correct ? l.slice(1).trim() : l; const [text, ...why] = body.split(/\s*\|\|\s*/);
    return { text: text.trim(), correct, why: why.join(" || ").trim() };
  }).filter((o) => o.text);
}
export function formatOptions(opts: McqOption[]): string { return opts.map((o) => `${o.correct ? "*" : ""}${o.text}${o.why ? " || " + o.why : ""}`).join("\n"); }
/** A pack card's options: strings plus `answer` (0-based index or letter), or objects { text, correct?, why? }. */
export function optionsFromPack(options: unknown, answer: unknown): McqOption[] {
  if (!Array.isArray(options)) return [];
  const idx = typeof answer === "number" ? answer : typeof answer === "string" && /^[A-Za-z]$/.test(answer.trim()) ? answer.trim().toUpperCase().charCodeAt(0) - 65 : -1;
  return options.map((o, i) => typeof o === "string" ? { text: o.trim(), correct: i === idx, why: "" } : { text: String(o?.text ?? "").trim(), correct: !!o?.correct || i === idx, why: String(o?.why ?? "").trim() }).filter((o) => o.text);
}
export const valid = (opts: McqOption[]) => opts.length >= 2 && opts.filter((o) => o.correct).length >= 1;
/** The same card always shows the options in the same order within a sitting, but a different order the next time (seeded shuffle). */
export function shuffled<T>(items: T[], seed: string): T[] {
  let h = 2166136261; for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const a = [...items]; const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a;
}
