// Write cards in Yuzu: a quick sheet (Today → ＋ Card) and the full editor (Library → ＋ Card) with a picture and a live preview.
// Types: cloze, basic, multiple choice, vocabulary (German by default, with a recording or the device's voice).
// A saved card goes in as a one-card pack ("Written in Yuzu", one pack per day), so it gets the same ids, sync and history as any pack.
import { useMemo, useRef, useState } from "react";
import { store } from "../lib/store";
import type { Card } from "../lib/model";
import { useBack } from "./useBack";
import { parsePack } from "../import/pack";
import { renderCard } from "../lib/render";
import { IconClose } from "./icons";
import { FileButton, Sheet, snackbar } from "./kit";
import { shrinkImage } from "./Occlusion";
import { CardView } from "./Study";
import { clozeNumbers } from "../lib/cloze";

type Kind = "cloze" | "basic" | "mcq" | "vocab";
interface Opt { text: string; why: string }
const remember = (k: string, v?: string) => { try { if (v === undefined) return localStorage.getItem(k) ?? ""; localStorage.setItem(k, v); } catch { /* fine */ } return v ?? ""; };
/** Wrap the selection [a, b) in the next cloze number. Null when nothing is selected (the user is told to select words first). */
export function wrapGap(text: string, a: number, b: number): { text: string; a: number; b: number } | null {
  if (a === b || !text.slice(a, b).trim()) return null;
  const n = Math.max(0, ...clozeNumbers(text)) + 1; const open = `{{c${n}::`;
  return { text: text.slice(0, a) + open + text.slice(a, b) + "}}" + text.slice(b), a: a + open.length, b: a + open.length + (b - a) };
}
const clozeCount = (t: string) => clozeNumbers(t).length;
const readFile = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

export function CardEditor({ full = false, onClose, onSimilar }: { full?: boolean; onClose: () => void; /** open the similar-cards review */ onSimilar?: () => void }) {
  const [kind, setKind] = useState<Kind>(() => (remember("yuzu-edit-kind") as Kind) || "cloze");
  const [deck, setDeck] = useState(() => remember("yuzu-edit-deck") || "Medicine::Inbox");
  const [tags, setTags] = useState(""); const [source, setSource] = useState("");
  const [text, setText] = useState(""); const [extra, setExtra] = useState("");
  const [front, setFront] = useState(""); const [back, setBack] = useState("");
  const [question, setQuestion] = useState(""); const [opts, setOpts] = useState<Opt[]>([{ text: "", why: "" }, { text: "", why: "" }, { text: "", why: "" }]); const [right, setRight] = useState(0); const [expl, setExpl] = useState("");
  const [word, setWord] = useState(""); const [article, setArticle] = useState(""); const [plural, setPlural] = useState(""); const [meaning, setMeaning] = useState(""); const [example, setExample] = useState(""); const [audio, setAudio] = useState("");
  const [image, setImage] = useState(""); const [busy, setBusy] = useState(false); const [side, setSide] = useState<"front" | "back">("front"); const [ord, setOrd] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const [gapHint, setGapHint] = useState(false); const [similar, setSimilar] = useState(false);
  // Keep the extra text and the picture for the next card too (Anki's sticky fields), remembered on this device
  const [keep, setKeep] = useState(() => remember("yuzu-edit-keep") === "1");
  const decks = useMemo(() => store.tree("decks").children.flatMap((c) => [c.path, ...c.children.map((g) => g.path)]), []);

  const card = (): any => {
    const base = { id: "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), source: source.trim() || undefined, image: full && image ? image : undefined };
    if (kind === "cloze") return { ...base, type: "cloze", text, extra };
    if (kind === "basic") return { ...base, type: "basic", front, back };
    if (kind === "mcq") return { ...base, type: "mcq", question, options: opts.filter((o) => o.text.trim()).map((o, i) => ({ text: o.text.trim(), why: o.why.trim(), correct: i === right })), explanation: expl };
    return { ...base, image: undefined, type: "vocab", word: word.trim(), article: article || undefined, plural: plural.trim() || undefined, meaning: meaning.trim(), example: example.trim() || undefined, audio: audio || undefined, lang: "de-DE" };
  };
  const ready = kind === "cloze" ? clozeNumbers(text).length > 0 : kind === "basic" ? !!front.trim() && !!back.trim() : kind === "mcq" ? !!question.trim() && opts.filter((o) => o.text.trim()).length >= 2 && !!opts[right]?.text.trim() : !!word.trim() && !!meaning.trim();
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
    const el = area.current; if (!el) return; const r = wrapGap(text, el.selectionStart, el.selectionEnd);
    if (!r) { setGapHint(true); el.focus(); return; }
    setGapHint(false); setText(r.text); requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.a, r.b); });
  };
  // right after a save (save → clear): did the card look like one already in the collection?
  const clear = () => {
    setSimilar(store.takeSimilar().length > 0); setGapHint(false); setText(""); if (!keep) setExtra(""); setFront(""); setBack(""); setQuestion(""); setOpts([{ text: "", why: "" }, { text: "", why: "" }, { text: "", why: "" }]); setRight(0); if (!keep) setExpl(""); setWord(""); setArticle(""); setPlural(""); setMeaning(""); setExample(""); setAudio(""); if (!keep) setImage(""); setOrd(0); setSide("front"); };
  const save = async () => {
    setBusy(true);
    try { const r = await store.importPackDetailed(pack()); remember("yuzu-edit-kind", kind); remember("yuzu-edit-deck", deck.trim()); if (r.added + r.updated + r.repaired > 0) { snackbar(`Saved to ${(deck.trim() || "Medicine::Inbox").split("::").filter((x) => x.trim()).slice(-1)[0] ?? "Inbox"}`); clear(); } else snackbar(r.skippedDuplicate ? "Already in your collection — not added. Your text is still here." : r.message); }
    catch (e: any) { snackbar(e?.message ?? String(e)); } finally { setBusy(false); }
  };

  const field = (label: string, value: string, set: (v: string) => void, opts2: { area?: boolean; ph?: string; aria?: string } = {}) => (
    <div className="field"><label>{label}</label>{opts2.area ? <textarea className="typeans" rows={3} aria-label={opts2.aria ?? label} placeholder={opts2.ph} value={value} onChange={(e) => set(e.target.value)} /> : <input aria-label={opts2.aria ?? label} placeholder={opts2.ph} value={value} onChange={(e) => set(e.target.value)} />}</div>
  );
  return (
    <Sheet title={full ? "New card" : "Quick add"} label={full ? "Card editor" : "Quick add"} closeLabel="Close editor" wide={full} onClose={onClose} discard="Discard this card?" style={{ maxHeight: "94vh", overflow: "auto" }}
      dirty={!!(text.trim() || extra.trim() || front.trim() || back.trim() || question.trim() || expl.trim() || opts.some((o) => o.text.trim() || o.why.trim()) || word.trim() || meaning.trim() || plural.trim() || example.trim() || audio || image)}>
      <div className="seg" role="radiogroup" aria-label="Card type" style={{ marginTop: 8 }}>{([["cloze", "Cloze"], ["basic", "Basic"], ["mcq", "MCQ"], ["vocab", "Vocab"]] as const).map(([k, l]) => <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => { if ((k === "vocab") !== (kind === "vocab")) { setTags(""); setSource(""); } /* medical tags and sources don't carry over to German words, or back */ setKind(k); setOrd(0); const de = () => { const g = store.tree("decks").children.find((c) => c.name === "German"); const big = g?.children.slice().sort((a, b) => b.total - a.total)[0]; return big?.path ?? (g ? g.path : "German::Vocab"); }; /* vocab goes to your biggest German deck (German::Klinik), not a new branch */ if (k === "vocab" && /^Medicine::Inbox$/.test(deck)) setDeck(de()); else if (k !== "vocab" && deck === de()) setDeck("Medicine::Inbox"); }}>{l}</button>)}</div>
      <div className={full ? "editor-cols" : ""}><div>
        {kind === "cloze" && <>
          <div className="field"><label>Text</label><textarea ref={area} className="typeans" rows={4} aria-label="Cloze text" placeholder="Hyperkalaemia: give {{c1::calcium gluconate}} first to stabilise the membrane" value={text} onChange={(e) => { setText(e.target.value); setGapHint(false); }} /></div>
          <div className="row" style={{ gap: 8, margin: "-4px 0 8px" }}><button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={gap}>Make gap</button><span className={"small" + (gapHint ? " ed-hint" : " muted")} role="status">{gapHint ? "Select the words to hide first, then tap Make gap" : clozeCount(text) ? `${clozeCount(text)} card${clozeCount(text) === 1 ? "" : "s"}` : "Select words, then Make gap"}</span></div>
          {field("Extra (shown on the back)", extra, setExtra, { area: true })}
        </>}
        {kind === "basic" && <>{field("Front", front, setFront, { area: true })}{field("Back", back, setBack, { area: true })}</>}
        {kind === "mcq" && <>
          {field("Question", question, setQuestion, { area: true, ph: "A 54-year-old man… What is the next step?" })}
          <div className="field"><label>Options <span className="muted small">tap the letter of the right one</span></label>
            {opts.map((o, i) => <div key={i} style={{ marginBottom: 6 }}>
              <div className="row" style={{ gap: 6 }}><button className={"chip mcq-pick" + (right === i ? " orange" : "")} aria-label={`Option ${String.fromCharCode(65 + i)} is right`} aria-pressed={right === i} onClick={() => setRight(i)}>{right === i ? "✓" : String.fromCharCode(65 + i)}</button>
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
            <FileButton label={audio ? "Change recording" : "Add a recording"} inputLabel="Recording" accept="audio/*" capture onFile={async (f) => setAudio(await readFile(f))} />
            <span className="muted">{audio ? "Recording attached" : "Without one, the device says the word in German"}</span>
          </div>
        </>}
        {full && kind !== "vocab" && <div className="row small" style={{ gap: 8, alignItems: "center", margin: "4px 0 8px" }}>
          <FileButton label={image ? "Change picture" : "Add a picture"} inputLabel="Picture" accept="image/*" onFile={async (f) => setImage(await shrinkImage(f, 1200))} />
          {image && <><img src={image} alt="" style={{ height: 40, borderRadius: 4 }} /><button className="btn" onClick={() => setImage("")}>Remove</button></>}
        </div>}
        <div className="field"><label>Deck</label><input list="yuzu-decks" aria-label="Deck" autoCapitalize="none" value={deck} onChange={(e) => setDeck(e.target.value)} /><datalist id="yuzu-decks">{decks.map((d) => <option key={d} value={d} />)}</datalist></div>
        {full && <>{field("Tags (space or comma)", tags, setTags)}{field("Source", source, setSource, { ph: "ERC 2025, UpToDate 2026…" })}
          {(tags.trim() || source.trim()) && <div className="ed-kept small muted"><span className="grow">Tags and source stay for the next card (cleared when you switch to or from Vocab).</span><button className="chip" onClick={() => { setTags(""); setSource(""); }}>Clear tags and source</button></div>}
          <label className="row small muted" style={{ margin: "6px 0" }}><input type="checkbox" checked={keep} onChange={(e) => { setKeep(e.target.checked); remember("yuzu-edit-keep", e.target.checked ? "1" : "0"); }} data-testid="ed-keep" /> Also keep the extra text and the picture for the next card</label></>}
        {similar && <div className="ed-similar small" role="status"><span className="grow">Saved — but it looks like a card you already have.</span>{onSimilar && <button className="chip orange" onClick={onSimilar}>Review the pair</button>}<button className="icon-btn" aria-label="Dismiss" onClick={() => setSimilar(false)}><IconClose /></button></div>}
      </div>
      {full && <div className="editor-preview">
        <div className="row" style={{ gap: 6, alignItems: "center" }}><b className="small grow">Preview</b>
          {preview && preview.ords.length > 1 && preview.ords.map((o, i) => <button key={o} className={"chip" + (o === preview.ord ? " orange" : "")} onClick={() => setOrd(o)}>Card {i + 1}</button>)}
          <div className="seg" style={{ margin: 0 }}><button className={side === "front" ? "on" : ""} aria-pressed={side === "front"} onClick={() => setSide("front")}>Front</button><button className={side === "back" ? "on" : ""} aria-pressed={side === "back"} onClick={() => setSide("back")}>Back</button></div></div>
        {preview ? <div className={"paper" + (store.settings.nightCards ? " slate" : "")} style={{ marginTop: 8 }}><CardView html={side === "front" ? preview.front : preview.back} css={preview.css} dark={store.settings.nightCards} side={side} /></div> : <p className="small muted">The card shows here once it has what it needs{kind === "cloze" ? " (at least one gap)" : ""}.</p>}
      </div>}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="btn" onClick={() => clear()}>Clear</button>
        <button className="btn primary grow" disabled={!ready || busy} onClick={save}>{busy ? "Saving…" : "Save card"}</button>
      </div>
    </Sheet>
  );
}

/** The full editor opened on a card that already exists (Library → card → Edit): every field of its note, tags and deck,
 *  with the same live preview. Saving keeps the review history; a new cloze number gets a new card. */
export function NoteEditor({ card, onClose, onTag }: { card: Card; onClose: () => void; onTag?: (tag: string) => void }) {
  useBack(true, onClose);
  const note0 = store.noteFor(card); const nt = note0 && store.notetypeFor(note0);
  const [fields, setFields] = useState(() => note0?.fields ?? []);
  const [tags, setTags] = useState(() => (note0?.tags ?? []).filter((t) => !t.startsWith("auto::")).join(" "));
  const [deck, setDeck] = useState(card.source);
  const [side, setSide] = useState<"front" | "back">("back"); const [ord, setOrd] = useState(card.ord); const [busy, setBusy] = useState(false); const [gapHint, setGapHint] = useState(-1);
  const areas = useRef<(HTMLTextAreaElement | null)[]>([]);
  const decks = useMemo(() => store.tree("decks").children.flatMap((c) => [c.path, ...c.children.map((g) => g.path)]), []);
  const cloze = nt?.kind === "cloze";
  const preview = useMemo(() => {
    if (!note0 || !nt) return null;
    const have = store.cardsOfNote(note0.id).map((c) => c.ord);
    const ords = cloze ? [...new Set([...have, ...clozeNumbers(fields.join(" ")).map((n) => n - 1)])].sort((a, b) => a - b) : have.sort((a, b) => a - b);
    const o = ords.includes(ord) ? ord : ords[0] ?? 0;
    try { const out = renderCard({ note: { ...note0, fields }, notetype: nt, ord: o, deck, resolveMedia: store.mediaUrl }); return { ...out, ords, ord: o }; } catch { return null; }
  }, [fields, ord, deck]);
  if (!note0 || !nt) return null;
  const gap = (i: number) => {
    const el = areas.current[i]; if (!el) return; const r = wrapGap(fields[i] ?? "", el.selectionStart, el.selectionEnd);
    if (!r) { setGapHint(i); el.focus(); return; }
    setGapHint(-1); setFields(fields.map((f, j) => (j === i ? r.text : f))); requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.a, r.b); });
  };
  const changed = fields.some((f, i) => f !== note0.fields[i]) || tags.trim() !== note0.tags.filter((t) => !t.startsWith("auto::")).join(" ") || deck.trim() !== card.source;
  const save = async () => {
    setBusy(true);
    try {
      await store.updateNote(note0.id, fields, tags.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean));
      const added = cloze ? await store.addClozeCards(note0.id) : 0;
      const to = deck.trim().replace(/\s*::\s*/g, "::"); if (to && to !== card.source) await store.bulk(store.cardsOfNote(note0.id).map((c) => c.id), { source: to });
      snackbar(added ? `Saved — ${added} new card${added === 1 ? "" : "s"} for the new gap${added === 1 ? "" : "s"}` : "Saved"); onClose();
    } catch (e: any) { snackbar(e?.message ?? String(e)); } finally { setBusy(false); }
  };
  const userTags = tags.split(/[,\s]+/).filter(Boolean);
  return (
    <div className="sheet-backdrop" onClick={onClose}><div className="sheet sheet-wide" role="dialog" aria-label="Edit card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "94vh", overflow: "auto" }}>
      <div className="row"><b className="grow">Edit card</b><span className="chip">{nt.name}</span><button className="icon-btn" aria-label="Close editor" onClick={onClose}><IconClose /></button></div>
      <p className="small muted" style={{ margin: "4px 0 0" }}>Changes keep the review history{cloze ? "; a new gap number becomes a new card" : ""}.</p>
      <div className="editor-cols"><div>
        {nt.fields.map((name, i) => <div key={name + i}>
          <div className="field"><label>{name}</label><textarea ref={(el) => { areas.current[i] = el; }} className="typeans" rows={i === 0 ? 4 : 2} aria-label={name} value={fields[i] ?? ""} onChange={(e) => { const f = [...fields]; f[i] = e.target.value; setFields(f); if (gapHint === i) setGapHint(-1); }} /></div>
          {cloze && i === 0 && <div className="row" style={{ gap: 8, margin: "-4px 0 8px" }}><button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => gap(i)}>Make gap</button><span className={"small" + (gapHint === i ? " ed-hint" : " muted")} role="status">{gapHint === i ? "Select the words to hide first, then tap Make gap" : `${clozeCount(fields[i] ?? "")} gap${clozeCount(fields[i] ?? "") === 1 ? "" : "s"}`}</span></div>}
        </div>)}
        <div className="field"><label>Deck (all cards of this note)</label><input list="yuzu-decks-edit" aria-label="Deck" autoCapitalize="none" value={deck} onChange={(e) => setDeck(e.target.value)} /><datalist id="yuzu-decks-edit">{decks.map((d) => <option key={d} value={d} />)}</datalist></div>
        <div className="field"><label>Tags (space or comma)</label><input aria-label="Tags" autoCapitalize="none" value={tags} onChange={(e) => setTags(e.target.value)} /></div>
        {onTag && userTags.length > 0 && <div className="row small" style={{ flexWrap: "wrap", gap: 6, margin: "-4px 0 8px" }}><span className="muted">Browse:</span>{userTags.map((t) => <button key={t} className="chip" title="Show the cards with this tag" onClick={() => onTag(t)}>{t}</button>)}</div>}
      </div>
      <div className="editor-preview">
        <div className="row" style={{ gap: 6, alignItems: "center" }}><b className="small grow">Preview</b>
          {preview && preview.ords.length > 1 && preview.ords.map((o, i) => <button key={o} className={"chip" + (o === preview.ord ? " orange" : "")} onClick={() => setOrd(o)}>Card {i + 1}</button>)}
          <div className="seg" style={{ margin: 0 }}><button className={side === "front" ? "on" : ""} onClick={() => setSide("front")}>Front</button><button className={side === "back" ? "on" : ""} onClick={() => setSide("back")}>Back</button></div></div>
        {preview ? <div className={"paper" + (store.settings.nightCards ? " slate" : "")} style={{ marginTop: 8 }}><CardView html={side === "front" ? preview.front : preview.back} css={preview.css} dark={store.settings.nightCards} side={side} autoplay={false} /></div> : <p className="small muted">This card can't be previewed.</p>}
      </div>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary grow" disabled={!changed || busy || !fields[0]?.trim()} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
      </div>
    </div></div>
  );
}
