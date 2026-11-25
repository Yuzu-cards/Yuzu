import { useMemo, useState } from "react";
import { store } from "../lib/store";
import { noteTitle, renderCard } from "../lib/render";
import { CardView } from "./Study";
import { systemColor } from "./theme";
import type { Note } from "../lib/model";
import { IconClose } from "./icons";
import { useBack } from "./useBack";

function NoteCard({ note, label, onKeep, full, onToggle }: { note: Note; label: string; onKeep: () => void; full: boolean; onToggle: () => void }) {
  const cards = useMemo(() => store.cardsOfNote(note.id).sort((x, y) => x.ord - y.ord), [note.id, store.getVersion()]);
  const reps = cards.reduce((a, c) => a + c.reps, 0);
  const nt = store.notetypeFor(note);
  const extra = note.fields.slice(1, 3).map((f) => f.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).join(" · ");
  return (
    <div className="card-box" style={{ padding: "10px 12px" }}>
      <div className="small muted">{label} · {cards[0]?.source.split("::").slice(-2).join(" › ")} · {nt?.name}</div>
      <div style={{ margin: "6px 0", fontSize: 15 }}>{noteTitle(note, nt)}</div>
      {!full && extra && <div className="small muted" style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{extra}</div>}
      {full && cards[0] && nt && (() => { const r = renderCard({ note, notetype: nt, ord: cards[0].ord, deck: cards[0].source, resolveMedia: store.mediaUrl }); return (
        <div className="paper slate" style={{ "--tilt": "0deg", "--spine": systemColor(note.tags.find((t) => t.startsWith("auto::System::"))?.slice(14)), margin: "8px 0" } as any}><CardView html={r.back} css={r.css} dark side="back" autoplay={false} deck={cards[0].source} /></div>); })()}
      {full && <div className="small muted">{note.tags.filter((t) => !t.startsWith("auto::") && !t.startsWith("needs-review::")).join(", ")}</div>}
      <div className="row small" style={{ marginTop: 8, flexWrap: "wrap", gap: 6 }}>
        <span className="chip">{cards.length} card{cards.length === 1 ? "" : "s"}</span><span className="chip">{reps} reviews</span>
        <button className="btn" style={{ minHeight: 34, padding: "4px 10px" }} onClick={onToggle}>{full ? "Hide card" : "Show full card"}</button>
        <button className="btn primary" style={{ marginLeft: "auto", minHeight: 34, padding: "4px 12px" }} onClick={onKeep}>Keep this one</button>
      </div>
    </div>
  );
}

export function Duplicates({ onClose }: { onClose: () => void }) {
  const v = store.getVersion();
  const pairs = useMemo(() => store.similarPairs(), [v]);
  const [i, setI] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const [full, setFull] = useState(false); // both cards open together, so they can be compared
  useBack(true, onClose);
  const pair = pairs[Math.min(i, pairs.length - 1)];
  const a = pair ? store.notes.get(pair[0]) : undefined, b = pair ? store.notes.get(pair[1]) : undefined;
  return (
    <div className="screen">
      <div className="row"><h1 className="grow" style={{ margin: 0 }}>Similar cards</h1><button className="icon-btn" aria-label="Close duplicates" onClick={onClose}><IconClose /></button></div>
      <p className="small muted">Pairs that look like the same fact. Keeping one merges the other into it: tags are combined and the stronger review history wins. Every merge can be undone below.</p>
      {pair && a && b ? (
        <>
          <div className="small muted" style={{ marginBottom: 6 }}>Pair {Math.min(i, pairs.length - 1) + 1} of {pairs.length} · {Math.round(pair[2] * 100)}% overlap</div>
          <NoteCard note={a} label="A" onKeep={() => store.mergeNotes(a.id, b.id)} full={full} onToggle={() => setFull(!full)} />
          <div style={{ height: 8 }} />
          <NoteCard note={b} label="B" onKeep={() => store.mergeNotes(b.id, a.id)} full={full} onToggle={() => setFull(!full)} />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn grow" onClick={() => store.keepBoth(a.id, b.id)}>Keep both</button>
            <button className="btn" onClick={() => setI((i + 1) % pairs.length)}>Skip</button>
          </div>
        </>
      ) : <div className="empty">No similar pairs waiting. New ones appear after imports and packs.</div>}
      {store.mergeLog.length > 0 && (
        <>
          <button className="btn ghost block" style={{ marginTop: 16 }} onClick={() => setShowLog(!showLog)}>{showLog ? "Hide" : "Show"} merged ({store.mergeLog.length})</button>
          {showLog && store.mergeLog.map((e) => (
            <div key={e.at} className="list-row">
              <span className="t">{noteTitle(e.dropped[0])} → {store.notes.get(e.keep) ? noteTitle(store.notes.get(e.keep)!) : "(deleted)"}</span>
              <button className="chip" onClick={() => store.undoMerge(e.at)}>Undo</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
