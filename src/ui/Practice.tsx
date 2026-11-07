// Practice with Claude: a prompt built from the cards you're weakest on, to paste into Claude as an oral exam, a patient case or a teach-back.
import { useMemo, useState } from "react";
import { store } from "../lib/store";
import { buildRoleplayPrompt, STYLES, type RoleplayStyle } from "../lib/roleplay";
import { IconClose } from "./icons";
import { snackbar } from "./kit";

export function PracticeSheet({ onClose }: { onClose: () => void }) {
  const exams = (store.settings.deadlines ?? []).filter((d) => d.date >= store.isoToday());
  const [style, setStyle] = useState<RoleplayStyle>("oral"); const [scope, setScope] = useState(""); const [n, setN] = useState(10);
  const exam = exams.find((d) => d.id === scope);
  const prompt = useMemo(() => buildRoleplayPrompt({ style, facts: store.factsOf(store.weakestCards(n, exam)), goal: exam?.name }), [style, scope, n]);
  const empty = !/\n1\. /.test(prompt);
  return (
    <div className="sheet-backdrop" onClick={onClose}><div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh", overflow: "auto" }}>
      <div className="row"><b className="grow">Practice with Claude</b><button className="icon-btn" aria-label="Close practice" onClick={onClose}><IconClose /></button></div>
      <p className="small muted" style={{ marginTop: 4 }}>Yuzu writes the prompt from the cards you're shakiest on; you paste it into Claude and talk it through. Claude can send the cards for your mistakes back to your Inbox.</p>
      <div className="seg">{(Object.keys(STYLES) as RoleplayStyle[]).map((k) => <button key={k} className={style === k ? "on" : ""} onClick={() => setStyle(k)}>{STYLES[k].label}</button>)}</div>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <div className="field grow" style={{ margin: 0 }}><label>Cards from</label><select value={scope} onChange={(e) => setScope(e.target.value)}><option value="">Weakest right now</option>{exams.map((d) => <option key={d.id} value={d.id}>{d.name} (exam)</option>)}</select></div>
        <div className="field" style={{ margin: 0, width: 90 }}><label>How many</label><select value={n} onChange={(e) => setN(Number(e.target.value))}>{[5, 10, 15, 20].map((x) => <option key={x}>{x}</option>)}</select></div>
      </div>
      <textarea className="typeans" rows={9} readOnly aria-label="Prompt for Claude" style={{ marginTop: 10, fontSize: 13 }} value={empty ? "Study a few cards first: Yuzu needs some reviewed cards to know where you're weak." : prompt} />
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="btn primary grow" disabled={empty} onClick={async () => { try { await navigator.clipboard.writeText(prompt); snackbar("Copied — paste it into Claude"); } catch { snackbar("Select the text and copy it"); } }}>Copy prompt</button>
        <a className="btn" href="https://claude.ai/new" target="_blank" rel="noreferrer">Open Claude</a>
      </div>
    </div></div>
  );
}
