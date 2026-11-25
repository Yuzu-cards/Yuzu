// Inbox: packs (and curation files) that arrived in the sync repository's inbox/ folder.
// Nothing is added until the user reviews the cards and taps Add. A whole pack can be removed later.
import { confirmSheet } from "./kit";
import { useState } from "react";
import { fmtDate } from "../lib/dates";
import { store } from "../lib/store";
import { IconClose } from "./icons";
import { useBack } from "./useBack";
import { parsePack, describeInvalid, countOf } from "../import/pack";
import { str, strTags } from "../lib/coerce";
import { mapClozes } from "../lib/cloze";

const clean = (s: unknown) => mapClozes(str(s), (a) => `[${a}]`).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

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
  const cards: any[] = Array.isArray(p.cards) ? p.cards : [];
  const keep = cards.length - dropped.size;
  // Broken cards are named before Add (they used to be called duplicates afterwards).
  const broken = (() => { try { return parsePack(p, []).invalid; } catch { return []; } })(); const brokenAt = new Set(broken.map((b) => b.index));
  return (
    <>
      <div className="card-box">
        <b>{p.name ?? e.file}</b>
        <div className="small muted">{countOf(cards.length, "card")} → {str(p.category) || "Medicine::Inbox"}{strTags(p.tags).length ? ` · ${strTags(p.tags).filter((t) => !t.startsWith("auto::")).join(", ")}` : ""}</div>
        {broken.length > 0 && <p className="small" style={{ marginBottom: 0 }}><b>{countOf(broken.length, "card")} will be left out as broken:</b> {describeInvalid(broken)}.</p>}
        <p className="small muted" style={{ marginBottom: 0 }}>Tap a card to drop it. Nothing is added until you tap Add.</p>
      </div>
      {cards.map((c, i) => (
        <button key={i} className="list-row" style={{ width: "100%", textAlign: "left", opacity: dropped.has(i) ? 0.4 : 1, flexDirection: "column", alignItems: "stretch", gap: 2 }} onClick={() => { const d = new Set(dropped); d.has(i) ? d.delete(i) : d.add(i); setDropped(d); }}>
          <span style={{ whiteSpace: "normal" }}>{dropped.has(i) ? "✗ " : ""}{brokenAt.has(i) ? "⚠ broken · " : ""}{clean(c?.text ?? c?.front ?? c?.question ?? (Array.isArray(c?.masks) ? `${str(c.front) || "Image"} (image occlusion, ${countOf(c.masks.length, "box", "boxes")})` : ""))}</span>
          {(c?.back || c?.extra || Array.isArray(c?.options) || Array.isArray(c?.masks)) && <span className="small muted" style={{ whiteSpace: "normal" }}>{clean(c.back ?? c.extra ?? (Array.isArray(c.options) ? c.options.map((o: any, i: number) => (typeof o === "string" ? (i === c.answer || String.fromCharCode(65 + i) === c.answer ? "✓ " : "") + o : (o.correct ? "✓ " : "") + o.text)).join(" · ") : (Array.isArray(c.masks) ? c.masks : []).map((m: any) => str(m?.label)).filter(Boolean).join(" · "))).slice(0, 160)}</span>}
        </button>
      ))}
      <div className="row" style={{ marginTop: 12, position: "sticky", bottom: "calc(76px + var(--safe-b))", background: "var(--ink)", padding: "8px 0" }}>
        <button className="btn primary grow" disabled={busy || keep === 0} onClick={async () => { setBusy(true); setMsg(await store.acceptInbox(sha, cards.map((_, i) => i).filter((i) => !dropped.has(i)))); setBusy(false); onDone(); }}>Add {countOf(keep, "card")}</button>
        <button className="btn" disabled={busy} onClick={async () => { await store.dismissInbox(sha); onDone(); }}>Discard pack</button>
      </div>
      {msg && <p className="small">{msg}</p>}
    </>
  );
}

/** Inbox files that aren't a pack Yuzu can read (cut short, not JSON): said plainly, with the text to look at and a Remove. */
function BadFiles() {
  const [show, setShow] = useState<string | null>(null); const n = store.inboxBad.length;
  return <div className="card-box wp04-bad" style={{ margin: "10px 0" }}>
    <b>{n} file{n === 1 ? "" : "s"} in your inbox couldn't be read</b>
    <div className="small muted">Usually a pack Claude cut short. Ask Claude to send it again, then remove this one.</div>
    {store.inboxBad.map((f) => <div key={f.sha}>
      <div className="list-row"><span className="t">{f.file}<span className="small muted"> · {f.why}{f.size ? ` · ${f.size.toLocaleString()} bytes` : ""}</span></span>
        <button className="chip" aria-expanded={show === f.sha} onClick={() => setShow(show === f.sha ? null : f.sha)}>{show === f.sha ? "Hide text" : "Show text"}</button>
        <button className="chip" onClick={async () => { if (await confirmSheet({ title: `Remove “${f.file}”?`, sub: "It is deleted from the inbox folder on every device. Nothing in your collection changes.", yes: "Remove file" })) await store.removeBadInbox(f.sha); }}>Remove</button></div>
      {show === f.sha && <pre className="wp04-bad-text small">{f.text || "(empty)"}</pre>}
    </div>)}
  </div>;
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
          <span className="small muted">{e.pack.yuzu_curation ? "curation" : countOf(Array.isArray(e.pack.cards) ? e.pack.cards.length : 0, "card")}</span>
        </button>
      ))}
      {store.inboxBad.length > 0 && <BadFiles />}
      {store.packLog.length > 0 && (
        <>
          <h2>Added packs</h2>
          {store.packLog.map((p) => (
            <div key={p.id + p.at} className="list-row"><span className="t">{p.name} · {countOf(p.noteIds.length, "note")} · {fmtDate(p.at)}</span><button className="chip" onClick={async () => { if (await confirmSheet({ title: `Remove “${p.name}”?`, sub: `All ${countOf(p.noteIds.length, "note")}, their cards and review history go with it.`, yes: "Remove pack" })) setMsg(`Removed ${await store.removePack(p.id)} cards.`); }}>Remove</button></div>
          ))}
        </>
      )}
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}
