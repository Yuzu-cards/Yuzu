// Hands-free review: the card is read aloud, you answer by voice. Uses the browser's own speech (no server, nothing sent anywhere by Yuzu).
export const RATING_WORDS: Record<string, string[]> = { "1": ["again", "forgot", "wrong", "no", "miss"], "2": ["hard", "difficult"], "3": ["good", "okay", "ok", "right", "yes", "correct", "got it", "next"], "4": ["easy", "perfect"] };
export const LETTER_WORDS: Record<string, string[]> = { "0": ["a", "alpha", "option a", "first"], "1": ["b", "bravo", "option b", "second"], "2": ["c", "charlie", "option c", "third"], "3": ["d", "delta", "option d", "fourth"], "4": ["e", "echo", "option e", "fifth"] };
const w = (): any => (typeof window !== "undefined" ? window : {});
export const voiceSupported = () => typeof speechSynthesis !== "undefined" && !!(w().SpeechRecognition || w().webkitSpeechRecognition);

/** What is said for a card side: tags and styles dropped, cloze gaps spoken as "blank". */
export function spokenText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<span class="cloze"[^>]*>\s*\[[^\]]*\]\s*<\/span>/gi, " blank ").replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, ". ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, " and ").replace(/&lt;/g, " less than ").replace(/&gt;/g, " greater than ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").replace(/(\.\s*){2,}/g, ". ").replace(/[\s.]+$/, "").trim();
}
/** The part of a back side after the line that separates it from the question (the whole back when there is none). */
export function backOnly(back: string): string { const m = /<hr[^>]*id=["']?answer["']?[^>]*>/i.exec(back); const part = m ? back.slice(m.index + m[0].length) : back; return spokenText(part) || spokenText(back); }

let current: SpeechSynthesisUtterance | null = null;
export function speak(text: string, lang = "en-US"): Promise<void> {
  return new Promise((resolve) => {
    if (!text || typeof speechSynthesis === "undefined") return resolve();
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = lang; u.rate = 1.02; current = u; u.onend = () => resolve(); u.onerror = () => resolve(); speechSynthesis.speak(u); } catch { resolve(); }
  });
}
export function stopSpeaking() { try { current = null; if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); } catch { /* fine */ } }

/** Which key's words appear in what was heard (whole words, longest phrase first), or null. */
export function matchWord(heard: string, vocab: Record<string, string[]>): string | null {
  const t = " " + heard.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() + " ";
  let best: { k: string; len: number } | null = null;
  for (const [k, words] of Object.entries(vocab)) for (const word of words) if (t.includes(" " + word + " ") && (!best || word.length > best.len)) best = { k, len: word.length };
  return best?.k ?? null;
}

let rec: any = null;
export function stopListening() { try { rec?.abort?.(); } catch { /* fine */ } rec = null; }
/** Listen for up to `ms` for one of the words; resolves with its key, or null when nothing matched in time. */
export function listen(vocab: Record<string, string[]>, ms = 9000, lang = "en-US"): Promise<string | null> {
  return new Promise((resolve) => {
    const R = w().SpeechRecognition || w().webkitSpeechRecognition; if (!R) return resolve(null);
    let done = false; const finish = (k: string | null) => { if (done) return; done = true; clearTimeout(timer); try { r.abort?.(); } catch { /* fine */ } if (rec === r) rec = null; resolve(k); };
    const r = new R(); rec = r; r.lang = lang; r.interimResults = true; r.continuous = true; r.maxAlternatives = 3;
    r.onresult = (e: any) => { for (let i = e.resultIndex; i < e.results.length; i++) for (let j = 0; j < e.results[i].length; j++) { const k = matchWord(e.results[i][j].transcript, vocab); if (k) return finish(k); } };
    r.onerror = () => finish(null); r.onend = () => { if (!done) { try { r.start(); } catch { finish(null); } } };
    const timer = setTimeout(() => finish(null), ms);
    try { r.start(); } catch { finish(null); }
  });
}
