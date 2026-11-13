// "Why so many reviews?" — the likely causes, biggest first, each with its evidence and one fix. A fix changes nothing until tapped,
// and each applied fix keeps its own Undo in the sheet.
import { useMemo, useState } from "react";
import { store } from "../lib/store";
import { Sheet, snackbar } from "./kit";

export function DiagnoseSheet({ onClose }: { onClose: () => void }) {
  store.getVersion(); const [busy, setBusy] = useState<string | null>(null); const [done, setDone] = useState<string[]>([]);
  // Every fix applied while the sheet is open keeps its own Undo (a later fix never takes an earlier one's away).
  const [applied, setApplied] = useState<{ id: string; title: string; message: string; undo?: () => Promise<void> }[]>([]);
  async function apply(c: (typeof d.causes)[number]) {
    setBusy(c.id);
    try {
      // "Tune to my history" changes the scheduler's weights: keep the old ones so the tune can be undone too.
      const w0 = store.settings.scheduler.w, fit0 = store.settings.fit;
      const r = await store.applyFix(c);
      const undo = r.undo ?? (c.fix?.kind === "tune" && store.settings.scheduler.w !== w0 ? async () => { await store.saveSettings({ scheduler: { ...store.settings.scheduler, w: w0 }, fit: fit0 }); await store.rebuildMemory(); } : undefined);
      setDone((x) => [...x, c.id]); setApplied((x) => [...x, { id: c.id, title: c.fix?.label ?? c.title, message: r.message, undo }]); snackbar(r.message);
    } catch (e: any) { snackbar(e?.message ?? String(e)); } finally { setBusy(null); }
  }
  async function undoFix(id: string) {
    const a = applied.find((x) => x.id === id); if (!a?.undo) return; setBusy(id);
    try { await a.undo(); setApplied((x) => x.filter((y) => y.id !== id)); setDone((x) => x.filter((y) => y !== id)); snackbar("Undone: " + a.title); } catch (e: any) { snackbar(e?.message ?? String(e)); } finally { setBusy(null); }
  }
  const d = useMemo(() => store.diagnose(), [store.getVersion()]);
  const shown = d.causes.filter((c) => !done.includes(c.id));
  return (
    <Sheet title="Why so many reviews?" label="Why so many reviews" onClose={onClose} style={{ maxHeight: "92vh", overflow: "auto" }}>
      <p className="small muted" style={{ marginTop: 4 }}>About <b>{Math.round(d.perDay).toLocaleString()}</b> review{Math.round(d.perDay) === 1 ? "" : "s"} a day over the last 30 days; <b>{d.dueToday.toLocaleString()}</b> due today. What's driving it, biggest first, worked out from your own reviews. Nothing changes until you tap a fix, and every fix you apply here can be undone below it.</p>
      {applied.map((a) => (
        <div key={a.id} className="card-box diag applied" style={{ marginTop: 8 }}>
          <div className="row" style={{ alignItems: "baseline", gap: 8 }}><b className="grow">✓ {a.title}</b>{a.undo ? <button className="btn" disabled={!!busy} onClick={() => undoFix(a.id)}>{busy === a.id ? "Undoing…" : "Undo"}</button> : <span className="small muted">nothing to undo</span>}</div>
          <p className="small muted" style={{ margin: "6px 0 0" }}>{a.message}</p>
        </div>
      ))}
      {shown.length === 0 && !applied.length && <div className="card-box small">{d.causes.length ? "All the suggested fixes are in. Give it a few days to show." : "Nothing unusual: no backlog, a moderate new-card pace, few leeches and a sensible target. The load is what your collection needs."}</div>}
      {shown.map((c, i) => (
        <div key={c.id} className="card-box diag" style={{ marginTop: 8 }}>
          <div className="row" style={{ alignItems: "baseline" }}><b className="grow">{i + 1}. {c.title}</b>{c.perDay >= 1 && <span className="chip">≈{Math.round(c.perDay).toLocaleString()}/day</span>}</div>
          <p className="small muted" style={{ margin: "6px 0 8px" }}>{c.evidence}</p>
          {c.fix && <button className="btn" disabled={!!busy} onClick={() => apply(c)}>{busy === c.id ? "Working…" : c.fix.label}</button>}
        </div>
      ))}
    </Sheet>
  );
}
