// Read and make cards: paste a text, read it line by line, tap the words you want to learn. Lines with gaps become an
// ordered cloze deck (lib/readmake.ts), so they come in reading order with the line before shown above each card.
import { useMemo, useState } from "react";
import { store } from "../lib/store";
import { splitLines, tokens, readPack } from "../lib/readmake";
import { langFromPath } from "../lib/deckopts";
import { Sheet, snackbar } from "./kit";

export function ReadMake({ onClose, initialDeck = "" }: { onClose: () => void; initialDeck?: string }) {
  const [step, setStep] = useState<"text" | "gaps">("text");
  const [title, setTitle] = useState(""); const [text, setText] = useState(""); const [deck, setDeck] = useState(initialDeck);
  const [each, setEach] = useState(false); const [gaps, setGaps] = useState<Map<number, Set<number>>>(new Map()); const [busy, setBusy] = useState(false);
  const lines = useMemo(() => splitLines(text), [text]);
  const category = (deck.trim() || `Languages::German::Reading::${title.trim() || "Text"}`).replace(/\s*::\s*/g, "::");
  const lang = langFromPath(category) ?? undefined;
  const toggle = (li: number, ti: number) => setGaps((g) => { const m = new Map(g); const s = new Set(m.get(li) ?? []); if (s.has(ti)) s.delete(ti); else s.add(ti); if (s.size) m.set(li, s); else m.delete(li); return m; });
  const cards = [...gaps.values()].reduce((n, s) => n + (each ? s.size : 1), 0); // (neighbouring words merge into one gap, so "each" can be fewer)
  const paths = useMemo(() => [...new Set([...store.cards.values()].map((c) => c.source))].sort(), []);
  async function save() {
    setBusy(true);
    try { const msg = await store.importPack(readPack({ title: title.trim() || "Text", category, lang, lines, gaps, each })); snackbar(msg); onClose(); }
    catch (e: any) { snackbar(String(e?.message ?? e)); } finally { setBusy(false); }
  }
  return (
    <Sheet title={step === "text" ? "Read and make cards" : `Tap the words to learn — ${title || "Text"}`} onClose={onClose} wide className="read-make" dirty={!!text.trim()} discard="Leave this text? The gaps you picked are lost.">
      {step === "text" ? <>
        <p className="small muted" style={{ marginTop: 2 }}>Paste a chapter, a lecture's notes or a story. You'll read it line by line and tap the words to turn into gaps; each line with a gap becomes a card, in reading order.</p>
        <div className="field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Der Erlkönig" data-testid="rm-title" /></div>
        <div className="field"><label>Deck</label><input value={deck} list="rm-decks" onChange={(e) => setDeck(e.target.value)} placeholder={`Languages::German::Reading::${title.trim() || "Text"}`} /><datalist id="rm-decks">{paths.map((p) => <option key={p} value={p} />)}</datalist></div>
        <div className="field"><label>Text</label><textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="Wer reitet so spät durch Nacht und Wind? Es ist der Vater mit seinem Kind." data-testid="rm-text" /></div>
        <p className="small muted">{lines.length ? `${lines.length.toLocaleString()} line${lines.length === 1 ? "" : "s"}${lines.length >= 400 ? " (the first 400)" : ""}` : ""}{lang ? ` · read in ${lang === "de-DE" ? "German" : lang}` : ""}</p>
        <button className="btn primary block" disabled={!lines.length} onClick={() => setStep("gaps")} data-testid="rm-next">Next: pick the gaps</button>
      </> : <>
        <div className="rm-lines" data-testid="rm-lines">
          {lines.map((line, li) => { const s = gaps.get(li); return (
            <p key={li} className={"rm-line" + (s ? " has" : "")}><span className="rm-no small muted">{li + 1}</span>
              {tokens(line).map((t, ti) => t.word ? <button key={ti} className={"rm-w" + (s?.has(ti) ? " on" : "")} aria-pressed={!!s?.has(ti)} onClick={() => toggle(li, ti)}>{t.t}</button> : <span key={ti}>{t.t}</span>)}
            </p>); })}
        </div>
        <label className="row small" style={{ margin: "10px 0 6px" }}><input type="checkbox" checked={each} onChange={(e) => setEach(e.target.checked)} /> Each gap its own card (else one card per line, all its gaps together)</label>
        <p className="small muted" data-testid="rm-count">{gaps.size ? `${gaps.size.toLocaleString()} line${gaps.size === 1 ? "" : "s"} → about ${cards.toLocaleString()} card${cards === 1 ? "" : "s"} in ${category.replace(/::/g, " › ")}, in reading order.` : "Tap a word to make it a gap; tap again to undo."}</p>
        <div className="row" style={{ gap: 8 }}><button className="btn grow" onClick={() => setStep("text")}>Back to the text</button><button className="btn primary grow" disabled={!gaps.size || busy} onClick={save} data-testid="rm-save">Make {cards.toLocaleString()} card{cards === 1 ? "" : "s"}</button></div>
      </>}
    </Sheet>
  );
}
