// Move a deck (and everything inside it) into another deck, picked from the deck list (1.9.0, "I couldn't move the
// Mephisto deck into Languages › German"). The same move as typing a new path, without typing one.
import { useMemo, useState } from "react";
import { store, type TreeNode } from "../lib/store";
import { Sheet } from "./kit";

export function MoveDeck({ from, onClose, onMove }: { from: string; onClose: () => void; onMove: (to: string) => void }) {
  const [q, setQ] = useState("");
  const name = from.split("::").pop() ?? from; const parent = from.split("::").slice(0, -1).join("::");
  const rows = useMemo(() => {
    const out: { path: string; name: string; depth: number; total: number }[] = [];
    const walk = (n: TreeNode, depth: number) => { for (const c of n.children) { if (c.path === from || c.path.startsWith(from + "::")) continue; out.push({ path: c.path, name: c.name, depth, total: c.total }); walk(c, depth + 1); } };
    walk(store.tree("decks"), 0); return out;
  }, [from]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.path.toLowerCase().includes(needle)) : rows;
  const dest = (p: string) => (p ? `${p}::${name}` : name);
  return (
    <Sheet title={`Move “${name}” into…`} onClose={onClose} className="move-deck">
      <p className="small muted" style={{ marginTop: 2 }}>Its cards, the decks inside it, its options and its pins go with it. You can undo right after.</p>
      <div className="field"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a deck" aria-label="Find a deck" autoCapitalize="none" /></div>
      <div className="move-list" role="listbox" aria-label="Where to move it">
        {!needle && parent && <button role="option" aria-selected={false} className="move-row top" onClick={() => onMove(dest(""))}><b>Top level</b><span className="small muted">{name} on its own</span></button>}
        {shown.map((r) => { const here = r.path === parent; return (
          <button key={r.path} role="option" aria-selected={false} className={"move-row" + (here ? " here" : "")} disabled={here} style={{ paddingLeft: 12 + (needle ? 0 : r.depth * 16) }} onClick={() => onMove(dest(r.path))} title={here ? "It's already here" : `Move into ${r.path.replace(/::/g, " › ")}`}>
            <span className="grow">{needle ? r.path.replace(/::/g, " › ") : r.name}</span><span className="small muted">{here ? "here now" : r.total.toLocaleString()}</span>
          </button>); })}
        {!shown.length && <p className="small muted">No deck by that name.</p>}
      </div>
    </Sheet>
  );
}
