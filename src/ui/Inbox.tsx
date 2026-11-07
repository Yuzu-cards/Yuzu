// Inbox: packs (and curation files) that arrived in the sync repository's inbox/ folder.
// Nothing is added until the user reviews the cards and taps Add. A whole pack can be removed later.
import { confirmSheet } from "./kit";
import { useState } from "react";
import { fmtDate } from "../lib/dates";
import { store } from "../lib/store";
import { IconClose } from "./icons";
import { useBack } from "./useBack";

const clean = (s: string) => (s ?? "").replace(/\{\{c\d+::(.*?)(?:::[^}]*)?\}\}/g, "[$1]").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function Review({ sha, onDone }: { sha: string; onDone: () => void }) {
  const e = store.inbox.find((x) => x.sha === sha);
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  if (!e) return null;
  const p = e.pack;
  if (p.yuzu_curation === 1) {
    return (
      <div className="card-box">
        <b>{p.name ?? e.file}</b>
        <p className="small muted">A curation file: {p.merges?.length ?? 0} merges, {Object.keys(p.decks ?? {}).length} category rules, {Object.values(p.tags ?? {}).reduce((a: number, v: any) => a + v.length, 0).toLocaleString()} tag additions.</p>
        <div className="row"><button className="btn primary grow" disabled={busy} onClick={async () => { setBusy(true); setMsg(await store.acceptInbox(sha, "all")); setBusy(false); onDone(); }}>Apply</button><button className="btn" disabled={busy} onClick={async () => { await store.dismissInbox(sha); onDone(); }}>Discard</button></div>
        {msg && <p className="small">{msg}</p>}
      </div>
    );
  }
  const cards: any[] = p.cards ?? [];
  const keep = cards.length - dropped.size;
  return (
    <>
      <div className="card-box">
        <b>{p.name ?? e.file}</b>
        <div className="small muted">{cards.length} cards → {p.category ?? "Medicine::Inbox"}{p.tags?.length ? ` · ${p.tags.filter((t: string) => !t.startsWith("auto::")).join(", ")}` : ""}</div>
        <p className="small muted" style={{ marginBottom: 0 }}>Tap a card to drop it. Nothing is added until you tap Add.</p>
      </div>
      {cards.map((c, i) => (
        <button key={i} className="list-row" style={{ width: "100%", textAlign: "left", opacity: dropped.has(i) ? 0.4 : 1, flexDirection: "column", alignItems: "stretch", gap: 2 }} onClick={() => { const d = new Set(dropped); d.has(i) ? d.delete(i) : d.add(i); setDropped(d); }}>
          <span style={{ whiteSpace: "normal" }}>{dropped.has(i) ? "✗ " : ""}{clean(c.text ?? c.front ?? c.question ?? (c.masks ? `${c.front ?? "Image"} (image occlusion, ${c.masks.length} boxes)` : ""))}</span>
          {(c.back || c.extra || c.options || c.masks) && <span className="small muted" style={{ whiteSpace: "normal" }}>{clean(c.back ?? c.extra ?? (c.options ? c.options.map((o: any, i: number) => (typeof o === "string" ? (i === c.answer || String.fromCharCode(65 + i) === c.answer ? "✓ " : "") + o : (o.correct ? "✓ " : "") + o.text)).join(" · ") : (c.masks ?? []).map((m: any) => m.label).filter(Boolean).join(" · "))).slice(0, 160)}</span>}
        </button>
      ))}
      <div className="row" style={{ marginTop: 12, position: "sticky", bottom: "calc(76px + var(--safe-b))", background: "var(--ink)", padding: "8px 0" }}>
        <button className="btn primary grow" disabled={busy || keep === 0} onClick={async () => { setBusy(true); setMsg(await store.acceptInbox(sha, cards.map((_, i) => i).filter((i) => !dropped.has(i)))); setBusy(false); onDone(); }}>Add {keep} card{keep === 1 ? "" : "s"}</button>
        <button className="btn" disabled={busy} onClick={async () => { await store.dismissInbox(sha); onDone(); }}>Discard pack</button>
      </div>
      {msg && <p className="small">{msg}</p>}
    </>
  );
}

export function Inbox({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  store.getVersion();
  useBack(true, () => (open ? setOpen(null) : onClose()));
  if (open) return <div className="screen"><div className="row"><h1 className="grow" style={{ margin: 0 }}>Review pack</h1><button className="icon-btn" aria-label="Back" onClick={() => setOpen(null)}><IconClose /></button></div><Review sha={open} onDone={() => setOpen(null)} /></div>;
  return (
    <div className="screen">
      <div className="row"><h1 className="grow" style={{ margin: 0 }}>Inbox</h1><button className="icon-btn" aria-label="Close inbox" onClick={onClose}><IconClose /></button></div>
      <p className="small muted">Packs that Claude (or you) put in the <b>inbox</b> folder of your sync repository. Review each one before it joins your collection.</p>
      {store.inbox.length === 0 && <div className="empty">Nothing waiting. Ask Claude for a pack, or sync to check again.</div>}
      {store.inbox.map((e) => (
        <button key={e.sha} className="tree-row" style={{ width: "100%", textAlign: "left" }} onClick={() => setOpen(e.sha)}>
          <span className="name">{e.pack.name ?? e.file}</span>
          <span className="small muted">{e.pack.yuzu_curation ? "curation" : `${e.pack.cards?.length ?? 0} cards`}</span>
        </button>
      ))}
      {store.packLog.length > 0 && (
        <>
          <h2>Added packs</h2>
          {store.packLog.map((p) => (
            <div key={p.id + p.at} className="list-row"><span className="t">{p.name} · {p.noteIds.length} cards · {fmtDate(p.at)}</span><button className="chip" onClick={async () => { if (await confirmSheet({ title: `Remove “${p.name}”?`, sub: `All ${p.noteIds.length} cards and their review history go with it.`, yes: "Remove pack" })) setMsg(`Removed ${await store.removePack(p.id)} cards.`); }}>Remove</button></div>
          ))}
        </>
      )}
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}
