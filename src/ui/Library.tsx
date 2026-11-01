import { useMemo, useState } from "react";
import { store, VIEWS, type TreeNode, type View, type SmartDeck } from "../lib/store";
import { noteTitle, renderCard } from "../lib/render";
import { CardView, CardInfo, type StudyScope } from "./Study";
import { SYSTEM_NAMES } from "../lib/classify";
import type { Card, CardState } from "../lib/model";
import { IconChevron, IconPlay, IconClose, IconPin, IconEdit } from "./icons";
import { useEffect, useRef } from "react";
import { Duplicates } from "./Duplicates";
import { bossPool, BOSS_PASS } from "./Boss";
import { useBack } from "./useBack";
import { ImproveSheet } from "./Improve";
import { ActionSheet, HoldRow, snackbar, DragHandle, useDragReorder, type SheetItem } from "./kit";
import { systemColor } from "./theme";

let overMemo: { ids: string[]; set: Set<string> } | null = null;
const overSet = () => { const ids = store.overfilled(); if (overMemo?.ids !== ids) overMemo = { ids, set: new Set(ids) }; return overMemo.set; };
const FILTER_HINT: Record<string, string> = {
  flagged: "Flagged|Cards you flagged while studying or here.", improve: "To improve|Cards marked “Needs improving” — send them to Claude from Settings → Cards to improve.",
  overfilled: "Overfilled|Answers with too much on one card (long text or 6+ list items). One fact per card sticks better (Wozniak's minimum-information rule). Select them → Needs improving → Claude splits them.",
  leech: "Leeches|Cards you keep forgetting after learning them.", suspended: "Paused|Kept with their history but never shown until unpaused.",
};
/** Quick filters in the card list. */
function passes(c: Card, only: "flagged" | "improve" | "suspended" | "leech" | "overfilled"): boolean {
  if (only === "flagged") return !!c.flag;
  if (only === "suspended") return c.suspended;
  if (only === "improve") return !!store.improveFor(c.nid);
  if (only === "overfilled") return overSet().has(c.nid);
  return !!store.noteFor(c)?.tags.includes("leech");
}

function findNode(root: TreeNode, path: string): TreeNode | null {
  if (!path) return root;
  const parts = path.split("::");
  let n: TreeNode | null = root;
  for (const p of parts) { n = n?.children.find((c) => c.name === p) ?? null; if (!n) return null; }
  return n;
}

function Preview({ card: card0, onClose, onStudy }: { card: Card; onClose: () => void; onStudy: (cards: Card[], title: string) => void }) {
  const [sub, setSub] = useState<null | "edit" | "improve">(null);
  useBack(true, onClose); // the editor and the improve sheet stack their own back step on top of this one
  store.getVersion(); const card = store.cards.get(card0.id) ?? card0; // live: edits, flags and pauses show at once
  const note = store.noteFor(card); const nt = note && store.notetypeFor(note);
  if (!note || !nt) return null; // deleted meanwhile
  const r = renderCard({ note, notetype: nt, ord: card.ord, deck: card.source, resolveMedia: store.mediaUrl });
  const mark = store.improveFor(note.id);
  if (sub === "edit") return <CardInfo card={card} onClose={() => setSub(null)} onSaved={() => setSub(null)} />;
  if (sub === "improve") return <ImproveSheet nids={[note.id]} onClose={() => setSub(null)} />;
  return (
    <div className="sheet-backdrop" onClick={onClose}><div className="sheet" onClick={(e) => e.stopPropagation()}>
      <div className="row" style={{ marginBottom: 8 }}><b className="grow">Preview</b>{card.flag ? <span className="chip orange">flagged</span> : null}{mark ? <span className="chip orange">to improve</span> : null}<span className="chip">{card.suspended ? "paused" : card.state}</span><button className="icon-btn" aria-label="Close preview" onClick={onClose}><IconClose /></button></div>
      <div className="paper slate" style={{ "--tilt": "0deg", "--spine": systemColor(note.tags.find((t) => t.startsWith("auto::System::"))?.slice(14)) } as any}><CardView html={r.back} css={r.css} dark side="back" /></div>
      <p className="small muted">{card.source}{note.tags.length ? " · " + note.tags.filter((t) => !t.startsWith("auto::")).join(", ") : ""}{mark ? ` · to improve: ${mark.r.join(", ")}${mark.t ? ` — “${mark.t}”` : ""}` : ""}</p>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        <button className="btn primary grow" onClick={() => onStudy([card], "This card")}><IconPlay /> Study</button>
        <button className="btn grow" onClick={() => setSub("edit")}><IconEdit /> Edit</button>
        <button className="btn grow" onClick={() => setSub("improve")}>{mark ? "Change improve mark" : "Needs improving"}</button>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
        <button className="btn grow" onClick={() => store.setFlag(card.id, card.flag ? 0 : 1)}>{card.flag ? "Unflag" : "Flag"}</button>
        <button className="btn grow" onClick={() => store.setSuspended(card.id, !card.suspended)}>{card.suspended ? "Unpause" : "Pause"}</button>
        <button className="btn danger grow" onClick={async () => { const n = store.cardsOfNote(note.id).length; if (!confirm(n > 1 ? `Delete this note and its ${n} cards? Review history goes too.` : "Delete this card? Review history goes too.")) return; await store.deleteNotes([note.id]); onClose(); }}>Delete</button>
      </div>
    </div></div>
  );
}

function SmartEditor({ initial, onClose }: { initial?: SmartDeck; onClose: () => void }) {
  const [sd, setSd] = useState<SmartDeck>(initial ?? { id: String(Date.now()), name: "", systems: [], specialties: [], decks: [], tags: [], states: [] });
  const specialties = useMemo(() => store.tree("specialties").children.map((c) => c.name).filter((n) => n !== "Other"), []);
  const decks = useMemo(() => store.tree("decks").children.map((c) => c.name), []);
  const toggle = (key: "systems" | "specialties" | "decks" | "states", v: string) => setSd({ ...sd, [key]: (sd[key] as string[]).includes(v) ? (sd[key] as string[]).filter((x) => x !== v) : [...(sd[key] as string[]), v] });
  const Group = ({ title, items, k }: { title: string; items: string[]; k: "systems" | "specialties" | "decks" | "states" }) => (
    <><h2 style={{ marginTop: 10 }}>{title}</h2><div className="row" style={{ flexWrap: "wrap", gap: 6 }}>{items.map((x) => <button key={x} className={"chip" + ((sd[k] as string[]).includes(x) ? " orange" : "")} onClick={() => toggle(k, x)}>{x}</button>)}</div></>
  );
  const n = store.cardsMatching(sd).length;
  return (
    <div className="sheet-backdrop" onClick={onClose}><div className="sheet" onClick={(e) => e.stopPropagation()}>
      <div className="row"><b className="grow">{initial ? "Edit smart deck" : "New smart deck"}</b><button className="icon-btn" aria-label="Close editor" onClick={onClose}><IconClose /></button></div>
      <p className="small muted" style={{ marginTop: 4 }}>Pick anything from each group; a card matches if it fits every group you picked. {n.toLocaleString()} cards match now.</p>
      <div className="field"><label>Name</label><input value={sd.name} onChange={(e) => setSd({ ...sd, name: e.target.value })} placeholder="Step 1 · Cardio" /></div>
      <Group title="Systems" items={SYSTEM_NAMES} k="systems" />
      <Group title="Specialties" items={specialties} k="specialties" />
      <Group title="Decks" items={decks} k="decks" />
      <Group title="State" items={["new", "learning", "review", "relearning"]} k="states" />
      <div className="row" style={{ marginTop: 14 }}>
        {initial && <button className="btn danger" onClick={async () => { await store.saveSettings({ smart: store.settings.smart.filter((x) => x.id !== sd.id) }); onClose(); }}>Delete</button>}
        <button className="btn primary grow" disabled={!sd.name.trim()} onClick={async () => { const list = store.settings.smart; const at = list.findIndex((x) => x.id === sd.id); await store.saveSettings({ smart: at >= 0 ? list.map((x) => (x.id === sd.id ? sd : x)) : [...list, sd] }); onClose(); /* editing keeps its place */ }}>Save</button>
      </div>
    </div></div>
  );
}

export function Library({ onStudy, onBoss, initial }: { onStudy: (path: string, view: View, extra?: Partial<StudyScope>) => void; onBoss: (path: string, view: View, name: string) => void; initial?: { view: View; path: string; query?: string; only?: "flagged" | "improve" | "suspended" | "leech" | "overfilled"; n: number } | null }) {
  const [view, setView] = useState<View>(initial?.view ?? "decks");
  const [path, setPath] = useState(initial?.path ?? "");
  useEffect(() => { if (initial) { setView(initial.view); setPath(initial.path); setQuery(initial.query ?? ""); setShowCards(!!initial.query); if (initial.only) setOnly(initial.only); } }, [initial?.n]);
  const [showCards, setShowCards] = useState(false);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState(""); // debounced
  const [only, setOnly] = useState<null | "flagged" | "improve" | "suspended" | "leech" | "overfilled">(null); // quick filters
  useEffect(() => { const t = setTimeout(() => setQ(query.trim().toLowerCase()), 160); return () => clearTimeout(t); }, [query]);
  const [sort, setSort] = useState<"due" | "new" | "state" | "deck">("due");
  const [allTags, setAllTags] = useState(false);
  const [preview, setPreview] = useState<Card | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editSmart, setEditSmart] = useState<SmartDeck | null | "new">(null);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [tagTo, setTagTo] = useState<string | null>(null);
  const [tool, setTool] = useState<"dupes" | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [classify, setClassify] = useState<"System" | "Specialty" | null>(null);
  const v = store.getVersion();
  const similarCount = useMemo(() => store.similarPairs().length, [v]);
  const tree = store.tree(view === "smart" ? "decks" : view);
  const node = view === "smart" ? null : (findNode(tree, path) ?? tree);
  const crumbs = path ? path.split("::") : [];
  const smart = view === "smart" && path ? store.settings.smart.find((s) => s.id === path) : null;
  const pinned = store.settings.pins.some((p) => p.view === view && p.path === path);

  const scopeCards = useMemo(() => (view === "smart" ? (smart ? store.cardsMatching(smart) : []) : store.cardsIn(path, view)), [path, view, v]);
  const counts = useMemo(() => {
    const now = Date.now(); let due = 0, learning = 0, fresh = 0, susp = 0, studied = 0;
    for (const c of scopeCards) { if (c.suspended) { susp++; continue; } if (c.state === "new") fresh++; else if (c.due <= now) due++; if (c.state === "learning" || c.state === "relearning") learning++; if (c.reps) studied++; }
    return { due, learning, fresh, susp, studied, total: scopeCards.length };
  }, [scopeCards]);

  const matches = useMemo(() => {
    if (!showCards && !q && !only) return [] as Card[];
    const seen = new Set<string>(); const out: Card[] = [];
    for (const c of scopeCards) {
      if (only && !passes(c, only)) continue; // checked per card, before siblings are folded together (a flag sits on one card)
      if (seen.has(c.nid)) continue;
      if (q) { const n = store.noteFor(c); if (!n || !store.searchText(n).includes(q)) continue; }
      seen.add(c.nid); out.push(c);
    }
    const order = { learning: 0, relearning: 0, review: 1, new: 2 } as Record<string, number>;
    if (sort === "due") out.sort((a, b) => (a.state === "new" ? 1 : 0) - (b.state === "new" ? 1 : 0) || a.due - b.due);
    else if (sort === "new") out.sort((a, b) => b.created - a.created);
    else if (sort === "state") out.sort((a, b) => (a.suspended ? 3 : order[a.state]) - (b.suspended ? 3 : order[b.state]));
    else out.sort((a, b) => a.source.localeCompare(b.source));
    return out;
  }, [scopeCards, showCards, q, sort, only, store.getVersion()]);
  const filterCounts = useMemo(() => { const k = { flagged: 0, improve: 0, suspended: 0, leech: 0, overfilled: 0 }; const over = overSet(); const overN = new Set<string>(); const notes = { improve: new Set<string>(), leech: new Set<string>() }; for (const c of scopeCards) { if (c.flag) k.flagged++; if (c.suspended) k.suspended++; if (store.improveFor(c.nid)) notes.improve.add(c.nid); if (store.noteFor(c)?.tags.includes("leech")) notes.leech.add(c.nid); if (over.has(c.nid)) overN.add(c.nid); } k.overfilled = overN.size; k.improve = notes.improve.size; k.leech = notes.leech.size; return k; }, [scopeCards, store.getVersion()]);
  const list = useMemo(() => matches.slice(0, 300).map((c) => { const n = store.noteFor(c)!; return { card: c, title: noteTitle(n, store.notetypeFor(n)), state: c.suspended ? "suspended" : c.state }; }), [matches]);

  // Hooks first, always in the same order (the empty-library screen below returns early).
  const go = (p: string) => { setPath(p); setShowCards(false); setSelecting(false); setSelected(new Set()); };
  useBack(!!path, () => go(path.split("::").slice(0, -1).join("::")));
  const [deleted, setDeleted] = useState<{ n: number; token: unknown } | null>(null);
  const [improveFor, setImproveFor] = useState<string[] | null>(null);
  const [sheet, setSheet] = useState<{ title: string; sub?: string; items: SheetItem[] } | null>(null);
  const [editCard, setEditCard] = useState<Card | null>(null);
  const smartList = useRef<HTMLDivElement>(null);
  const smartDrag = useDragReorder({ listRef: smartList, onMove: (a, b) => { const l = [...store.settings.smart]; const [x] = l.splice(a, 1); l.splice(b, 0, x); store.saveSettings({ smart: l }); } });
  const isPinned = (p: string, v: View) => store.settings.pins.some((x) => x.path === p && x.view === v);
  const nodeSheet = (c: { name: string; path: string; due: number; learning: number; newCount: number; total?: number }) => setSheet({ title: c.name, sub: `${c.due.toLocaleString()} due · ${c.learning} learning · ${c.newCount.toLocaleString()} new`, items: [
    { label: "Open", onClick: () => go(c.path) },
    { label: "Study", onClick: () => onStudy(c.path, view), disabled: c.due + c.learning + c.newCount === 0 },
    { label: "Due only", onClick: () => onStudy(c.path, view, { only: "due" }), disabled: !c.due && !c.learning },
    { label: "New only", onClick: () => onStudy(c.path, view, { only: "new" }), disabled: !c.newCount },
    ...(view === "systems" ? [{ label: "Boss fight", onClick: () => onBoss(c.path, view, c.name) }] : []),
    isPinned(c.path, view) ? { label: "Unpin from Today", onClick: () => store.saveSettings({ pins: store.settings.pins.filter((x) => !(x.path === c.path && x.view === view)) }) } : { label: "Pin to Today", onClick: () => store.saveSettings({ pins: [...store.settings.pins, { path: c.path, view }] }) },
    { label: "Show its cards", onClick: () => { go(c.path); setShowCards(true); } },
    { label: "Select all its cards", onClick: () => { go(c.path); setShowCards(true); setSelecting(true); setTimeout(() => setSelected(new Set(store.cardsIn(c.path, view).map((x) => x.id))), 0); } },
  ] });
  const cardSheet = (card: Card, title: string) => { const n = store.noteFor(card); setSheet({ title, sub: card.source.split("::").slice(-2).join(" › "), items: [
    { label: "Preview", onClick: () => setPreview(card) },
    { label: "Study it", onClick: () => onStudy(path, view, { preset: [card], title: "This card" }) },
    { label: "Edit", onClick: () => setEditCard(card) },
    { label: n && store.improveFor(n.id) ? "Change improve mark" : "Needs improving…", onClick: () => n && setImproveFor([n.id]) },
    { label: card.flag ? "Unflag" : "Flag", onClick: () => store.setFlag(card.id, card.flag ? 0 : 1) },
    { label: card.suspended ? "Unpause" : "Pause", onClick: async () => { await store.setSuspended(card.id, !card.suspended); snackbar(card.suspended ? "Unpaused" : "Paused", () => store.setSuspended(card.id, card.suspended)); } },
    { label: "Select", onClick: () => { setSelecting(true); setSelected(new Set([card.id])); } },
    { label: "Delete", danger: true, onClick: async () => { if (!n) return; await store.deleteNotes([n.id]); snackbar("Deleted", () => { store.undoDelete(); }); } },
  ] }); };

  if (store.cards.size === 0) {
    return (<div className="screen"><h1>Library</h1><div className="empty">No cards yet. Import your Anki collection from Settings.</div></div>);
  }
  const doBulk = async (action: Parameters<typeof store.bulk>[1]) => { await store.bulk([...selected], action); setSelected(new Set()); setSelecting(false); };
  const title = view === "smart" ? (smart?.name ?? "Smart decks") : node!.name;
  if (tool === "dupes") return <Duplicates onClose={() => setTool(null)} />;

  return (
    <div className="screen">
      <div className="row"><h1 className="grow" style={{ margin: 0 }}>Library</h1>{similarCount > 0 && <button className="chip orange" onClick={() => setTool("dupes")}>{similarCount} similar pairs</button>}</div>
      <div className="seg">
        {[...VIEWS, { id: "smart" as View, label: "Smart" }].map((x) => <button key={x.id} className={view === x.id ? "on" : ""} onClick={() => { setView(x.id); go(""); }}>{x.label}</button>)}
      </div>
      {view !== "smart" && (
        <div className="crumbs">
          <button onClick={() => go("")}>All</button>
          {crumbs.map((c, i) => (<span key={i} className="row" style={{ gap: 4 }}><span className="muted">›</span><button onClick={() => go(crumbs.slice(0, i + 1).join("::"))}>{c}</button></span>))}
        </div>
      )}
      {view === "smart" && !smart ? (
        <>
          <p className="small muted">Smart decks combine systems, specialties, decks and states into one study scope, e.g. "Step 1 · Cardio".</p>
          <div ref={smartList}>{store.settings.smart.map((sd, i) => (
            <div key={sd.id} data-drag-item className="row" style={{ gap: 0, alignItems: "stretch" }}>
            <button className="tree-row grow" style={{ width: "100%", textAlign: "left" }} onClick={() => go(sd.id)}><span className="name">{sd.name}</span><span className="small muted">{store.cardsMatching(sd).length.toLocaleString()} cards</span><span className="muted"><IconChevron /></span></button>
            {store.settings.smart.length > 1 && <DragHandle {...smartDrag.handle(i, sd.name, store.settings.smart.length)} />}
            </div>
          ))}</div>
          <button className="btn block" style={{ marginTop: 12 }} onClick={() => setEditSmart("new")}>New smart deck</button>
        </>
      ) : (
        <>
          <div className="card-box">
            <div className="row">
              <div className="grow">
                <div style={{ fontWeight: 700, fontSize: 18 }}>{title}</div>
                <div className="small muted">{counts.total.toLocaleString()} cards · {counts.susp.toLocaleString()} suspended · {counts.studied.toLocaleString()} studied</div>
              </div>
              {view === "decks" && path && <button className="icon-btn" aria-label="Rename or move" title="Rename or move this category" onClick={() => setRename(path)}><IconEdit /></button>}
              <button className={"icon-btn" + (pinned ? " on" : "")} aria-label="Pin" onClick={() => store.saveSettings({ pins: pinned ? store.settings.pins.filter((p) => !(p.view === view && p.path === path)) : [...store.settings.pins, { view, path }] })}><IconPin /></button>
              <button className="btn primary" onClick={() => onStudy(path, view)} disabled={counts.due + counts.fresh + counts.learning === 0}><IconPlay /> Study</button>
            </div>
            <div className="row small" style={{ marginTop: 10, gap: 14 }}>
              <button className="chip" disabled={!counts.due && !counts.learning} onClick={() => onStudy(path, view, { only: "due" })} title="Study only what is due"><b className="c-due">{counts.due.toLocaleString()}</b> due{counts.learning ? ` · ${counts.learning} learning` : ""}</button>
              <button className="chip" disabled={!counts.fresh} onClick={() => onStudy(path, view, { only: "new" })} title="Learn new cards only"><b>{counts.fresh.toLocaleString()}</b> new</button>
              {smart && <button className="chip" style={{ marginLeft: "auto" }} onClick={() => setEditSmart(smart)}>Edit</button>}
            </div>
            {view !== "smart" && path && (() => { const pool = bossPool(path, view).length; const b = store.settings.bosses[`${view}:${path}`]; return pool >= 10 ? (
              <div className="row small" style={{ marginTop: 10 }}>
                <button className="chip yuzu" onClick={() => onBoss(path, view, title)}>Boss fight</button>
                <span className="muted">{b ? `best ${Math.round(b.best * 100)}%${b.passed ? " · defeated" : ""}` : `${pool} well-learned cards, 20 random, no hints, ${Math.round(BOSS_PASS * 100)}% to pass`}</span>
              </div>) : null; })()}
          </div>
          <div className="field"><input placeholder="Search cards and tags here" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "-4px 0 10px" }}>
            {([["flagged", "Flagged"], ["improve", "To improve"], ["overfilled", "Overfilled"], ["leech", "Leeches"], ["suspended", "Paused"]] as const).map(([k, label]) => (
              <button key={k} data-hint={FILTER_HINT[k]} className={"chip" + (only === k ? " orange" : "")} disabled={!filterCounts[k] && only !== k} onClick={() => setOnly(only === k ? null : k)}>{label} · {filterCounts[k].toLocaleString()}</button>))}
          </div>
          {!query && !only && node && node.children.length > 0 && (
            <>
              <h2>{view === "tags" ? "Tags" : "Categories"}</h2>
              {view === "tags" && !path && <label className="row small muted" style={{ marginBottom: 6 }}><input type="checkbox" checked={allTags} onChange={(e) => setAllTags(e.target.checked)} /> Show deck housekeeping tags (#, !)</label>}
              {[...node.children].filter((c) => view !== "tags" || allTags || !/^[#!~]/.test(c.name)).sort((a, b) => (["Other", "Unclassified", "No exam", "Untagged"].includes(a.name) ? 1 : 0) - (["Other", "Unclassified", "No exam", "Untagged"].includes(b.name) ? 1 : 0)).map((c) => (
                <HoldRow key={c.path} className="tree-row" style={{ width: "100%", textAlign: "left" }} onTap={() => go(c.path)} onHold={() => nodeSheet(c)}>
                  <span className="name">{view === "systems" && !path && <i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: systemColor(c.name), marginRight: 8, verticalAlign: "1px" }} />}{c.name}</span>
                  <span className="counts">{c.due ? <span><b className="c-due">{c.due.toLocaleString()}</b> due</span> : null}{c.learning ? <span><b className="c-learn">{c.learning}</b> learning</span> : null}{c.newCount ? <span><b>{c.newCount.toLocaleString()}</b> new</span> : null}</span>
                  <span className="muted"><IconChevron /></span>
                </HoldRow>
              ))}
            </>
          )}
          {!query && node && node.children.length === 0 && view !== "decks" && path && (() => {
            const by = new Map<string, { due: number; fresh: number; total: number }>(); const now = Date.now();
            for (const c of scopeCards) { if (c.suspended) continue; const k = c.source.split("::").slice(0, 3).join(" › "); const e = by.get(k) ?? by.set(k, { due: 0, fresh: 0, total: 0 }).get(k)!; e.total++; if (c.state === "new") e.fresh++; else if (c.due <= now) e.due++; }
            const rows = [...by].sort((a, b) => b[1].total - a[1].total).slice(0, 12);
            return rows.length > 1 ? (<><h2>Where these cards live</h2>{rows.map(([k, e]) => <div key={k} className="tree-row"><span className="name" style={{ fontWeight: 500 }}>{k}</span><span className="counts">{e.due ? <span><b className="c-due">{e.due.toLocaleString()}</b> due</span> : null}<span><b>{e.total.toLocaleString()}</b> cards</span></span></div>)}</>) : null;
          })()}
          {!query && !only && !showCards && <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => setShowCards(true)}>Show cards in {title}</button>}
          {(showCards || query || only) && (
            <>
              <div className="row" style={{ marginTop: 18 }}>
                <h2 className="grow" style={{ margin: 0 }}>{matches.length.toLocaleString()} cards{matches.length > 300 ? ", first 300 shown" : ""}</h2>
                {matches.length > 0 && !selecting && <button className="chip orange" onClick={() => { const pool = only ? scopeCards.filter((c) => passes(c, only) && (!q || store.searchText(store.noteFor(c)!).includes(q))) : matches; onStudy(path, view, { preset: pool.filter((c) => only === "suspended" || !c.suspended).slice(0, 500), title: only ? { flagged: "Flagged cards", improve: "Cards to improve", leech: "Leeches", suspended: "Paused cards", overfilled: "Overfilled cards" }[only] : `“${query}”` }); }}><IconPlay /> Study these</button>}
                <select className="chip" value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Sort"><option value="due">by due</option><option value="new">newest</option><option value="state">by state</option><option value="deck">by deck</option></select>
                <button className="chip" onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>{selecting ? "Cancel" : "Select"}</button>
                {selecting && <button className="chip" onClick={() => setSelected(new Set(matches.map((c) => c.id)))}>All {matches.length.toLocaleString()}</button>}
              </div>
              {list.map((r) => (
                <HoldRow key={r.card.id} className="list-row" style={{ width: "100%", textAlign: "left" }} onHold={() => cardSheet(r.card, r.title)} onTap={() => { if (selecting) { const s = new Set(selected); s.has(r.card.id) ? s.delete(r.card.id) : s.add(r.card.id); setSelected(s); } else setPreview(r.card); }}>
                  {selecting && <input type="checkbox" readOnly checked={selected.has(r.card.id)} />}
                  <span className="t">{r.title}<div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.card.source.split("::").slice(-2).join(" › ")}</div></span><span className={"chip " + (r.state === "new" ? "" : "orange")}>{r.state}</span>
                </HoldRow>
              ))}
            </>
          )}
        </>
      )}
      {selecting && selected.size > 0 && (
        <div className="bulk-bar">
          <span className="small">{selected.size} selected</span>
          <button className="btn" onClick={() => doBulk({ suspended: true })}>Suspend</button>
          <button className="btn" onClick={() => doBulk({ suspended: false })}>Unsuspend</button>
          <button className="btn" onClick={() => doBulk({ flag: 1 })}>Flag</button>
          <button className="btn" onClick={() => doBulk({ flag: 0 })}>Unflag</button>
          <button className="btn" onClick={() => setTagTo("")}>Tag</button>
          <button className="btn" onClick={() => setMoveTo("")}>Move</button>
          <button className="btn" onClick={() => setClassify("System")}>System</button>
          <button className="btn" onClick={() => setClassify("Specialty")}>Specialty</button>
          <button className="btn primary" onClick={() => { const cards = [...selected].map((id) => store.cards.get(id)!).filter(Boolean); setSelecting(false); setSelected(new Set()); onStudy(path, view, { preset: cards, title: `${cards.length} selected` }); }}>Study</button>
          <button className="btn" onClick={() => setImproveFor([...new Set([...selected].map((id) => store.cards.get(id)?.nid).filter(Boolean) as string[])])}>Needs improving</button>
          <button className="btn danger" onClick={async () => { const nids = [...new Set([...selected].map((id) => store.cards.get(id)?.nid).filter(Boolean) as string[])]; if (!confirm(`Delete ${nids.length.toLocaleString()} note${nids.length === 1 ? "" : "s"} and all their cards? Review history goes too.`)) return; const n = await store.deleteNotes(nids); setSelected(new Set()); setSelecting(false); setDeleted({ n, token: store.lastDeleted }); }}>Delete</button>
        </div>
      )}
      {deleted && deleted.n > 0 && store.lastDeleted === deleted.token && (
        <div className="bulk-bar"><span className="small grow">Deleted {deleted.n.toLocaleString()} note{deleted.n === 1 ? "" : "s"}</span><button className="btn" onClick={async () => { await store.undoDelete(); setDeleted(null); }}>Undo</button><button className="btn" onClick={() => setDeleted(null)}>OK</button></div>
      )}
      {tagTo !== null && (
        <div className="sheet-backdrop" onClick={() => setTagTo(null)}><div className="sheet" onClick={(e) => e.stopPropagation()}>
          <b>Tag {selected.size} cards</b>
          <div className="field"><label>Tag (use :: for levels)</label><input value={tagTo} onChange={(e) => setTagTo(e.target.value)} placeholder="step1::high-yield" autoCapitalize="none" /></div>
          <button className="btn primary block" disabled={!tagTo.trim()} onClick={async () => { await doBulk({ addTag: tagTo.trim().replace(/\s+/g, "_") }); setTagTo(null); }}>Add tag</button>
        </div></div>
      )}
      {moveTo !== null && (
        <div className="sheet-backdrop" onClick={() => setMoveTo(null)}><div className="sheet" onClick={(e) => e.stopPropagation()}>
          <b>Move {selected.size} cards to</b>
          <div className="field"><label>Category path (use :: for levels)</label><input value={moveTo} list="deckpaths" onChange={(e) => setMoveTo(e.target.value)} placeholder="Medicine::Cardiology::ECG" /></div>
          <datalist id="deckpaths">{[...new Set([...store.cards.values()].map((c) => c.source))].sort().map((p) => <option key={p} value={p} />)}</datalist>
          <button className="btn primary block" disabled={!moveTo.trim()} onClick={async () => { await doBulk({ source: moveTo.trim() }); setMoveTo(null); }}>Move</button>
        </div></div>
      )}
      {rename !== null && (
        <div className="sheet-backdrop" onClick={() => setRename(null)}><div className="sheet" onClick={(e) => e.stopPropagation()}>
          <b>Rename or move “{path.split("::").pop()}”</b>
          <p className="small muted" style={{ marginTop: 4 }}>Edit the full path. Change the last part to rename; change the part before it to move the category (and everything inside it) somewhere else.</p>
          <div className="field"><label>Full path</label><input value={rename} list="deckpaths" onChange={(e) => setRename(e.target.value)} /></div>
          <datalist id="deckpaths">{[...new Set([...store.cards.values()].map((c) => c.source))].sort().map((p) => <option key={p} value={p} />)}</datalist>
          <button className="btn primary block" disabled={!rename.trim() || rename.trim() === path} onClick={async () => { const to = rename.trim(); await store.renamePath(path, to); setRename(null); go(to.replace(/\s*::\s*/g, "::")); }}>Apply</button>
        </div></div>
      )}
      {classify && (
        <div className="sheet-backdrop" onClick={() => setClassify(null)}><div className="sheet" onClick={(e) => e.stopPropagation()}>
          <b>{classify} for {selected.size} cards</b>
          <p className="small muted" style={{ marginTop: 4 }}>Tap to add; tap again (when all selected cards have it) to remove. A card can belong to several.</p>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {(classify === "System" ? SYSTEM_NAMES : store.tree("specialties").children.map((c) => c.name).filter((n) => n !== "Other")).map((name) => {
              const tag = `auto::${classify}::${name}`; const ids = [...selected]; const all = ids.every((id) => store.noteFor(store.cards.get(id)!)?.tags.includes(tag));
              return <button key={name} className={"chip" + (all ? " orange" : "")} onClick={() => store.classify(ids, classify, name, !all)}>{name}</button>;
            })}
          </div>
          {classify === "Specialty" && <div className="field" style={{ marginTop: 10 }}><label>New specialty</label><div className="row"><input className="grow" id="newspec" placeholder="e.g. Toxicology" /><button className="btn" onClick={() => { const v = (document.getElementById("newspec") as HTMLInputElement).value.trim(); if (v) store.classify([...selected], "Specialty", v, true); }}>Add</button></div></div>}
          <button className="btn block" style={{ marginTop: 10 }} onClick={() => setClassify(null)}>Done</button>
        </div></div>
      )}
      {preview && <Preview card={preview} onClose={() => setPreview(null)} onStudy={(cards, t) => { setPreview(null); onStudy(path, view, { preset: cards, title: t }); }} />}
      {sheet && <ActionSheet title={sheet.title} sub={sheet.sub} items={sheet.items} onClose={() => setSheet(null)} />}
      {editCard && <CardInfo card={editCard} onClose={() => setEditCard(null)} onSaved={() => setEditCard(null)} />}
      {improveFor && <ImproveSheet nids={improveFor} onClose={() => { setImproveFor(null); setSelected(new Set()); setSelecting(false); }} />}
      {editSmart && <SmartEditor initial={editSmart === "new" ? undefined : editSmart} onClose={() => { setEditSmart(null); if (view === "smart" && path && !store.settings.smart.some((s) => s.id === path)) go(""); }} />}
    </div>
  );
}
