import { latinDigits } from "../lib/num";
import { useMemo, useState } from "react";
import { store, VIEWS, type TreeNode, type View, type SmartDeck } from "../lib/store";
import { noteTitle, renderCard } from "../lib/render";
import { CardView, CardInfo, type StudyScope } from "./Study";
import { SYSTEM_NAMES } from "../lib/classify";
import type { Card, CardState } from "../lib/model";
import { IconChevron, IconPlay, IconClose, IconPin, IconEdit } from "./icons";
import { useEffect, useRef, type ReactNode } from "react";
import { Duplicates } from "./Duplicates";
import { OcclusionEditor } from "./Occlusion";
import { CardEditor, NoteEditor } from "./CardEditor";
import { bossPool, BOSS_PASS } from "./Boss";
import { useBack } from "./useBack";
import { ImproveSheet } from "./Improve";
import { ActionSheet, HoldRow, snackbar, DragHandle, useDragReorder, confirmSheet, Sheet, useMedia, type SheetItem } from "./kit";
import { systemColor } from "./theme";
import { isHousekeepingTag } from "../lib/search";

let overMemo: { ids: string[]; set: Set<string> } | null = null;
const overSet = () => { const ids = store.overfilled(); if (overMemo?.ids !== ids) overMemo = { ids, set: new Set(ids) }; return overMemo.set; };
const FILTER_HINT: Record<string, string> = {
  flagged: "Flagged|Cards you flagged while studying or here.", improve: "To improve|Cards marked “Needs improving” — send them to Claude from Settings → Cards to improve.",
  overfilled: "Overfilled|Answers with too much on one card (long text or 6+ list items). One fact per card sticks better (Wozniak's minimum-information rule). Select them → Needs improving → Claude splits them.",
  leech: "Leeches|Cards you keep forgetting after learning them.", suspended: "Paused|Kept with their history but never shown until unpaused.",
};
/** Quick filters in the card list. `over` is the overfilled set, read once per pass over the cards (not once per card). */
function passes(c: Card, only: "flagged" | "improve" | "suspended" | "leech" | "overfilled", over?: Set<string>): boolean {
  if (only === "flagged") return !!c.flag;
  if (only === "suspended") return c.suspended;
  if (only === "improve") return !!store.improveFor(c.nid);
  if (only === "overfilled") return (over ?? overSet()).has(c.nid);
  return !!store.noteFor(c)?.tags.includes("leech");
}

// Scope cards and their counts, kept across views and visits for the same store version: switching Decks → Systems at the
// root, or coming back to All, reuses them instead of walking 146k cards again (09-3).
const scopeMemo = new Map<string, Card[]>();
const scopeFor = (key: string, make: () => Card[]) => { let c = scopeMemo.get(key); if (!c) { c = make(); scopeMemo.set(key, c); if (scopeMemo.size > 4) scopeMemo.delete(scopeMemo.keys().next().value!); } return c; };
const derived = new WeakMap<Card[], Record<string, unknown>>();
function memoOn<T>(cards: Card[], k: string, make: () => T): T { let d = derived.get(cards); if (!d) derived.set(cards, (d = {})); if (!(k in d)) d[k] = make(); return d[k] as T; }

function findNode(root: TreeNode, path: string): TreeNode | null {
  if (!path) return root;
  const parts = path.split("::");
  let n: TreeNode | null = root;
  for (const p of parts) { n = n?.children.find((c) => c.name === p) ?? null; if (!n) return null; }
  return n;
}

function Preview({ card: card0, onClose, onStudy, onTag, docked }: { card: Card; onClose: () => void; onStudy: (cards: Card[], title: string) => void; onTag: (tag: string) => void; docked?: boolean }) {
  const [sub, setSub] = useState<null | "edit" | "improve">(null);
  useBack(true, onClose); // the editor and the improve sheet stack their own back step on top of this one
  store.getVersion(); const card = store.cards.get(card0.id) ?? card0; // live: edits, flags and pauses show at once
  const note = store.noteFor(card); const nt = note && store.notetypeFor(note);
  if (!note || !nt) return null; // deleted meanwhile
  const r = renderCard({ note, notetype: nt, ord: card.ord, deck: card.source, resolveMedia: store.mediaUrl });
  const mark = store.improveFor(note.id);
  if (sub === "edit") return <NoteEditor card={card} onClose={() => setSub(null)} onTag={onTag} />;
  if (sub === "improve") return <ImproveSheet nids={[note.id]} onClose={() => setSub(null)} />;
  const head = <>{card.flag ? <span className="chip orange">flagged</span> : null}{mark ? <span className="chip orange">to improve</span> : null}<span className="chip">{card.suspended ? "paused" : card.state}</span></>;
  const wrap = (children: ReactNode) => docked // a wide screen: beside the list instead of over it
    ? <aside className="lib-dock" aria-label="Preview"><div className="row" style={{ marginBottom: 8 }}><b className="grow">Preview</b>{head}<button className="icon-btn" aria-label="Close preview" onClick={onClose}><IconClose /></button></div>{children}</aside>
    : <Sheet title="Preview" closeLabel="Close preview" onClose={onClose} head={head}>{children}</Sheet>;
  return wrap(<>
      <div className="paper slate" style={{ "--tilt": "0deg", "--spine": systemColor(note.tags.find((t) => t.startsWith("auto::System::"))?.slice(14)) } as any}><CardView html={r.back} css={r.css} dark side="back" /></div>
      <p className="small muted">{card.source}{mark ? ` · to improve: ${mark.r.join(", ")}${mark.t ? ` — “${mark.t}”` : ""}` : ""}</p>
      {note.tags.some((t) => !t.startsWith("manual::")) && <div className="row small" style={{ flexWrap: "wrap", gap: 6, margin: "-4px 0 10px" }}>{note.tags.filter((t) => !t.startsWith("manual::")).map((t) => <button key={t} className={"chip" + (t.startsWith("auto::") ? " orange" : "")} title="Show the cards with this tag" onClick={() => onTag(t)}>{t.replace(/^auto::(System|Specialty|Exam|Level)::/, "$1: ")}</button>)}</div>}
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        <button className="btn primary grow" onClick={() => onStudy([card], "This card")}><IconPlay /> Study</button>
        <button className="btn grow" onClick={() => setSub("edit")}><IconEdit /> Edit</button>
        <button className="btn grow" onClick={() => setSub("improve")}>{mark ? "Change improve mark" : "Needs improving"}</button>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
        <button className="btn grow" onClick={() => store.setFlag(card.id, card.flag ? 0 : 1)}>{card.flag ? "Unflag" : "Flag"}</button>
        <button className="btn grow" onClick={() => store.setSuspended(card.id, !card.suspended)}>{card.suspended ? "Unpause" : "Pause"}</button>
        <button className="btn danger grow" onClick={async () => { const n = store.cardsOfNote(note.id).length; if (!(await confirmSheet({ title: n > 1 ? `Delete this note and its ${n} cards?` : "Delete this card?", sub: "Review history goes too. You can undo right after.", yes: "Delete" }))) return; await store.deleteNotes([note.id]); onClose(); snackbar("Deleted", () => { store.undoDelete(); }); }}>Delete</button>
      </div>
  </>);
}

function SmartEditor({ initial, onClose }: { initial?: SmartDeck; onClose: () => void }) {
  const [sd, setSd] = useState<SmartDeck>(initial ?? { id: String(Date.now()), name: "", systems: [], specialties: [], decks: [], tags: [], states: [] });
  const specialties = useMemo(() => store.tree("specialties").children.map((c) => c.name).filter((n) => n !== "Other"), []);
  const decks = useMemo(() => store.tree("decks").children.map((c) => c.name), []);
  // tags: the top level of the Tags tree (housekeeping #, !, ~ tags left out); deeper ones through the search box
  const tagTree = useMemo(() => store.tree("tags"), []);
  const topTags = useMemo(() => tagTree.children.map((c) => c.path).filter((t) => !/^[#!~]/.test(t) && t !== "Untagged"), [tagTree]);
  const allTags = useMemo(() => { const out: string[] = []; const walk = (n: TreeNode, d: number) => { for (const c of n.children) { if (/^[#!~]/.test(c.name) || c.name === "Untagged") continue; out.push(c.path); if (d < 3) walk(c, d + 1); } }; walk(tagTree, 0); return out.slice(0, 3000); }, [tagTree]);
  const [tagQ, setTagQ] = useState("");
  const toggle = (key: "systems" | "specialties" | "decks" | "states" | "tags", v: string) => setSd({ ...sd, [key]: (sd[key] as string[]).includes(v) ? (sd[key] as string[]).filter((x) => x !== v) : [...(sd[key] as string[]), v] });
  const Group = ({ title, items, k }: { title: string; items: string[]; k: "systems" | "specialties" | "decks" | "states" | "tags" }) => (
    <><h2 style={{ marginTop: 10 }}>{title}</h2><div className="row" style={{ flexWrap: "wrap", gap: 6 }}>{items.map((x) => <button key={x} className={"chip" + ((sd[k] as string[]).includes(x) ? " orange" : "")} onClick={() => toggle(k, x)}>{x}</button>)}</div></>
  );
  // counted over the whole collection, so only when what it matches changes (not on every letter of the name)
  const n = useMemo(() => store.cardsMatching(sd).length, [sd.systems, sd.specialties, sd.decks, sd.tags, sd.states]);
  return (
    <Sheet title={initial ? "Edit smart deck" : "New smart deck"} closeLabel="Close editor" onClose={onClose}>
      <p className="small muted" style={{ marginTop: 4 }}>Pick anything from each group; a card matches if it fits every group you picked. {n.toLocaleString()} cards match now.</p>
      <div className="field"><label>Name</label><input value={sd.name} onChange={(e) => setSd({ ...sd, name: e.target.value })} placeholder="Step 1 · Cardio" /></div>
      <Group title="Systems" items={SYSTEM_NAMES} k="systems" />
      <Group title="Specialties" items={specialties} k="specialties" />
      <Group title="Decks" items={decks} k="decks" />
      <Group title="Tags" items={[...new Set([...topTags, ...sd.tags])]} k="tags" />
      <div className="field" style={{ marginTop: 6 }}><div className="row" style={{ gap: 6 }}><input className="grow" style={{ minWidth: 0 }} list="smart-tags" aria-label="Add a deeper tag" placeholder="Add a tag, e.g. step1::high-yield" autoCapitalize="none" value={tagQ} onChange={(e) => setTagQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tagQ.trim()) { e.preventDefault(); if (!sd.tags.includes(tagQ.trim())) toggle("tags", tagQ.trim()); setTagQ(""); } }} />
        <button className="btn" disabled={!tagQ.trim()} onClick={() => { if (!sd.tags.includes(tagQ.trim())) toggle("tags", tagQ.trim()); setTagQ(""); }}>Add</button></div>
        <datalist id="smart-tags">{allTags.map((t) => <option key={t} value={t} />)}</datalist></div>
      <Group title="State" items={["new", "learning", "review", "relearning"]} k="states" />
      <div className="row" style={{ marginTop: 14 }}>
        {initial && <button className="btn danger" onClick={async () => { if (!(await confirmSheet({ title: `Delete the smart deck “${initial.name}”?`, sub: "Only the smart deck goes; its cards stay where they are.", yes: "Delete" }))) return; const at = store.settings.smart.findIndex((x) => x.id === sd.id); await store.saveSettings({ smart: store.settings.smart.filter((x) => x.id !== sd.id) }); onClose();
          snackbar(`Deleted “${initial.name}”`, async () => { const l = store.settings.smart; if (!l.some((x) => x.id === initial.id)) await store.saveSettings({ smart: [...l.slice(0, at), initial, ...l.slice(at)] }); }); }}>Delete</button>}
        <button className="btn primary grow" disabled={!sd.name.trim()} onClick={async () => { const list = store.settings.smart; const at = list.findIndex((x) => x.id === sd.id); await store.saveSettings({ smart: at >= 0 ? list.map((x) => (x.id === sd.id ? sd : x)) : [...list, sd] }); onClose(); /* editing keeps its place */ }}>Save</button>
      </div>
    </Sheet>
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
  useEffect(() => { const t = setTimeout(() => setQ(latinDigits(query).trim().toLowerCase()), 160); return () => clearTimeout(t); }, [query]);
  // Search runs in slices off the keystroke (store.searchNotes); the list shows the last finished result meanwhile.
  const [hits, setHits] = useState<{ q: string; sv: number; scores: Map<string, number> } | null>(null);
  const sv = store.structureVersion;
  useEffect(() => { if (!q) { setHits(null); return; } const cancel = { cancelled: false }; store.searchNotes(q, cancel).then((scores) => { if (scores && !cancel.cancelled) setHits({ q, sv, scores }); }).catch(() => {}); return () => { cancel.cancelled = true; }; }, [q, sv]);
  useEffect(() => { store.warmLibrary(); }, []);
  const searching = !!q && hits?.q !== q;
  const [sort, setSort] = useState<"best" | "due" | "new" | "state" | "deck">("best");
  const [allTags, setAllTags] = useState(false);
  const [preview, setPreview] = useState<Card | null>(null); const wide = useMedia("(min-width: 1500px)");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editSmart, setEditSmart] = useState<SmartDeck | null | "new">(null);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [tagTo, setTagTo] = useState<string | null>(null);
  const [tool, setTool] = useState<"dupes" | "occlusion" | "card" | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [classify, setClassify] = useState<"System" | "Specialty" | null>(null);
  const v = store.getVersion();
  const similarCount = useMemo(() => store.similarPairs().length, [store.getDataVersion()]);
  const tree = store.tree(view === "smart" ? "decks" : view);
  const node = view === "smart" ? null : (findNode(tree, path) ?? tree);
  const crumbs = path ? path.split("::") : [];
  const smart = view === "smart" && path ? store.settings.smart.find((s) => s.id === path) : null;
  const pinned = store.settings.pins.some((p) => p.view === view && p.path === path);

  const scopeCards = useMemo(() => scopeFor(`${v}|${view === "smart" ? "smart" : path ? view : ""}|${path}`, () => (view === "smart" ? (smart ? store.cardsMatching(smart) : []) : store.cardsIn(path, view))), [path, view, v]);
  const counts = useMemo(() => memoOn(scopeCards, "counts", () => {
    const now = Date.now(); let due = 0, learning = 0, fresh = 0, susp = 0, studied = 0;
    for (const c of scopeCards) { if (c.suspended) { susp++; continue; } if (c.state === "new") fresh++; else if (c.due <= now) due++; if (c.state === "learning" || c.state === "relearning") learning++; if (c.reps) studied++; }
    return { due, learning, fresh, susp, studied, total: scopeCards.length };
  }), [scopeCards]);

  // One row per note; `all` keeps every matching card, so counts, "All", bulk actions and Study act on all of them (03-3).
  const scores = q ? (hits && (hits.q === q || searching) ? hits.scores : null) : null;
  const sortBy = sort === "best" && !scores ? "due" : sort;
  const matches = useMemo(() => {
    const first = new Map<string, Card>(); const all: Card[] = []; let out: Card[] = [];
    if (!showCards && !q && !only) return { rows: out, all, cards: 0 };
    if (q && !scores) return { rows: out, all, cards: 0 };
    const over = only === "overfilled" ? overSet() : undefined;
    for (const c of scopeCards) {
      if (only && !passes(c, only, over)) continue; // checked per card, before siblings are folded together (a flag sits on one card)
      if (scores && !scores.has(c.nid)) continue;
      all.push(c); if (!first.has(c.nid)) { first.set(c.nid, c); out.push(c); }
    }
    // Sort on precomputed numeric keys (a query like "p" matches most of the collection; comparator lookups would freeze it).
    const order = { learning: 0, relearning: 0, review: 1, new: 2 } as Record<string, number>;
    const keyed = (k: (c: Card) => number) => { const ks = out.map((c, i) => ({ c, k: k(c), d: (c.state === "new" ? 1e15 : 0) + c.due, i })); ks.sort((a, b) => a.k - b.k || a.d - b.d || a.i - b.i); return ks.map((x) => x.c); };
    if (sortBy === "best" && scores) out = keyed((c) => -scores.get(c.nid)!);
    else if (sortBy === "due") out = keyed(() => 0);
    else if (sortBy === "new") out = keyed((c) => -c.created);
    else if (sortBy === "state") out = keyed((c) => (c.suspended ? 3 : order[c.state]));
    else out.sort((a, b) => a.source.localeCompare(b.source));
    return { rows: out, all, cards: all.length };
  }, [scopeCards, showCards, q, scores, sortBy, only, v]);
  const groupOf = (c: Card) => { const g = matches.all.filter((x) => x.nid === c.nid); return g.length ? g : [c]; };
  const matchedCards = () => scores ? matches.all.map((c) => ({ c, k: -scores.get(c.nid)! })).sort((a, b) => a.k - b.k).map((x) => x.c) : matches.all;
  const filterCounts = useMemo(() => memoOn(scopeCards, "filters", () => { const k = { flagged: 0, improve: 0, suspended: 0, leech: 0, overfilled: 0 }; const over = overSet(); const overN = new Set<string>(); const notes = { improve: new Set<string>(), leech: new Set<string>() }; for (const c of scopeCards) { if (c.flag) k.flagged++; if (c.suspended) k.suspended++; if (store.improveFor(c.nid)) notes.improve.add(c.nid); if (store.noteFor(c)?.tags.includes("leech")) notes.leech.add(c.nid); if (over.has(c.nid)) overN.add(c.nid); } k.overfilled = overN.size; k.improve = notes.improve.size; k.leech = notes.leech.size; return k; }), [scopeCards]);
  const list = useMemo(() => matches.rows.slice(0, 300).map((c) => { const n = store.noteFor(c)!; return { card: c, title: noteTitle(n, store.notetypeFor(n)), state: c.suspended ? "paused" : c.state }; }), [matches]);

  // Hooks first, always in the same order (the empty-library screen below returns early).
  const go = (p: string) => { setPath(p); setShowCards(false); setSelecting(false); setSelected(new Set()); };
  useBack(!!path, () => go(path.split("::").slice(0, -1).join("::")));
  const [deleted, setDeleted] = useState<{ n: number; token: unknown } | null>(null);
  const [improveFor, setImproveFor] = useState<string[] | null>(null);
  const [sheet, setSheet] = useState<{ title: string; sub?: string; items: SheetItem[] } | null>(null);
  const [editCard, setEditCard] = useState<Card | null>(null);
  const [infoCard, setInfoCard] = useState<Card | null>(null);
  /** A tag chip (preview, editor, card info): show the cards with that tag here in the Library. */
  const openTag = (t: string) => {
    const [v, p] = (t.startsWith("auto::System::") ? ["systems", t.slice(14)] : t.startsWith("auto::Specialty::") ? ["specialties", t.slice(17)] : t.startsWith("auto::Exam::") ? ["exams", t.slice(12)] : ["tags", t]) as [View, string];
    setPreview(null); setEditCard(null); setInfoCard(null); setView(v); go(p); setQuery(""); setOnly(null); setShowCards(true);
  };
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
    { label: "Card info", onClick: () => setInfoCard(card) },
    { label: n && store.improveFor(n.id) ? "Change improve mark" : "Needs improving…", onClick: () => n && setImproveFor([n.id]) },
    { label: card.flag ? "Unflag" : "Flag", onClick: () => store.setFlag(card.id, card.flag ? 0 : 1) },
    { label: card.suspended ? "Unpause" : "Pause", onClick: async () => { await store.setSuspended(card.id, !card.suspended); snackbar(card.suspended ? "Unpaused" : "Paused", () => store.setSuspended(card.id, card.suspended)); } },
    { label: "Select", onClick: () => { setSelecting(true); setSelected(new Set(groupOf(card).map((x) => x.id))); } },
    { label: "Delete", danger: true, onClick: async () => { if (!n) return; const k = store.cardsOfNote(n.id).length; if (!(await confirmSheet({ title: k > 1 ? `Delete this note and its ${k} cards?` : "Delete this card?", sub: "Review history goes too. You can undo right after.", yes: "Delete" }))) return; await store.deleteNotes([n.id]); snackbar("Deleted", () => { store.undoDelete(); }); } },
  ] }); };

  if (store.cards.size === 0) {
    return (<div className="screen"><div className="row"><h1 className="grow" style={{ margin: 0 }}>Library</h1><button className="chip" onClick={() => setTool("card")}>＋ Card</button><button className="chip" onClick={() => setTool("occlusion")}>＋ Image</button></div><div className="empty">No cards yet. Import your Anki collection from Settings.</div>{tool === "occlusion" && <OcclusionEditor onClose={() => setTool(null)} />}{tool === "card" && <CardEditor full onClose={() => setTool(null)} />}</div>);
  }
  const doBulk = async (action: Parameters<typeof store.bulk>[1]) => { await store.bulk([...selected], action); setSelected(new Set()); setSelecting(false); };
  const title = view === "smart" ? (smart?.name ?? "Smart decks") : node!.name;
  if (tool === "dupes") return <Duplicates onClose={() => setTool(null)} />;

  return (
    <div className={"screen" + (wide && preview ? " lib-docked" : "")}>
      <div className="row"><h1 className="grow" style={{ margin: 0 }}>Library</h1>{similarCount > 0 && <button className="chip orange" onClick={() => setTool("dupes")}>{similarCount} similar pair{similarCount === 1 ? "" : "s"}</button>}<button className="chip" style={{ marginLeft: 6 }} onClick={() => setTool("card")}>＋ Card</button><button className="chip" style={{ marginLeft: 6 }} onClick={() => setTool("occlusion")}>＋ Image</button></div>
      {tool === "occlusion" && <OcclusionEditor onClose={() => setTool(null)} />}
      {tool === "card" && <CardEditor full onClose={() => setTool(null)} onSimilar={() => setTool("dupes")} />}
      <div className="seg">
        {[...VIEWS, { id: "smart" as View, label: "Smart" }].map((x) => <button key={x.id} className={view === x.id ? "on" : ""} aria-pressed={view === x.id} onClick={() => { setView(x.id); go(""); }}>{x.label}</button>)}
      </div>
      {smart && <div className="crumbs"><button style={{ minWidth: 44, minHeight: 32 }} onClick={() => go("")}>Smart</button><span className="row" style={{ gap: 4 }}><span className="muted">›</span><button aria-current="page">{smart.name}</button></span></div>}
      {view !== "smart" && path && ( /* 03-15: at the root the crumb would only repeat the title */
        <div className="crumbs">
          <button style={{ minWidth: 44, minHeight: 32 }} onClick={() => go("")}>All</button>
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
            <div className="row lib-node-head">
              <div className="grow">
                <div style={{ fontWeight: 700, fontSize: 18 }}>{title}</div>
                <div className="small muted">{counts.total.toLocaleString()} cards · {counts.susp.toLocaleString()} paused · {counts.studied.toLocaleString()} studied</div>
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
          <div className="field"><input type="search" aria-label="Search cards and tags" placeholder="Search cards and tags here" title="Searches every field and the tags. tag:x searches tags only; #… or auto::… also searches housekeeping tags." value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "-4px 0 10px" }}>
            {([["flagged", "Flagged"], ["improve", "To improve"], ["overfilled", "Overfilled"], ["leech", "Leeches"], ["suspended", "Paused"]] as const).filter(([k]) => filterCounts[k] > 0 || only === k).map(([k, label]) => (
              <button key={k} data-hint={FILTER_HINT[k]} className={"chip" + (only === k ? " orange" : "")} disabled={!filterCounts[k] && only !== k} onClick={() => setOnly(only === k ? null : k)}>{label} · {filterCounts[k].toLocaleString()}</button>))}
          </div>
          {!query && !only && node && node.children.length > 0 && (
            <>
              <h2>{view === "tags" ? "Tags" : "Categories"}</h2>
              {view === "tags" && !path && <label className="row small muted" style={{ marginBottom: 6 }}><input type="checkbox" checked={allTags} onChange={(e) => setAllTags(e.target.checked)} /> Show housekeeping tags (#, !, AnkiHub, numbers)</label>}
              {[...node.children].filter((c) => view !== "tags" || allTags || path || !isHousekeepingTag(c.name)).sort((a, b) => (["Other", "Unclassified", "No exam", "Untagged"].includes(a.name) ? 1 : 0) - (["Other", "Unclassified", "No exam", "Untagged"].includes(b.name) ? 1 : 0)).map((c) => (
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
          {!query && !only && !showCards && <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => { setShowCards(true); setTimeout(() => document.getElementById("lib-cards")?.scrollIntoView({ block: "start", behavior: "smooth" }), 60); }}>Show cards in {title}</button>}
          {(showCards || query || only) && (
            <>
              <div className="row" id="lib-cards" style={{ marginTop: 18 }}>
                <h2 className="grow list-head" style={{ margin: 0 }} aria-live="polite">{q && !scores ? "Searching…" : <>{matches.rows.length === matches.cards ? `${matches.cards.toLocaleString()} card${matches.cards === 1 ? "" : "s"}` : <>{matches.rows.length.toLocaleString()} notes <span className="small muted" style={{ whiteSpace: "nowrap" }}>· {matches.cards.toLocaleString()} cards</span></>}{matches.rows.length > 300 ? ", first 300 shown" : ""}{searching ? " · searching…" : ""}</>}</h2>
                {matches.rows.length > 0 && !selecting && <button className="chip orange" onClick={() => { const pool = matchedCards(); onStudy(path, view, { preset: pool.filter((c) => only === "suspended" || !c.suspended).slice(0, 500), title: only ? { flagged: "Flagged cards", improve: "Cards to improve", leech: "Leeches", suspended: "Paused cards", overfilled: "Overfilled cards" }[only] : `“${query}”` }); }}><IconPlay /> Study these</button>}
                <select className="chip" value={sortBy} onChange={(e) => setSort(e.target.value as any)} aria-label="Sort">{scores && <option value="best">best match</option>}<option value="due">by due</option><option value="new">newest</option><option value="state">by state</option><option value="deck">by deck</option></select>
                <button className="chip" onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>{selecting ? "Cancel" : "Select"}</button>
                {selecting && <button className="chip" onClick={() => setSelected(new Set(matchedCards().map((c) => c.id)))}>All {matches.cards.toLocaleString()} card{matches.cards === 1 ? "" : "s"}</button>}
              </div>
              {list.map((r) => (
                <HoldRow key={r.card.id} className="list-row" style={{ width: "100%", textAlign: "left" }} onHold={() => cardSheet(r.card, r.title)} onTap={() => { if (selecting) { const s = new Set(selected); const on = !s.has(r.card.id); for (const c of groupOf(r.card)) on ? s.add(c.id) : s.delete(c.id); setSelected(s); } else setPreview(r.card); }}>
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
          <span className="small">{selected.size.toLocaleString()} card{selected.size === 1 ? "" : "s"} selected</span>
          <button className="btn primary" onClick={() => { const cards = [...selected].map((id) => store.cards.get(id)!).filter(Boolean); setSelecting(false); setSelected(new Set()); onStudy(path, view, { preset: cards, title: `${cards.length} selected` }); }}>Study</button>
          <button className="btn" onClick={() => doBulk({ suspended: true })}>Pause</button>
          <button className="btn" onClick={() => doBulk({ flag: 1 })}>Flag</button>
          <button className="btn" onClick={() => setTagTo("")}>Tag</button>
          <button className="btn" aria-haspopup="dialog" onClick={() => setSheet({ title: `${selected.size.toLocaleString()} selected`, items: [ /* 03-12: the rest of the bulk actions, so the bar stays one row */
            { label: "Unpause", onClick: () => doBulk({ suspended: false }) },
            { label: "Unflag", onClick: () => doBulk({ flag: 0 }) },
            { label: "Move to a category…", onClick: () => setMoveTo("") },
            { label: "Set system…", onClick: () => setClassify("System") },
            { label: "Set specialty…", onClick: () => setClassify("Specialty") },
            { label: "Needs improving…", onClick: () => setImproveFor([...new Set([...selected].map((id) => store.cards.get(id)?.nid).filter(Boolean) as string[])]) },
            { label: "Delete…", danger: true, onClick: async () => { const nids = [...new Set([...selected].map((id) => store.cards.get(id)?.nid).filter(Boolean) as string[])]; if (!(await confirmSheet({ title: `Delete ${nids.length.toLocaleString()} note${nids.length === 1 ? "" : "s"} and all their cards?`, sub: "Review history goes too. You can undo right after.", yes: "Delete" }))) return; const n = await store.deleteNotes(nids); setSelected(new Set()); setSelecting(false); setDeleted({ n, token: store.lastDeleted }); } },
          ] })}>More…</button>
        </div>
      )}
      {deleted && deleted.n > 0 && store.lastDeleted === deleted.token && (
        <div className="bulk-bar"><span className="small grow">Deleted {deleted.n.toLocaleString()} note{deleted.n === 1 ? "" : "s"}</span><button className="btn" onClick={async () => { await store.undoDelete(); setDeleted(null); }}>Undo</button><button className="btn" onClick={() => setDeleted(null)}>OK</button></div>
      )}
      {tagTo !== null && (
        <Sheet title={`Tag ${selected.size} cards`} onClose={() => setTagTo(null)}>
          <div className="field"><label>Tag (use :: for levels)</label><input value={tagTo} onChange={(e) => setTagTo(e.target.value)} placeholder="step1::high-yield" autoCapitalize="none" /></div>
          <button className="btn primary block" disabled={!tagTo.trim()} onClick={async () => { await doBulk({ addTag: tagTo.trim().replace(/\s+/g, "_") }); setTagTo(null); }}>Add tag</button>
        </Sheet>
      )}
      {moveTo !== null && (
        <Sheet title={`Move ${selected.size} cards to`} onClose={() => setMoveTo(null)}>
          <div className="field"><label>Category path (use :: for levels)</label><input value={moveTo} list="deckpaths" onChange={(e) => setMoveTo(e.target.value)} placeholder="Medicine::Cardiology::ECG" /></div>
          <datalist id="deckpaths">{[...new Set([...store.cards.values()].map((c) => c.source))].sort().map((p) => <option key={p} value={p} />)}</datalist>
          <button className="btn primary block" disabled={!moveTo.trim()} onClick={async () => { await doBulk({ source: moveTo.trim() }); setMoveTo(null); }}>Move</button>
        </Sheet>
      )}
      {rename !== null && (
        <Sheet title={`Rename or move “${path.split("::").pop()}”`} onClose={() => setRename(null)}>
          <p className="small muted" style={{ marginTop: 4 }}>Edit the full path. Change the last part to rename; change the part before it to move the category (and everything inside it) somewhere else.</p>
          <div className="field"><label>Full path</label><input value={rename} list="deckpaths" onChange={(e) => setRename(e.target.value)} /></div>
          <datalist id="deckpaths">{[...new Set([...store.cards.values()].map((c) => c.source))].sort().map((p) => <option key={p} value={p} />)}</datalist>
          <button className="btn primary block" disabled={!rename.trim() || rename.trim() === path} onClick={async () => {
            const from = path, to = rename.trim().replace(/\s*::\s*/g, "::").replace(/^::|::$/g, ""); const k = store.renameClash(from, to);
            if (k.existing && !(await confirmSheet({ title: `“${to.split("::").pop()}” already exists — merge ${k.moving.toLocaleString()} card${k.moving === 1 ? "" : "s"} into it?`, sub: `${to.replace(/::/g, " › ")} already has ${k.existing.toLocaleString()} card${k.existing === 1 ? "" : "s"}. The two become one category. You can undo right after.`, yes: "Merge" }))) return;
            const n = await store.renamePath(from, to); setRename(null); go(to);
            snackbar(`${k.existing ? "Merged" : "Moved"} ${n.toLocaleString()} card${n === 1 ? "" : "s"} into ${to.replace(/::/g, " › ")}`, async () => { await store.undoRename(); go(from); });
          }}>Apply</button>
        </Sheet>
      )}
      {classify && (
        <Sheet title={`${classify} for ${selected.size} cards`} onClose={() => setClassify(null)}>
          <p className="small muted" style={{ marginTop: 4 }}>Tap to add; tap again (when all selected cards have it) to remove. A card can belong to several.</p>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {(classify === "System" ? SYSTEM_NAMES : store.tree("specialties").children.map((c) => c.name).filter((n) => n !== "Other")).map((name) => {
              const tag = `auto::${classify}::${name}`; const ids = [...selected]; const all = ids.every((id) => store.noteFor(store.cards.get(id)!)?.tags.includes(tag));
              return <button key={name} className={"chip" + (all ? " orange" : "")} onClick={() => store.classify(ids, classify, name, !all)}>{name}</button>;
            })}
          </div>
          {classify === "Specialty" && <div className="field" style={{ marginTop: 10 }}><label>New specialty</label><div className="row"><input className="grow" id="newspec" placeholder="e.g. Toxicology" /><button className="btn" onClick={() => { const v = (document.getElementById("newspec") as HTMLInputElement).value.trim(); if (v) store.classify([...selected], "Specialty", v, true); }}>Add</button></div></div>}
          <button className="btn block" style={{ marginTop: 10 }} onClick={() => setClassify(null)}>Done</button>
        </Sheet>
      )}
      {preview && <Preview docked={wide} card={preview} onClose={() => setPreview(null)} onTag={openTag} onStudy={(cards, t) => { setPreview(null); onStudy(path, view, { preset: cards, title: t }); }} />}
      {sheet && <ActionSheet title={sheet.title} sub={sheet.sub} items={sheet.items} onClose={() => setSheet(null)} />}
      {editCard && <NoteEditor card={editCard} onClose={() => setEditCard(null)} onTag={openTag} />}
      {infoCard && <CardInfo card={infoCard} onClose={() => setInfoCard(null)} onSaved={() => setInfoCard(null)} onTag={openTag} />}
      {improveFor && <ImproveSheet nids={improveFor} onClose={() => { setImproveFor(null); setSelected(new Set()); setSelecting(false); }} />}
      {editSmart && <SmartEditor initial={editSmart === "new" ? undefined : editSmart} onClose={() => { setEditSmart(null); if (view === "smart" && path && !store.settings.smart.some((s) => s.id === path)) go(""); }} />}
    </div>
  );
}
