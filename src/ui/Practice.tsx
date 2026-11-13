// Practice with Claude: a prompt built from the cards you're weakest on, to paste into Claude as an oral exam, a patient case or a teach-back.
import { useMemo, useState } from "react";
import { store } from "../lib/store";
import { buildRoleplayPrompt, isLanguageStyle, STYLES, type RoleplayStyle } from "../lib/roleplay";
import type { Card } from "../lib/model";
import { IconClose } from "./icons";
import { Sheet, snackbar } from "./kit";

export function PracticeSheet({ onClose }: { onClose: () => void }) {
  const exams = (store.settings.deadlines ?? []).filter((d) => d.date >= store.isoToday());
  const [style, setStyle] = useState<RoleplayStyle>("oral"); const [scope, setScope] = useState(""); const [n, setN] = useState(10);
  const areas = useMemo(() => store.tree().children.map((c) => c.name), []);
  const exam = exams.find((d) => d.id === scope);
  // "Cards from": an exam, one top-level area, or the weakest anywhere; with "anywhere" the style decides the subject
  // (German talk → German words only; viva, case, teach-back → no German words).
  const keepFor = (sc: string, st: RoleplayStyle) => { const a = sc.startsWith("area:") ? sc.slice(5) : null; return a ? (c: Card) => (c.source || "").split("::")[0] === a : (c: Card) => store.isLanguageCard(c) === isLanguageStyle(st); };
  const prompt = useMemo(() => buildRoleplayPrompt({ style, facts: store.factsOf(store.weakestCards(n, exam, Date.now(), keepFor(scope, style))), goal: exam?.name }), [style, scope, n]);
  /** Choosing where the cards come from picks the matching style: German talk for German cards, the viva for medicine. */
  function pickScope(sc: string) {
    setScope(sc); if (!sc) return; const ex = exams.find((d) => d.id === sc); const sample = store.weakestCards(10, ex, Date.now(), sc.startsWith("area:") ? keepFor(sc, style) : undefined);
    if (!sample.length) return; const lang = sample.filter((c) => store.isLanguageCard(c)).length > sample.length / 2;
    if (lang !== isLanguageStyle(style)) setStyle(lang ? "german" : "oral");
  }
  const empty = !/\n1\. /.test(prompt);
  return (
    <Sheet title="Practice with Claude" closeLabel="Close practice" onClose={onClose} style={{ maxHeight: "92vh", overflow: "auto" }}>
      <p className="small muted" style={{ marginTop: 4 }}>Yuzu writes the prompt from the cards you're shakiest on; you paste it into Claude and talk it through. Claude can send the cards for your mistakes back to your Inbox.</p>
      <div className="seg">{(Object.keys(STYLES) as RoleplayStyle[]).map((k) => <button key={k} className={style === k ? "on" : ""} aria-pressed={style === k} onClick={() => setStyle(k)}>{STYLES[k].label}</button>)}</div>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <div className="field grow" style={{ margin: 0 }}><label>Cards from</label><select value={scope} onChange={(e) => pickScope(e.target.value)}><option value="">Weakest right now, any area</option>{areas.map((a) => <option key={a} value={"area:" + a}>{a}</option>)}{exams.map((d) => <option key={d.id} value={d.id}>{d.name} (exam)</option>)}</select></div>
        <div className="field" style={{ margin: 0, width: 90 }}><label>How many</label><select value={n} onChange={(e) => setN(Number(e.target.value))}>{[5, 10, 15, 20].map((x) => <option key={x}>{x}</option>)}</select></div>
      </div>
      <textarea className="typeans" rows={9} readOnly aria-label="Prompt for Claude" style={{ marginTop: 10, fontSize: 13 }} value={empty ? (store.reviews.length ? `No reviewed ${isLanguageStyle(style) ? "German words" : "cards"} here yet. Pick another area or style, or study a few first.` : "Study a few cards first: Yuzu needs some reviewed cards to know where you're weak.") : prompt} />
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="btn primary grow" disabled={empty} onClick={async () => { try { await navigator.clipboard.writeText(prompt); snackbar("Copied — paste it into Claude"); } catch { snackbar("Select the text and copy it"); } }}>Copy prompt</button>
        <a className="btn" href="https://claude.ai/new" target="_blank" rel="noreferrer">Open Claude</a>
      </div>
    </Sheet>
  );
}
