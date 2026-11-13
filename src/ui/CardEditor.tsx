// Write cards in Yuzu: a quick sheet (Today → ＋ Card) and the full editor (Library → ＋ Card) with a picture and a live preview.
// Types: cloze, basic, multiple choice, vocabulary (German by default, with a recording or the device's voice).
// A saved card goes in as a one-card pack ("Written in Yuzu", one pack per day), so it gets the same ids, sync and history as any pack.
import { useMemo, useRef, useState } from "react";
import { store } from "../lib/store";
import { parsePack } from "../import/pack";
import { renderCard } from "../lib/render";
import { IconClose } from "./icons";
import { snackbar } from "./kit";
import { shrinkImage } from "./Occlusion";
import { CardView } from "./Study";

type Kind = "cloze" | "basic" | "mcq" | "vocab";
interface Opt { text: string; why: string }
const remember = (k: string, v?: string) => { try { if (v === undefined) return localStorage.getItem(k) ?? ""; localStorage.setItem(k, v); } catch { /* fine */ } return v ?? ""; };
const readFile = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

export function CardEditor({ full = false, onClose }: { full?: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>(() => (remember("yuzu-edit-kind") as Kind) || "cloze");
  const [deck, setDeck] = useState(() => remember("yuzu-edit-deck") || "Medicine::Inbox");
  const [tags, setTags] = useState(""); const [source, setSource] = useState("");
  const [text, setText] = useState(""); const [extra, setExtra] = useState("");
  const [front, setFront] = useState(""); const [back, setBack] = useState("");
  const [question, setQuestion] = useState(""); const [opts, setOpts] = useState<Opt[]>([{ text: "", why: "" }, { text: "", why: "" }, { text: "", why: "" }]); const [right, setRight] = useState(0); const [expl, setExpl] = useState("");
  const [word, setWord] = useState(""); const [article, setArticle] = useState(""); const [plural, setPlural] = useState(""); const [meaning, setMeaning] = useState(""); const [example, setExample] = useState(""); const [audio, setAudio] = useState("");
  const [image, setImage] = useState(""); const [busy, setBusy] = useState(false); const [side, setSide] = useState<"front" | "back">("front"); const [ord, setOrd] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const decks = useMemo(() => store.tree("decks").children.flatMap((c) => [c.path, ...c.children.map((g) => g.path)]), []);

  const card = (): any => {
    const base = { id: "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), source: source.trim() || undefined, image: full && image ? image : undefined };
    if (kind === "cloze") return { ...base, type: "cloze", text, extra };
    if (kind === "basic") return { ...base, type: "basic", front, back };
    if (kind === "mcq") return { ...base, type: "mcq", question, options: opts.filter((o) => o.text.trim()).map((o, i) => ({ text: o.text.trim(), why: o.why.trim(), correct: i === right })), explanation: expl };
    return { ...base, image: undefined, type: "vocab", word: word.trim(), article: article || undefined, plural: plural.trim() || undefined, meaning: meaning.trim(), example: example.trim() || undefined, audio: audio || undefined, lang: "de-DE" };
  };
  const ready = kind === "cloze" ? /\{\{c\d+::.+?\}\}/.test(text) : kind === "basic" ? !!front.trim() && !!back.trim() : kind === "mcq" ? !!question.trim() && opts.filter((o) => o.text.trim()).length >= 2 && !!opts[right]?.text.trim() : !!word.trim() && !!meaning.trim();
  const pack = () => ({ yuzu_pack: 1, id: `written-${store.isoToday()}`, name: "Written in Yuzu", category: deck.trim() || "Medicine::Inbox", tags: tags.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean), cards: [card()] });

  // live preview: the same parser and renderer the study screen uses
  const preview = useMemo(() => {
    if (!full || !ready) return null;
    try {
      const r = parsePack(pack(), []); const note = r.notes[0]; const nt = r.notetypes.find((t) => t.id === note?.ntid); if (!note || !nt) return null;
      const media = new Map(r.media.map((m) => [m.name, m.dataUrl])); const ords = r.cards.map((c) => c.ord); const o = ords.includes(ord) ? ord : ords[0];
      const out = renderCard({ note, notetype: nt, ord: o, deck, resolveMedia: (n: string) => media.get(n) ?? store.mediaUrl?.(n) });
      return { ...out, ords, ord: o };
    } catch { return null; }
  }, [full, ready, kind, text, extra, front, back, question, opts, right, expl, word, article, plural, meaning, example, audio, image, deck, ord]);

  const gap = () => { // wrap the selection in the next cloze number
    const el = area.current; if (!el) return; const n = Math.max(0, ...[...text.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]))) + 1;
    const [a, b] = [el.selectionStart, el.selectionEnd]; const sel = text.slice(a, b) || "answer"; const next = text.slice(0, a) + `{{c${n}::${sel}}}` + text.slice(b);
    setText(next); requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + `{{c${n}::`.length, a + `{{c${n}::`.length + sel.length); });
  };
  const clear = () => { setText(""); setExtra(""); setFront(""); setBack(""); setQuestion(""); setOpts([{ text: "", why: "" }, { text: "", why: "" }, { text: "", why: "" }]); setRight(0); setExpl(""); setWord(""); setArticle(""); setPlural(""); setMeaning(""); setExample(""); setAudio(""); setImage(""); setOrd(0); setSide("front"); };
  const save = async () => {
    setBusy(true);
    try { const r = await store.importPackDetailed(pack()); remember("yuzu-edit-kind", kind); remember("yuzu-edit-deck", deck.trim()); if (r.added + r.updated + r.repaired > 0) { snackbar(`Saved to ${(deck.trim() || "Medicine::Inbox").split("::").filter((x) => x.trim()).slice(-1)[0] ?? "Inbox"}`); clear(); } else snackbar(r.skippedDuplicate ? "Already in your collection — not added. Your text is still here." : r.message); }
    catch (e: any) { snackbar(e?.message ?? String(e)); } finally { setBusy(false); }
  };

  const field = (label: string, value: string, set: (v: string) => void, opts2: { area?: boolean; ph?: string; aria?: string } = {}) => (
    <div className="field"><label>{label}</label>{opts2.area ? <textarea className="typeans" rows={3} aria-label={opts2.aria ?? label} placeholder={opts2.ph} value={value} onChange={(e) => set(e.target.value)} /> : <input aria-label={opts2.aria ?? label} placeholder={opts2.ph} value={value} onChange={(e) => set(e.target.value)} />}</div>
  );
  return (
    <div className="sheet-backdrop" onClick={onClose}><div className={"sheet" + (full ? " sheet-wide" : "")} role="dialog" aria-label={full ? "Card editor" : "Quick add"} onClick={(e) => e.stopPropagation()} style={{ maxHeight: "94vh", overflow: "auto" }}>
      <div className="row"><b className="grow">{full ? "New card" : "Quick add"}</b><button className="icon-btn" aria-label="Close editor" onClick={onClose}><IconClose /></button></div>
      <div className="seg" role="radiogroup" aria-label="Card type" style={{ marginTop: 8 }}>{([["cloze", "Cloze"], ["basic", "Basic"], ["mcq", "MCQ"], ["vocab", "Vocab"]] as const).map(([k, l]) => <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => { setKind(k); setOrd(0); if (k === "vocab" && /^Medicine::Inbox$/.test(deck)) setDeck("German::Vocab"); else if (k !== "vocab" && deck === "German::Vocab") setDeck("Medicine::Inbox"); }}>{l}</button>)}</div>
      <div className={full ? "editor-cols" : ""}><div>
        {kind === "cloze" && <>
          <div className="field"><label>Text <span className="muted small">select words, then Make gap</span></label><textarea ref={area} className="typeans" rows={4} aria-label="Cloze text" placeholder="Hyperkalaemia: give {{c1::calcium gluconate}} first to stabilise the membrane" value={text} onChange={(e) => setText(e.target.value)} /></div>
          <div className="row" style={{ gap: 8, margin: "-4px 0 8px" }}><button className="btn" onClick={gap}>Make gap</button><span className="small muted">{[...new Set([...text.matchAll(/\{\{c(\d+)::/g)].map((m) => m[1]))].length || 0} card(s)</span></div>
          {field("Extra (shown on the back)", extra, setExtra, { area: true })}
        </>}
        {kind === "basic" && <>{field("Front", front, setFront, { area: true })}{field("Back", back, setBack, { area: true })}</>}
        {kind === "mcq" && <>
          {field("Question", question, setQuestion, { area: true, ph: "A 54-year-old man… What is the next step?" })}
          <div className="field"><label>Options <span className="muted small">tap the letter of the right one</span></label>
            {opts.map((o, i) => <div key={i} style={{ marginBottom: 6 }}>
              <div className="row" style={{ gap: 6 }}><button className={"chip" + (right === i ? " orange" : "")} aria-label={`Option ${String.fromCharCode(65 + i)} is right`} aria-pressed={right === i} onClick={() => setRight(i)}>{right === i ? "✓" : String.fromCharCode(65 + i)}</button>
                <input className="grow" style={{ minWidth: 0 }} aria-label={`Option ${String.fromCharCode(65 + i)}`} value={o.text} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                {opts.length > 2 && <button className="icon-btn" aria-label={`Remove option ${String.fromCharCode(65 + i)}`} onClick={() => { setOpts(opts.filter((_, j) => j !== i)); if (right >= i && right > 0) setRight(right - 1); }}><IconClose /></button>}</div>
              {full && <input className="small" style={{ marginTop: 4, width: "100%" }} aria-label={`Why option ${String.fromCharCode(65 + i)}`} placeholder="Why (optional)" value={o.why} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? { ...x, why: e.target.value } : x)))} />}
            </div>)}
            {opts.length < 5 && <button className="btn" onClick={() => setOpts([...opts, { text: "", why: "" }])}>Add option</button>}
          </div>
          {field("Explanation", expl, setExpl, { area: true })}
        </>}
        {kind === "vocab" && <>
          <div className="seg" role="radiogroup" aria-label="Article">{["", "der", "die", "das"].map((a) => <button key={a || "none"} role="radio" aria-checked={article === a} className={article === a ? "on" : ""} onClick={() => setArticle(a)}>{a || "none"}</button>)}</div>
          {field("Word", word, setWord, { ph: "Schmerz" })}{field("Meaning", meaning, setMeaning, { ph: "pain" })}
          {field("Plural", plural, setPlural, { ph: "die Schmerzen" })}{field("Example", example, setExample, { area: true, ph: "Wo haben Sie Schmerzen?" })}
          <div className="row small" style={{ gap: 8, alignItems: "center", margin: "4px 0 8px" }}>
            <label className="btn" style={{ cursor: "pointer" }}>{audio ? "Change recording" : "Add a recording"}<input type="file" accept="audio/*" capture aria-label="Recording" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) setAudio(await readFile(f)); }} /></label>
            <span className="muted">{audio ? "Recording attached" : "Without one, the device says the word in German"}</span>
          </div>
        </>}
        {full && kind !== "vocab" && <div className="row small" style={{ gap: 8, alignItems: "center", margin: "4px 0 8px" }}>
          <label className="btn" style={{ cursor: "pointer" }}>{image ? "Change picture" : "Add a picture"}<input type="file" accept="image/*" aria-label="Picture" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImage(await shrinkImage(f, 1200)); }} /></label>
          {image && <><img src={image} alt="" style={{ height: 40, borderRadius: 4 }} /><button className="btn" onClick={() => setImage("")}>Remove</button></>}
        </div>}
        <div className="field"><label>Deck</label><input list="yuzu-decks" aria-label="Deck" autoCapitalize="none" value={deck} onChange={(e) => setDeck(e.target.value)} /><datalist id="yuzu-decks">{decks.map((d) => <option key={d} value={d} />)}</datalist></div>
        {full && <>{field("Tags (space or comma)", tags, setTags)}{field("Source", source, setSource, { ph: "ERC 2025, UpToDate 2026…" })}</>}
      </div>
      {full && <div className="editor-preview">
        <div className="row" style={{ gap: 6, alignItems: "center" }}><b className="small grow">Preview</b>
          {preview && preview.ords.length > 1 && preview.ords.map((o, i) => <button key={o} className={"chip" + (o === preview.ord ? " orange" : "")} onClick={() => setOrd(o)}>Card {i + 1}</button>)}
          <div className="seg" style={{ margin: 0 }}><button className={side === "front" ? "on" : ""} onClick={() => setSide("front")}>Front</button><button className={side === "back" ? "on" : ""} onClick={() => setSide("back")}>Back</button></div></div>
        {preview ? <div className={"paper" + (store.settings.nightCards ? " slate" : "")} style={{ marginTop: 8 }}><CardView html={side === "front" ? preview.front : preview.back} css={preview.css} dark={store.settings.nightCards} side={side} /></div> : <p className="small muted">The card shows here once it has what it needs{kind === "cloze" ? " (at least one gap)" : ""}.</p>}
      </div>}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="btn" onClick={clear}>Clear</button>
        <button className="btn primary grow" disabled={!ready || busy} onClick={save}>{busy ? "Saving…" : "Save card"}</button>
      </div>
    </div></div>
  );
}
