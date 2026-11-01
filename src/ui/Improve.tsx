// "Needs improving": mark cards for Claude to rewrite or split, from Study or Library. The marks sync and are sent
// to Claude from Settings → Cards to improve; importing Claude's file clears them.
import { useState } from "react";
import { store, Store } from "../lib/store";
import { useBack } from "./useBack";

export function ImproveSheet({ nids, onClose }: { nids: string[]; onClose: () => void }) {
  useBack(true, onClose);
  const cur = nids.length === 1 ? store.improveFor(nids[0]) : null;
  const [r, setR] = useState<string[]>(cur?.r ?? []);
  const [t, setT] = useState(cur?.t ?? "");
  const toggle = (k: string) => setR((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  return (
    <div className="sheet-backdrop" onClick={onClose}><div className="sheet" onClick={(e) => e.stopPropagation()}>
      <b>{nids.length === 1 ? "What's wrong with this card?" : `What's wrong with these ${nids.length} cards?`}</b>
      <p className="small muted" style={{ margin: "4px 0 10px" }}>Marked cards collect in Settings → Cards to improve. Send them to Claude from there; the improved versions come back as one file, keeping your review history and pictures.</p>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {Object.entries(Store.IMPROVE_REASONS).map(([k, label]) => <button key={k} className={"chip" + (r.includes(k) ? " orange" : "")} onClick={() => toggle(k)}>{label}</button>)}
      </div>
      <textarea rows={3} placeholder="Your note for Claude (optional) — e.g. “split the 3 causes”, “the ECG picture belongs to the answer”" value={t} onChange={(e) => setT(e.target.value)} style={{ marginTop: 10 }} />
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="btn primary grow" disabled={!r.length && !t.trim()} onClick={async () => { await store.markImprove(nids, r.length ? r : ["other"], t); onClose(); }}>{cur ? "Update mark" : "Mark for improving"}</button>
        {cur && <button className="btn" onClick={async () => { await store.markImprove(nids, [], ""); onClose(); }}>Remove mark</button>}
      </div>
    </div></div>
  );
}

/** Settings: the list of cards marked for improving, and sending them to Claude. */
export function ImproveSection() {
  store.getVersion();
  const list = store.improveList();
  const [msg, setMsg] = useState("");
  const [showAll, setShowAll] = useState(false);
  const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  async function send() { const m = await sendImproveToClaude(); if (m) setMsg(m); }
  return (
    <div className="card-box">
      <p className="small muted" style={{ marginTop: 0 }}>Cards you marked “Needs improving” (⋯ menu while studying, or select cards in Library) and leeches you mix up with something similar. Claude rewrites them, splits overfilled ones with each picture on the right card, and sends one file back — your review history stays, and the marks clear themselves.</p>
      {list.length ? (<>
        <div className="row" style={{ gap: 8 }}><span className="small grow"><b>{list.length}</b> card{list.length === 1 ? "" : "s"} marked</span><button className="btn primary" onClick={send}>Send to Claude</button></div>
        <ul className="small" style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
          {(showAll ? list : list.slice(0, 8)).map(({ note, mark }) => (
            <li key={note.id} className="row" style={{ alignItems: "flex-start", gap: 8, padding: "6px 0", borderTop: "1px dashed var(--line)" }}>
              <span className="grow" style={{ minWidth: 0 }}><span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text(note.fields[0] ?? "").slice(0, 90) || "(no text)"}</span>
                <span className="muted">{mark.r.map((k) => Store_REASON_SHORT[k] ?? k).join(" · ")}{mark.t ? ` — “${mark.t}”` : ""}</span></span>
              <button className="chip" onClick={() => (mark.r[0] === "confusion" && !store.improveFor(note.id) ? store.clearImprove([note.id]) : store.markImprove([note.id], [], ""))}>Unmark</button>
            </li>))}
        </ul>
        {list.length > 8 && <button className="btn ghost block" style={{ marginTop: 6 }} onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${list.length}`}</button>}
      </>) : <p className="small muted" style={{ margin: 0 }}>Nothing marked yet.</p>}
      {msg && <p className="small" style={{ marginBottom: 0 }}>{msg}</p>}
    </div>
  );
}
const Store_REASON_SHORT: Record<string, string> = { split: "split", unclear: "unclear", wrong: "wrong/outdated", format: "formatting", media: "picture/sound", confusion: "mixed up", other: "other" };

/** Package the marked cards for Claude: the share sheet on a phone (straight into the Claude app), a file on a PC. */
export async function sendImproveToClaude(): Promise<string | null> {
  const data = store.improveExport(); const d = new Date();
  const name = `yuzu-improve-${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}.json`;
  const file = new File([JSON.stringify(data, null, 1)], name, { type: "application/json" });
  try { if ((navigator as any).canShare?.({ files: [file] }) && window.matchMedia?.("(pointer: coarse)").matches) { await navigator.share({ files: [file], title: "Cards to improve", text: `Please improve these ${data.count} Yuzu cards and send back a curation file.` }); return `Shared ${data.count} cards. When Claude sends the file back, import it in Import from Anki → Choose file.`; } } catch (e: any) { if (e?.name === "AbortError") return null; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return `Saved ${name}. Attach it in a chat with Claude; import the file Claude sends back in Import from Anki → Choose file.`;
}
