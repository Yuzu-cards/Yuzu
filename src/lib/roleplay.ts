// "Practice with Claude": a ready-to-paste prompt that turns the cards you are weakest on into a spoken-style oral exam, a patient case
// or a teach-back. Yuzu has no server and no API key, so it writes the prompt and you paste it into Claude.
export type RoleplayStyle = "oral" | "case" | "teach" | "german";
/** One fact: the question and its answer as plain text, and the topic it belongs to (a system or the deck), for grouping. */
export interface RoleplayFact { q: string; a: string; topic?: string }
export const STYLES: Record<RoleplayStyle, { label: string; role: string; how: string }> = {
  oral: { label: "Oral exam", role: "a strict but fair senior examiner running a viva", how: "Ask one question at a time, starting with a short recall question on a fact and then pushing one step further (why, what next, what if). Don't give the answer until I've tried." },
  case: { label: "Patient case", role: "an emergency department consultant presenting a patient to me", how: "Build one realistic case around these facts and reveal it in stages (presentation, then vitals, then results when I ask). Ask what I'd do next at each stage, and let me make a decision before telling me what happens." },
  teach: { label: "Teach it back", role: "a curious junior colleague who knows nothing about these topics", how: "Ask me to explain each fact in my own words as if teaching you. Ask naive follow-up questions where my explanation is vague, and tell me honestly where I was wrong or left something out." },
  german: { label: "German talk", role: "a German Oberarzt on a hospital ward, and in between a German-speaking patient (Arzt–Patient-Gespräch)", how: "Speak German only, at a clear B1–B2 level. Build a short ward conversation (admission, history, explaining a test, handover) in which I need these words, and ask one thing at a time so I have to use them myself. After each of my answers, correct my German in one or two lines in English (word, article, plural, word order), then carry on in German." },
};
/** The cards' subject: German vocabulary gets its own conversation; medical facts get a viva, a case or a teach-back. */
export const isLanguageStyle = (s: RoleplayStyle) => s === "german";
/** Number the facts, with a heading line whenever the topic changes (facts are grouped by topic first). */
export function factList(facts: RoleplayFact[]): string {
  const groups = new Map<string, RoleplayFact[]>(); for (const f of facts) { const k = f.topic ?? ""; (groups.get(k) ?? groups.set(k, []).get(k)!).push(f); }
  const named = [...groups.keys()].some((k) => k); let i = 0; const out: string[] = [];
  for (const [k, fs] of groups) { if (named) out.push(`${out.length ? "\n" : ""}${k || "Other"}:`); for (const f of fs) out.push(`${++i}. ${f.q}${f.a ? " → " + f.a : ""}`); }
  return out.join("\n");
}
export function buildRoleplayPrompt(o: { style: RoleplayStyle; facts: RoleplayFact[]; goal?: string }): string {
  const s = STYLES[o.style]; const facts = factList(o.facts);
  if (isLanguageStyle(o.style)) return [
    `Play ${s.role}. I'm a doctor learning medical German${o.goal ? ` for ${o.goal}` : ""}, and these are the words from my flashcards that I'm weakest on right now:`,
    "", facts, "",
    `How to run it: ${s.how}`,
    "Use my list as the words I must practise; you may use other everyday words around them. Keep it conversational and short. Start now, in German.",
    "When I say \"fertig\" or \"finish\", list (in English) the words I got wrong or avoided, and give me 3–6 new Yuzu cards for them as one JSON file I can drop in my inbox: {\"yuzu_pack\":1, \"id\":\"practice-de-<date>\", \"name\":\"German practice misses\", \"category\":\"German::Inbox\", \"cards\":[{\"id\":\"…\", \"type\":\"vocab\", \"word\", \"article\", \"plural\", \"meaning\", \"example\", \"lang\":\"de-DE\"}]} — one word per card, with a short example sentence from our conversation.",
  ].join("\n");
  return [
    `Play ${s.role}. I'm a doctor${o.goal ? ` revising for ${o.goal}` : ""}, and these are the facts from my flashcards that I'm weakest on right now:`,
    "", facts, "",
    `How to run it: ${s.how}`,
    "Use my facts as the ground truth for what I should know. You may add clinical context, but say so when something goes beyond my list, and check anything clinical against current guidelines rather than guessing.",
    "After each of my answers: say in one or two lines what was right and what was missing, then move on. Keep it conversational and short. Start now with the first question.",
    "When I say \"finish\", list the facts I got wrong or hesitated on, and give me 3–6 new Yuzu cards for them as one JSON file I can drop in my inbox: {\"yuzu_pack\":1, \"id\":\"practice-<date>\", \"name\":\"Practice misses\", \"category\":\"Medicine::Inbox\", \"cards\":[{\"id\":\"…\", \"type\":\"cloze\"|\"basic\"|\"mcq\", \"text\"|\"front\"/\"back\"|(\"question\", \"options\":[…], \"answer\":0-based index, \"explanation\"), \"extra\"}]} — one fact per card, cloze gaps for lists.",
  ].join("\n");
}
