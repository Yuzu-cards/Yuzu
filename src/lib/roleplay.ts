// "Practice with Claude": a ready-to-paste prompt that turns the cards you are weakest on into a spoken-style oral exam, a patient case
// or a teach-back. Yuzu has no server and no API key, so it writes the prompt and you paste it into Claude.
export type RoleplayStyle = "oral" | "case" | "teach";
export interface RoleplayFact { q: string; a: string }
export const STYLES: Record<RoleplayStyle, { label: string; role: string; how: string }> = {
  oral: { label: "Oral exam", role: "a strict but fair senior examiner running a viva", how: "Ask one question at a time, starting with a short recall question on a fact and then pushing one step further (why, what next, what if). Don't give the answer until I've tried." },
  case: { label: "Patient case", role: "an emergency department consultant presenting a patient to me", how: "Build one realistic case around these facts and reveal it in stages (presentation, then vitals, then results when I ask). Ask what I'd do next at each stage, and let me make a decision before telling me what happens." },
  teach: { label: "Teach it back", role: "a curious junior colleague who knows nothing about these topics", how: "Ask me to explain each fact in my own words as if teaching you. Ask naive follow-up questions where my explanation is vague, and tell me honestly where I was wrong or left something out." },
};
export function buildRoleplayPrompt(o: { style: RoleplayStyle; facts: RoleplayFact[]; goal?: string }): string {
  const s = STYLES[o.style]; const facts = o.facts.map((f, i) => `${i + 1}. ${f.q}${f.a ? " → " + f.a : ""}`).join("\n");
  return [
    `Play ${s.role}. I'm a doctor${o.goal ? ` revising for ${o.goal}` : ""}, and these are the facts from my flashcards that I'm weakest on right now:`,
    "", facts, "",
    `How to run it: ${s.how}`,
    "Use my facts as the ground truth for what I should know. You may add clinical context, but say so when something goes beyond my list, and check anything clinical against current guidelines rather than guessing.",
    "After each of my answers: say in one or two lines what was right and what was missing, then move on. Keep it conversational and short. Start now with the first question.",
    "When I say \"finish\", list the facts I got wrong or hesitated on, and give me 3–6 new Yuzu cards for them as one JSON file I can drop in my inbox: {\"yuzu_pack\":1, \"id\":\"practice-<date>\", \"name\":\"Practice misses\", \"category\":\"Medicine::Inbox\", \"cards\":[{\"id\":\"…\", \"type\":\"cloze\"|\"basic\"|\"mcq\", \"text\"|\"front\"/\"back\"|(\"question\", \"options\":[…], \"answer\":0-based index, \"explanation\"), \"extra\"}]} — one fact per card, cloze gaps for lists.",
  ].join("\n");
}
