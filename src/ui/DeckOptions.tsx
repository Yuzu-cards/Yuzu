// Deck options (1.9.0): what one deck does differently. Each option set here holds for this deck and every deck under it,
// unless a deeper deck sets it too; an option set higher up shows where it comes from.
import { useSyncExternalStore } from "react";
import { store } from "../lib/store";
import { langFromPath, type DeckOpts, type OptKey } from "../lib/deckopts";
import { fmtDate } from "../lib/dates";
import { canSpeak } from "../lib/voice";
import { Sheet, snackbar } from "./kit";

const LANGS: [string, string][] = [["de-DE", "German"], ["en-GB", "English"], ["fr-FR", "French"], ["es-ES", "Spanish"], ["it-IT", "Italian"], ["ar-SA", "Arabic"], ["nl-NL", "Dutch"], ["pt-PT", "Portuguese"], ["tr-TR", "Turkish"]];
const langName = (tag: string | null | undefined) => (tag ? LANGS.find(([t]) => t === tag)?.[1] ?? tag : "none");

export function DeckOptions({ path, onClose }: { path: string; onClose: () => void }) {
  useSyncExternalStore(store.subscribe, () => store.getVersion(), () => store.getVersion());
  const name = path.split("::").pop() ?? path;
  const own = (store.settings.deckOpts?.[path] ?? {}) as DeckOpts;
  const { opts, at } = store.optsFor(path);
  const set = (patch: Partial<Record<keyof DeckOpts, unknown>>) => { void store.setDeckOpts(path, patch); };
  /** "set on Languages › German" for an option that comes from a deck above this one; a reset for one set here. */
  const from = (k: OptKey) => at[k] && at[k] !== path
    ? <span className="from">from {at[k]!.split("::").slice(-2).join(" › ")}</span>
    : own[k] !== undefined ? <button className="link-btn from" title="Take this from the deck above (or the usual)" onClick={(e) => { e.preventDefault(); set({ [k]: undefined }); }}>reset</button> : null;
  const lang = store.langFor(path); const auto = langFromPath(path);
  const fields = opts.ordered ? store.deckFields(at.ordered ?? path) : [];
  const style = store.styleFor(path); const look = store.lookFor(path);
  const line = opts.ordered ? store.lineProgress(at.ordered ?? path) : null;
  const cap = opts.newPerDay; const capLeft = cap !== undefined && at.newPerDay ? Math.max(0, store.capsLeft().get(at.newPerDay) ?? cap) : null;
  return (
    <Sheet title={`Deck options: ${name}`} onClose={onClose} className="deck-opts">
      <p className="small muted" style={{ marginTop: 2 }}>For {path.replace(/::/g, " › ")} and every deck inside it. A deck inside it can set its own.</p>
      {line && <div className="card-box progress-line small" data-testid="line-progress">
        {line.next ? <>Next new line: <b>{line.next.toLocaleString()}</b> of {line.total.toLocaleString()}</> : <>Every line started ({line.total.toLocaleString()})</>} · {line.started.toLocaleString()} started
        <div className="progress" style={{ marginTop: 6 }}><i style={{ width: `${line.total ? (line.started / line.total) * 100 : 0}%` }} /></div>
      </div>}

      <label className="opt-row"><input type="checkbox" checked={!!opts.ordered} onChange={(e) => set({ ordered: e.target.checked })} data-testid="opt-ordered" />
        <span className="grow"><b>Strict order for new cards</b>{from("ordered")}<div className="small muted">New cards come line by line in the deck's own order (a pack's line numbers, else the order the author made them), never taking turns between its subdecks. Reviews are unchanged.</div></span></label>
      {opts.ordered && <>
        <div className="opt-row sub-row"><span className="grow"><b>Order</b>{from("orderBy")}<div className="small muted">{(opts.orderBy ?? "line") === "line" ? "By line, across the whole deck." : opts.orderBy === "field" ? `By the number in a field${opts.orderField ? ` (“${opts.orderField}”)` : ""} — for decks that number their notes; notes without one come after.` : "Subdeck by subdeck in name order (Kapitel 2 before Kapitel 10), line by line inside each — like Anki's deck order."}</div></span>
          <div className="seg" role="radiogroup" aria-label="Order">{([["line", "By line"], ["subdeck", "By subdeck"], ["field", "By a field"]] as const).map(([k, l]) => <button key={String(k)} role="radio" aria-checked={(opts.orderBy ?? "line") === k} className={(opts.orderBy ?? "line") === k ? "on" : ""} disabled={false} onClick={() => set(k === "field" && !opts.orderField ? { orderBy: k, orderField: fields.find((f) => /^(nr|no|number|nummer|index|sort|order|id|#)$/i.test(f)) ?? fields[0] } : { orderBy: k })} data-testid={"opt-orderBy-" + k}>{l}</button>)}</div></div>
        {opts.orderBy === "field" && <div className="opt-row sub-row"><span className="grow"><b>The field</b>{from("orderField")}</span>
          <select aria-label="Order by this field" value={opts.orderField ?? ""} onChange={(e) => set({ orderField: e.target.value || undefined })} data-testid="opt-orderField">{fields.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>}
        <label className="opt-row sub-row"><input type="checkbox" checked={opts.lineNo !== false} onChange={(e) => set({ lineNo: e.target.checked })} data-testid="opt-lineno" />
          <span className="grow"><b>Show “line N of M” above the card</b>{from("lineNo")}</span></label>
      </>}

      <div className="opt-row"><span className="grow"><b>New cards a day from this deck</b>{from("newPerDay")}<div className="small muted">{cap === undefined ? `No limit of its own (the overall ${store.settings.newPerDay} a day applies)` : `At most ${cap}, inside the overall ${store.settings.newPerDay}${capLeft !== null ? ` · ${capLeft} left today` : ""}`}</div></span>
        <input className="num-in" type="number" min={0} max={999} inputMode="numeric" aria-label="New cards a day from this deck" placeholder="none" value={own.newPerDay ?? ""} onChange={(e) => { const v = e.target.value.trim(); set({ newPerDay: v === "" ? undefined : Math.max(0, Math.min(999, Math.round(Number(v) || 0))) }); }} data-testid="opt-cap" /></div>
      <label className="opt-row sub-row"><input type="checkbox" checked={!!opts.priority} onChange={(e) => set({ priority: e.target.checked || undefined })} data-testid="opt-priority" />
        <span className="grow"><b>Its new cards first</b>{from("priority")}<div className="small muted">Each day this deck gets its new cards (up to its own limit) before the other decks take turns — so a story capped at 10 really gets 10.</div></span></label>

      <label className="opt-row"><input type="checkbox" checked={!!opts.prevLine} onChange={(e) => set({ prevLine: e.target.checked })} data-testid="opt-prev" />
        <span className="grow"><b>Show the previous line above each card</b>{from("prevLine")}<div className="small muted">The line before this one, in the deck's order, so a story reads on. {opts.ordered ? "" : "Best with strict order on."}</div></span></label>
      {opts.prevLine && <div className="opt-row sub-row"><span className="grow"><b>How many lines before</b>{from("prevLines")}</span>
        <div className="seg" role="radiogroup" aria-label="How many lines before">{([[1, "1"], [2, "2"], [3, "3"]] as const).map(([k, l]) => <button key={String(k)} role="radio" aria-checked={(opts.prevLines ?? 1) === k} className={(opts.prevLines ?? 1) === k ? "on" : ""} disabled={false} onClick={() => set({ prevLines: k })} data-testid={"opt-prevLines-" + k}>{l}</button>)}</div></div>}

      <div className="opt-row"><span className="grow"><b>Language</b>{from("lang")}<div className="small muted">For reading lines aloud and word meanings. {opts.lang === undefined ? (auto ? `Found from the deck's name: ${langName(auto)}.` : "Not a language deck by its name.") : ""}</div></span>
        <select aria-label="Language" value={opts.lang ?? ""} onChange={(e) => set({ lang: e.target.value || undefined })} data-testid="opt-lang">
          <option value="">{auto ? `Automatic (${langName(auto)})` : "Automatic (none)"}</option>
          {LANGS.map(([t, n]) => <option key={t} value={t}>{n}</option>)}
          <option value="off">Not a language deck</option>
        </select></div>

      <div className="opt-row"><span className="grow"><b>Read the line aloud</b>{from("readAloud")}<div className="small muted">{!lang ? "Needs a language." : !canSpeak() ? "This browser can't read aloud." : `In ${langName(lang)}, with the device's voice. A Read button on the back (or key L; again: slower), or every time you flip.`}</div></span>
        <div className="seg" role="radiogroup" aria-label="Read the line aloud">{([["button", "Button"], ["auto", "Every flip"], ["off", "Off"]] as const).map(([k, l]) => <button key={k} role="radio" aria-checked={(opts.readAloud ?? "button") === k} className={(opts.readAloud ?? "button") === k ? "on" : ""} disabled={!lang} onClick={() => set({ readAloud: k })}>{l}</button>)}</div></div>

      {!!lang && (opts.readAloud ?? "button") !== "off" && <div className="opt-row sub-row"><span className="grow"><b>Reading pace</b>{from("readPace")}<div className="small muted">{(opts.readPace ?? "normal") === "slow" ? "Slow from the first tap (a learner's pace)." : "Normal; tap again for slower."}</div></span>
        <div className="seg" role="radiogroup" aria-label="Reading pace">{([["normal", "Normal"], ["slow", "Slow"]] as const).map(([k, l]) => <button key={String(k)} role="radio" aria-checked={(opts.readPace ?? "normal") === k} className={(opts.readPace ?? "normal") === k ? "on" : ""} disabled={false} onClick={() => set({ readPace: k })} data-testid={"opt-readPace-" + k}>{l}</button>)}</div></div>}
      <label className="opt-row"><input type="checkbox" checked={!!lang && opts.sayIt !== false} disabled={!lang} onChange={(e) => set({ sayIt: e.target.checked ? undefined : false })} data-testid="opt-sayit" />
        <span className="grow"><b>“Say it” on the back</b>{from("sayIt")}<div className="small muted">Record yourself saying the line, then hear yours and the model one after the other. Nothing is kept.</div></span></label>
      <label className="opt-row"><input type="checkbox" checked={!!lang && opts.tapWord !== false} disabled={!lang} onChange={(e) => set({ tapWord: e.target.checked })} data-testid="opt-tap" />
        <span className="grow"><b>Tap a word on the back for its meaning</b>{from("tapWord")}<div className="small muted">From your own vocab cards in any deck. Holding a word still opens the full word menu.</div></span></label>

      <div className="opt-row"><span className="grow"><b>Look</b>{from("look")}<div className="small muted">{look.own ? (style ? `Its own look${style.style.from ? ` (from ${style.style.from}, ${fmtDate(style.style.at)})` : ""}.` : "Its note types' own CSS, without the Yuzu reading style.") : `The Yuzu reading style, like every deck.${style ? " It has a look of its own you can switch to." : ""}`}{opts.look === undefined ? ` Unset: this device's Look setting (${store.settings.cardStyle === "deck" ? "decks' own" : "Yuzu"}).` : ""}</div></span>
        <div className="seg" role="radiogroup" aria-label="Look">{([["yuzu", "Yuzu"], ["own", "Its own"]] as const).map(([k, l]) => <button key={k} role="radio" aria-checked={look.own === (k === "own")} className={look.own === (k === "own") ? "on" : ""} onClick={() => set({ look: k })} data-testid={"opt-look-" + k}>{l}</button>)}</div></div>
      {!look.own && <label className="opt-row sub-row"><input type="checkbox" checked={opts.art !== false} disabled={store.settings.cardArt === "off"} onChange={(e) => set({ art: e.target.checked ? undefined : false })} data-testid="opt-art" />
        <span className="grow"><b>Subject design on these cards</b>{from("art")}<div className="small muted">{store.settings.cardArt === "off" ? "Off on this device (Settings → Look)." : "The body system's drawing in the margin (Settings → Look → Subject designs)."}</div></span></label>}
      {style && style.at === path && <button className="btn block" style={{ marginTop: 6 }} onClick={async () => { await store.saveSettings({ deckStyles: { ...(store.settings.deckStyles ?? {}), [path]: null } }); snackbar("The deck's own look was removed"); }}>Remove the deck's own look</button>}

      {Object.keys(own).length > 0 && <button className="btn block" style={{ marginTop: 10 }} onClick={() => { void store.setDeckOpts(path, Object.fromEntries(Object.keys(own).map((k) => [k, undefined]))); snackbar(`${name}: back to the usual options`); }}>Clear this deck's own options</button>}
    </Sheet>
  );
}
