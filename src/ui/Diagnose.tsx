// "Why so many reviews?" — the likely causes, biggest first, each with its evidence and one fix. A fix changes nothing until tapped,
// and the snackbar offers Undo.
import { useMemo, useState } from "react";
import { store } from "../lib/store";
import { IconClose } from "./icons";
import { snackbar } from "./kit";

export function DiagnoseSheet({ onClose }: { onClose: () => void }) {
  store.getVersion(); const [busy, setBusy] = useState<string | null>(null); const [done, setDone] = useState<string[]>([]);
  const d = useMemo(() => store.diagnose(), [store.getVersion()]);
  const shown = d.causes.filter((c) => !done.includes(c.id));
  return (
    <div className="sheet-backdrop" onClick={onClose}><div className="sheet" role="dialog" aria-label="Why so many reviews" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh", overflow: "auto" }}>
      <div className="row"><b className="grow">Why so many reviews?</b><button className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button></div>
      <p className="small muted" style={{ marginTop: 4 }}>About <b>{Math.round(d.perDay).toLocaleString()}</b> review{Math.round(d.perDay) === 1 ? "" : "s"} a day over the last 30 days; <b>{d.dueToday.toLocaleString()}</b> due today. What's driving it, biggest first, worked out from your own reviews. Nothing changes until you tap a fix, and each one can be undone.</p>
      {shown.length === 0 && <div className="card-box small">{d.causes.length ? "All the suggested fixes are in. Give it a few days to show." : "Nothing unusual: no backlog, a moderate new-card pace, few leeches and a sensible target. The load is what your collection needs."}</div>}
      {shown.map((c, i) => (
        <div key={c.id} className="card-box diag" style={{ marginTop: 8 }}>
          <div className="row" style={{ alignItems: "baseline" }}><b className="grow">{i + 1}. {c.title}</b>{c.perDay >= 1 && <span className="chip">≈{Math.round(c.perDay).toLocaleString()}/day</span>}</div>
          <p className="small muted" style={{ margin: "6px 0 8px" }}>{c.evidence}</p>
          {c.fix && <button className="btn" disabled={!!busy} onClick={async () => { setBusy(c.id); try { const r = await store.applyFix(c); setDone((x) => [...x, c.id]); snackbar(r.message, r.undo ? async () => { await r.undo!(); setDone((x) => x.filter((y) => y !== c.id)); } : undefined); } catch (e: any) { snackbar(e?.message ?? String(e)); } finally { setBusy(null); } }}>{busy === c.id ? "Working…" : c.fix.label}</button>}
        </div>
      ))}
    </div></div>
  );
}
