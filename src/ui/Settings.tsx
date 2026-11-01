import { useMemo, useRef, useState } from "react";
import { fmtDate, fmtDateTime, fmtTime } from "../lib/dates";
import { store } from "../lib/store";
import { ImproveSection } from "./Improve";
import { Slider, snackbar } from "./kit";
import { retentionTradeoff } from "../scheduler/optimize";
import { importAnki } from "../import/anki";
import { inflateRaw, zstd } from "../lib/decompress";
import { getMeta } from "../lib/db";
import { useEffect } from "react";
import { GitHubSync } from "../lib/sync";
import { repairApp } from "./App";
import { noteTitle } from "../lib/render";
import { THEMES, sfx } from "./sfx";
import { holdAwake } from "../lib/wake";
import { ZipFile } from "../lib/zipfile";

declare const __VERSION__: string;

export function Settings({ onInbox }: { onInbox?: () => void } = {}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef<AbortController | null>(null);
  const [mediaMsg, setMediaMsg] = useState("");
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaFrac, setMediaFrac] = useState(0);
  const [quota, setQuota] = useState<{ used: number; free: number; persisted: boolean } | null>(null);
  useEffect(() => { (async () => { try { const e = await navigator.storage?.estimate?.(); const p = (await navigator.storage?.persisted?.()) ?? false; if (e) setQuota({ used: e.usage ?? 0, free: Math.max(0, (e.quota ?? 0) - (e.usage ?? 0)), persisted: p }); } catch { /* not available */ } })(); }, [mediaBusy]);
  async function onMedia(input: File | File[] | { handles: Map<string, { getFile(): Promise<File> }> }) {
    setBusy(true); setMediaBusy(true); setMediaMsg(""); setMediaFrac(0); stopRef.current = new AbortController();
    try {
      const r = await holdAwake(() => store.addMediaFrom(input, { inflateRaw, zstd, signal: stopRef.current!.signal, onProgress: (m, f) => { setMediaMsg(m); if (f !== undefined) setMediaFrac(f); } }));
      const parts = [r.images && `${r.images.toLocaleString()} images`, r.sounds && `${r.sounds.toLocaleString()} sounds`, r.other && `${r.other.toLocaleString()} template file${r.other === 1 ? "" : "s"}`].filter(Boolean).join(", ");
      setMediaMsg((r.stopped ? "Stopped — run it again with the same file to continue. " : "") + (r.stored ? `Added ${parts} (${(r.bytes / 1048576).toFixed(0)} MB).` : "Nothing new to add.") + (r.already ? ` ${r.already.toLocaleString()} were already here.` : "") + (r.missing ? ` ${r.missing.toLocaleString()} your cards use are not in ${input instanceof Blob ? "this file" : "this folder"}.` : "") + (r.failed ? ` ${r.failed} could not be read.` : ""));
    } catch (e: any) { setMediaMsg("Failed: " + (e?.message ?? e)); }
    finally { setBusy(false); setMediaBusy(false); stopRef.current = null; if (mediaRef.current) mediaRef.current.value = ""; if (folderRef.current) folderRef.current.value = ""; }
  }
  async function hasMedia(file: Blob) { try { const z = new ZipFile(file, inflateRaw); const l = await z.list(); return l.length > 3 && l.some((e) => e.name === "media"); } catch { return false; } }
  // Folder access is for the PC: phones (touch screens) can't reach Anki's media folder even if the browser offers a picker.
  const canPickDir = typeof (window as any).showDirectoryPicker === "function" && !window.matchMedia?.("(pointer: coarse)").matches;
  const [ankiDir, setAnkiDir] = useState<{ name: string; handles: Map<string, { getFile(): Promise<File> }> } | null>(null);
  /** Open a folder with the File System Access API (PC Chrome/Edge): files are opened fresh when read. */
  async function pickAnkiFolder(): Promise<typeof ankiDir> {
    let dir: any; try { dir = await (window as any).showDirectoryPicker({ id: "anki-media", mode: "read" }); } catch (e: any) { if (e?.name !== "AbortError") setMediaMsg("Failed: " + (e?.message ?? e)); return null; }
    setBusy(true); setMediaBusy(true); setMediaMsg(`Reading “${dir.name}”`); setMediaFrac(0);
    try {
      const handles = new Map<string, { getFile(): Promise<File> }>(); let n = 0;
      for await (const [name, h] of dir.entries()) { if (h.kind === "file") handles.set(name, h); if (++n % 2000 === 0) setMediaMsg(`Reading “${dir.name}” · ${n.toLocaleString()} files`); }
      const got = { name: dir.name as string, handles }; setAnkiDir(got); await store.linkAnkiFolder(dir); return got;
    } finally { setBusy(false); setMediaBusy(false); }
  }
  async function onChooseFolder() {
    if (!canPickDir) { folderRef.current?.click(); return; }
    const d = await pickAnkiFolder(); if (d) await onMedia(d);
  }
  async function onPhoneFileFromFolder() {
    const src = ankiDir; if (!src) return;
    let dest: any; try { dest = await (window as any).showDirectoryPicker({ id: "yuzu-media", mode: "readwrite", startIn: "downloads" }); } catch (e: any) { if (e?.name !== "AbortError") setMediaMsg("Failed: " + (e?.message ?? e)); return; }
    setBusy(true); setMediaBusy(true); setMediaMsg("Starting"); setMediaFrac(0); stopRef.current = new AbortController();
    try {
      const r = await holdAwake(() => store.mediaFileFromFolder(src, dest, { inflateRaw, zstd, signal: stopRef.current!.signal, onProgress: (m, f) => { setMediaMsg(m); if (f !== undefined) setMediaFrac(f); } }));
      const list = r.parts.map((p) => `${p.name} (${(p.size / 1048576).toFixed(0)} MB, ${p.files.toLocaleString()} files)`).join(", ");
      setMediaMsg((r.stopped ? "Stopped early — the file holds what was done so far. " : "") + (r.parts.length ? `Saved ${list} in “${dest.name}”. On the phone press “Choose file” and pick ${r.parts.length > 1 ? "each one" : "it"}.` : "Nothing to save.") + (r.missing ? ` ${r.missing.toLocaleString()} files your cards use aren't in “${src.name}”.` : "") + (r.failed ? ` ${r.failed.toLocaleString()} couldn't be read.` : ""));
    } catch (e: any) { setMediaMsg("Failed: " + (e?.message ?? e)); }
    finally { setBusy(false); setMediaBusy(false); stopRef.current = null; }
  }
  async function onCheckMedia() {
    setBusy(true); setMediaBusy(true); setMediaMsg("Checking stored files");
    try {
      const r = await holdAwake(() => store.checkMedia((m) => setMediaMsg(m)));
      if (!r.unreadable.length) { setMediaMsg(`All ${r.checked.toLocaleString()} stored files read fine.`); return; }
      const why = Object.entries(r.errors).map(([k, v]) => `${k} ×${v.toLocaleString()}`).join(", ");
      const msg = `${r.unreadable.length.toLocaleString()} of ${r.checked.toLocaleString()} stored files can no longer be read by the browser (${why}). They show as broken on cards. Forget them so “Choose media folder” (or “Choose file”) adds them again?`;
      if (confirm(msg)) { await store.dropMedia(r.unreadable); setMediaMsg(`Forgot ${r.unreadable.length.toLocaleString()} unreadable file${r.unreadable.length === 1 ? "" : "s"}. Now press “Choose media folder” and pick Anki's collection.media to add them again.`); }
      else setMediaMsg(`${r.unreadable.length.toLocaleString()} stored files can't be read (${why}). Nothing was changed.`);
    } catch (e: any) { setMediaMsg("Failed: " + (e?.message ?? e)); }
    finally { setBusy(false); setMediaBusy(false); }
  }
  async function onExportMedia() {
    // On a PC (Chrome/Edge) pick a folder once and every part is written straight into it — no giant downloads.
    let dir: any = null; const pick = (window as any).showDirectoryPicker;
    if (pick) { try { dir = await pick({ id: "yuzu-media", mode: "readwrite", startIn: "downloads" }); } catch (e: any) { if (e?.name === "AbortError") return; dir = null; } }
    setBusy(true); setMediaBusy(true); setMediaMsg(dir ? `Saving into “${dir.name}”` : "Packing"); setMediaFrac(0);
    try {
      const { files, skipped } = await holdAwake(() => store.exportMedia((m) => setMediaMsg(m), dir));
      // Phones: one download per tap (Chrome blocks a burst of downloads from one tap).
      if (!dir && files.length) { downloadBlob(files[0].blob!, files[0].name); setDlParts(files.length > 1 ? files.slice(1).map((f) => ({ name: f.name, blob: f.blob! })) : []); }
      const list = files.map((f) => `${f.name} (${(f.size / 1048576).toFixed(0)} MB)`).join(", ");
      setMediaMsg(files.length ? `Saved ${list}${dir ? ` in “${dir.name}”` : ""}. On the other device choose ${files.length > 1 ? "each file" : "it"} with “Choose file”.` + (skipped.length ? ` ${skipped.length.toLocaleString()} file${skipped.length === 1 ? "" : "s"} couldn't be read by the browser and ${skipped.length === 1 ? "was" : "were"} left out of the media file (nothing was deleted). “Check stored files” below can repair them.` : "") : "No media on this device yet.");
    } catch (e: any) { setMediaMsg("Failed: " + (e?.message ?? e)); }
    finally { setBusy(false); setMediaBusy(false); }
  }
  const [busy, setBusy] = useState(false);
  const [dlParts, setDlParts] = useState<{ name: string; blob: Blob }[]>([]);
  const [msg, setMsg] = useState("");
  const [frac, setFrac] = useState(0);
  const [result, setResult] = useState<string>("");
  const [last, setLast] = useState<{ at: number; summary: any } | null>(null);
  const [skipLanguages, setSkipLanguages] = useState(false);
  const s = store.settings;
  const [syncMsg, setSyncMsg] = useState("");
  const [fitMsg, setFitMsg] = useState("");
  const [revMsg, setRevMsg] = useState("");
  const [scan, setScan] = useState(0); // bump to rescan the collection-wide numbers below
  const reversible = useMemo(() => store.reversibleNotetypes(), [scan, revMsg]);
  const revOn = useMemo(() => new Map(reversible.map(({ nt, on }) => [nt.id, on && !store.cardsOfNoteType(nt.id, 1).every((c) => c.suspended)])), [reversible]);
  const v = store.getVersion();
  const mediaStat = useMemo(() => store.mediaStatus(), [scan, v, mediaBusy, result]); // not on every progress message: that rescans 78k files
  const [showToken, setShowToken] = useState(false);
  const sy = s.sync;
  const setSync = (patch: Partial<typeof sy>) => store.saveSettings({ sync: { ...sy, ...patch } });

  useEffect(() => { getMeta<{ at: number; summary: any } | null>("lastImport", null).then(setLast); }, [result]);
  // Closing the tab halfway through an import would leave it half applied: warn first.
  useEffect(() => {
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [busy]);

  async function onFile(file: File) {
    setBusy(true); setResult(""); setFrac(0);
    try {
      setMsg("Reading file");
      if (/\.json$/i.test(file.name)) {
        const text = await file.text(); const json = JSON.parse(text);
        if (json?.yuzu_curation === 1) { setMsg("Applying curation"); setResult(await store.importCuration(json, (m, f) => { setMsg(m); setFrac(f); })); return; }
        setResult(await store.importPack(json));
        return;
      }
      const res = await importAnki(file, {
        inflateRaw, zstd,
        onProgress: (m, f) => { setMsg(m); if (f !== undefined) setFrac(f); },
      }, { skipDeckPrefixes: skipLanguages ? ["Languages"] : [] });
      const merged = await store.applyImport(res, (m, f) => { setMsg(m); setFrac(f); });
      setResult(`Imported ${res.summary.notes.toLocaleString()} notes, ${res.summary.cards.toLocaleString()} cards and ${res.summary.reviews.toLocaleString()} reviews (${merged.newCards.toLocaleString()} new cards${merged.organized ? `, ${merged.organized.toLocaleString()} placed in your categories` : ""}, ${merged.updated.toLocaleString()} notes updated from Anki). ${res.summary.media ? `${res.summary.media.toLocaleString()} images and sounds referenced.` : ""}`);
      // The same file may carry the media: continue straight into adding it.
      if (res.summary.media && await hasMedia(file)) { setBusy(false); await onMedia(file); }
    } catch (e: any) {
      setResult("Import failed: " + (e?.message ?? String(e)));
    } finally { setBusy(false); setMsg(""); if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <div className="screen">
      <h1>Settings</h1>
      <details className="section" open><summary>Look and sound <span className="small muted">on this device</span></summary>
        <div className="card-box">
          <div className="themes">{THEMES.map((t) => <button key={t.id} className={s.theme === t.id ? "on" : ""} onClick={() => { store.saveSettings({ theme: t.id }); sfx.tap(); }}><span className="sw">{t.sw.map((c) => <i key={c} style={{ background: c }} />)}</span>{t.name}</button>)}</div>
          <label className="row small" style={{ margin: "12px 0 0" }}><input type="checkbox" checked={s.sfx} onChange={(e) => { store.saveSettings({ sfx: e.target.checked }); if (e.target.checked) setTimeout(() => sfx.answer(3), 50); }} /> Sound effects (short 8-bit blips on answers, goal and boss fights)</label>
          <div className="row" style={{ marginTop: 12, gap: 8 }}><span className="small grow">Card look</span>
            <div className="seg">{(["yuzu", "deck"] as const).map((v) => <button key={v} className={s.cardStyle === v ? "on" : ""} onClick={() => store.saveSettings({ cardStyle: v })}>{v === "yuzu" ? "Yuzu" : "Deck's own"}</button>)}</div></div>
          <p className="small muted" style={{ margin: "6px 0 0" }}>Yuzu gives every deck the same calm type, orange cloze answers and tidy extras; the deck's own look shows each Anki deck as it was designed.</p>
          <DeviceToggles />
        </div>
      </details>
      <details className="section" open><summary>Studying <span className="small muted">new cards, goal, order, scheduler</span></summary>
      <div className="card-box">
        <Slider label="New cards per day" value={s.newPerDay} min={0} max={100} step={1} onCommit={(v) => store.saveSettings({ newPerDay: v })} sub="Each new card brings about 10 reviews over its first year." />
        <Slider label="Daily review goal" value={Math.min(s.dailyGoal, 500)} min={10} max={500} step={10} onCommit={(v) => store.saveSettings({ dailyGoal: v })} />
        <Slider label="Max due cards per day" value={Math.min(s.maxReviewsPerDay, 1000)} min={0} max={1000} step={25} format={(v) => (v ? String(v) : "no limit")} onCommit={(v) => store.saveSettings({ maxReviewsPerDay: v })} sub="With a backlog, keeps each day to a size you'll actually finish. The rest waits; nothing is lost." />
        <div className="field"><label>Order of due cards</label>
          <select value={s.dueOrder} onChange={(e) => store.saveSettings({ dueOrder: e.target.value as any })}>
            <option value="forgotten">Most forgotten first (lowest recall probability)</option>
            <option value="rescue">Most likely remembered first (best for clearing a backlog)</option>
            <option value="due">By due date</option>
            <option value="shuffle">Shuffled</option>
          </select><span className="small muted">Cards are also spread across systems so neighbours differ.</span></div>
        <RetentionSlider />
        <EasyDays />
        <div className="field"><label>Scheduler weights</label>
          <div className="row"><button className="btn grow" disabled={!!store.fitting} onClick={async () => { setFitMsg("Fitting…"); setFitMsg(await store.optimizeScheduler()); }}>{store.fitting ? `Fitting… ${Math.round(store.fitting.progress * 100)}%` : "Tune to my history"}</button></div>
          <p className="small muted" style={{ marginBottom: 0 }}>{fitMsg || (s.fit ? `FSRS-6, fitted ${fmtDate(s.fit.at)} on ${s.fit.n.toLocaleString()} reviews (error ${s.fit.before.toFixed(3)} → ${s.fit.after.toFixed(3)}). Re-runs automatically every ~1000 reviews.` : "Default FSRS-6 weights. Tuning to your history runs automatically once you have ~400 spaced reviews.")}</p>
        </div>
        <label className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={s.nightCards} onChange={(e) => store.saveSettings({ nightCards: e.target.checked })} /> Slate cards (dark card paper, easier at night)</label>
        <label className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={s.swipe} onChange={(e) => store.saveSettings({ swipe: e.target.checked })} /> Swipe to rate (← Again · ↓ Hard · → Good · ↑ Easy)</label>
        <label className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={s.typeAnswers} onChange={(e) => store.saveSettings({ typeAnswers: e.target.checked })} /> Type the answer on language cards</label>
        <label className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={s.burySiblings} onChange={(e) => store.saveSettings({ burySiblings: e.target.checked })} /> Bury siblings (don't show two cards of one note in a session)</label>
        <Slider label="Offer to retire as mastered when the next review is more than" value={s.retireAskYears ?? 5} min={1} max={10} format={(v) => `${v} y`} onCommit={(v) => store.saveSettings({ retireAskYears: v, ...((s.retireAutoYears ?? 20) && (s.retireAutoYears ?? 20) <= v ? { retireAutoYears: 0 } : {}) })} sub="Those cards are listed in Progress → Mastered for you to decide." />
        <Slider label="Retire automatically when the next review is more than" value={s.retireAutoYears ?? 20} min={0} max={30} step={5} format={(v) => (v ? `${v} y` : "never")} sub={`Must be above the offer line (${s.retireAskYears ?? 5} y). Retired cards are deleted and kept in the Mastered log.`}
          onCommit={async (v) => {
            if (v && v <= (s.retireAskYears ?? 5)) { snackbar(`Has to be above ${s.retireAskYears ?? 5} years`); return false; }
            if (v) { const n = store.countBeyond(v); if (n && !confirm(`${n.toLocaleString()} card${n === 1 ? " is" : "s are"} already past ${v} years and would be retired now (deleted, kept in the Mastered log). Go ahead?`)) return false; }
            await store.saveSettings({ retireAutoYears: v }); if (v) store.autoMaster();
          }} />
        <div className="field"><label>Streak rest days per week</label>
          <select value={s.restDays} onChange={(e) => store.saveSettings({ restDays: Number(e.target.value) })}>
            {[0, 1, 2].map((h) => <option key={h} value={h}>{h}</option>)}
          </select></div>
        <div className="field"><label>New day starts at</label>
          <select value={s.rollover} onChange={(e) => store.saveSettings({ rollover: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((h) => <option key={h} value={h}>{h}:00</option>)}
          </select></div>
      </div>

      </details>
      {reversible.length > 0 && <details className="section"><summary>Language cards <span className="small muted">reverse and typed cards</span></summary>
        <div className="card-box">
          <p className="small muted" style={{ marginTop: 0 }}>Reverse cards ask the other direction (German → English as well as English → German). Turning one off suspends its reverse cards; history is kept.</p>
          {reversible.map(({ nt, notes, on }) => (
            <label key={nt.id} className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={revOn.get(nt.id) ?? false} onChange={async (e) => { setRevMsg("Working…"); const n = await store.setReverse(nt.id, e.target.checked); setRevMsg(`${n?.toLocaleString()} reverse cards ${e.target.checked ? "added" : "suspended"}.`); }} /> {nt.name} <span className="muted">· {notes.toLocaleString()} notes</span></label>
          ))}
          {revMsg && <p className="small muted" style={{ marginBottom: 0 }}>{revMsg}</p>}
        </div>
      </details>}
      <details className="section"><summary>Cards to improve <span className="small muted">send to Claude</span></summary>
      <ImproveSection />
      </details>
      <details className="section"><summary>Import from Anki <span className="small muted">collection, packs, curation</span></summary>
      <div className="card-box">
        <p className="small muted" style={{ marginTop: 0 }}>Export from Anki as a <b>collection package (.colpkg)</b> or a deck (.apkg) with scheduling included; if it includes media, the images and sounds are added right after the cards. Importing again later only adds what's new. Also accepts <b>Yuzu card packs</b> and <b>curation files</b> (.json) made by Claude: duplicates are skipped or merged, cards move to their categories, similar cards get the tag <i>needs-review::similar</i>. Large collections: import on a PC first, then sync to the phone.</p>
        <label className="row small" style={{ marginBottom: 10 }}><input type="checkbox" checked={skipLanguages} onChange={(e) => setSkipLanguages(e.target.checked)} /> Skip the Languages decks</label>
        <input ref={fileRef} type="file" accept=".colpkg,.apkg,.zip,.json" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button className="btn primary block" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Importing…" : "Choose file"}</button>
        {busy && (<><div className="bar"><i style={{ width: `${frac * 100}%` }} /></div><div className="small muted">{msg} — keep this tab open</div></>)}
        {result && <p className="small" style={{ marginBottom: 0 }}>{result}</p>}
        {last && !busy && <p className="small muted" style={{ marginBottom: 0 }}>Last import {fmtDateTime(last.at)}: {last.summary?.cards?.toLocaleString()} cards.</p>}
      </div>

      </details>
      <details className="section" open><summary>Images and sounds <span className="small muted">kept on this device</span></summary>
      <div className="card-box">
        {(() => { const m = mediaStat; const pct = m.total ? Math.round((m.stored / m.total) * 100) : 100; return (<>
          <div className="stat-grid" style={{ marginTop: 0 }}>
            <div className="stat"><b>{m.images.stored.toLocaleString()}</b><span>of {m.images.total.toLocaleString()} images</span></div>
            <div className="stat"><b>{m.sounds.stored.toLocaleString()}</b><span>of {m.sounds.total.toLocaleString()} sounds</span></div>
            <div className="stat"><b>{(m.bytes / 1048576).toFixed(0)}<small> MB</small></b><span>{quota ? `${(quota.free / 1073741824).toFixed(1)} GB free` : "used"}</span></div>
          </div>
          {!mediaBusy && <div className="bar" aria-label={`${pct}% of your cards' media is here`}><i style={{ width: `${pct}%` }} /></div>}
          <p className="small muted">{m.total === 0 ? "None of your cards use images or sounds." : m.stored === m.total ? "Everything your cards use is here." : `${(m.total - m.stored).toLocaleString()} files your cards use are not on this device yet.`}{quota && !quota.persisted && m.bytes > 0 ? " The browser may clear big libraries when space runs low; installing Yuzu to the home screen protects it." : ""}</p>
        </>); })()}
        <input ref={mediaRef} type="file" accept=".apkg,.colpkg,.zip" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && onMedia(e.target.files[0])} />
        <input ref={folderRef} type="file" multiple {...({ webkitdirectory: "", directory: "" } as any)} style={{ display: "none" }} onChange={(e) => e.target.files?.length && onMedia([...e.target.files])} />
        {mediaBusy ? (<>
          <div className="bar"><i style={{ width: `${mediaFrac * 100}%` }} /></div>
          <div className="row" style={{ marginTop: 8 }}><span className="small grow">{mediaMsg || "Working"} — keep Yuzu open; the screen stays on</span>{stopRef.current && <button className="btn" onClick={() => stopRef.current?.abort()}>Stop</button>}</div>
        </>) : (<>
          <div className="row">
            <button className="btn primary grow" disabled={busy} onClick={() => mediaRef.current?.click()}>Choose file</button>
            <button className="btn grow" disabled={busy} onClick={onChooseFolder}>Choose media folder</button>
          </div>
          {canPickDir && (
            <div className="field" style={{ marginTop: 10 }}>
              <label>Phone media file straight from Anki <span className="muted">(PC — nothing is stored in this browser)</span></label>
              <div className="row">
                <button className="btn grow" disabled={busy} onClick={pickAnkiFolder}>{ankiDir ? `1. “${ankiDir.name}” · ${ankiDir.handles.size.toLocaleString()} files` : "1. Pick Anki's media folder"}</button>
                <button className="btn primary grow" disabled={busy || !ankiDir} onClick={onPhoneFileFromFolder}>2. Save phone media file…</button>
              </div>
            </div>
          )}
          {canPickDir && <AutoSend busy={busy} />}
          {mediaMsg && <p className="small" style={{ marginBottom: 0 }}>{mediaMsg}</p>}
          {dlParts.length > 0 && <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>{dlParts.map((p) => <button key={p.name} className="btn" onClick={() => { downloadBlob(p.blob, p.name); setDlParts((x) => x.filter((y) => y.name !== p.name)); }}>Download {p.name}</button>)}</div>}
          <details className="how"><summary className="small">How to bring your Anki media in</summary>
            <ol className="small muted">
              <li><b>Phone only:</b> in AnkiDroid or Anki, export your collection as <b>.colpkg</b> with <b>“Include media”</b> ticked, then choose that file here. Big libraries take a while; you can stop and run it again — it continues where it left off.</li>
              <li><b>PC first (fastest for big libraries):</b> on the PC, under <b>Phone media file straight from Anki</b>, press <b>1</b> and pick Anki's <code>collection.media</code> folder (Anki → Tools → Check Media → View Files shows it), then <b>2</b> and pick where to save (e.g. Downloads). Copy the file(s) to the phone and choose them here — already shrunk, so they load in minutes.</li>
              <li><b>After that, nothing to do:</b> the PC remembers Anki's folder. Whenever it syncs, your phone gets the media it is missing (new cards included) with its next sync. If the browser asks again after a restart, press <b>Allow</b>.</li>
              <li><b>Study with pictures on the PC too:</b> press <b>Choose media folder</b> and pick the same folder.</li>
              <li>Only files your cards use are kept. Images are resized to phone size (usually 5–10× smaller); sounds stay as they are.</li>
            </ol>
          </details>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn grow" disabled={busy || !mediaStat.stored} onClick={onExportMedia}>Save media file</button>
            <button className="btn" disabled={busy || !mediaStat.bytes} onClick={async () => { if (confirm("Remove all deck images and sounds from this device? Cards keep working; media shows as placeholders until added again.")) { setMediaMsg(`Removed ${(await store.clearMedia()).toLocaleString()} files.`); } }}>Remove</button>
          </div>
          {mediaStat.missing.length > 0 && <MissingMedia key={mediaStat.stored} />}
          <button className="btn" style={{ marginTop: 8, width: "100%" }} disabled={busy || !mediaStat.stored} onClick={onCheckMedia}>Check stored files</button>

        </>)}
        <div className="field" style={{ marginTop: 12 }}><label>Hidden fields <span className="muted">(never shown, their pictures never kept)</span></label>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {s.hiddenFields.map((f) => <button key={f} className="chip" onClick={() => store.saveSettings({ hiddenFields: s.hiddenFields.filter((x) => x !== f) })} aria-label={`Show ${f} again`}>{f} ✕</button>)}
            <input placeholder="Add a field name" style={{ flex: "1 1 140px", minWidth: 0 }} onKeyDown={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (e.key === "Enter" && v && !s.hiddenFields.includes(v)) { store.saveSettings({ hiddenFields: [...s.hiddenFields, v] }); (e.target as HTMLInputElement).value = ""; } }} />
          </div>
          <button className="btn" style={{ marginTop: 8 }} disabled={busy || !mediaStat.bytes} onClick={async () => { const r = await store.pruneMedia(); setMediaMsg(r.files ? `Removed ${r.files.toLocaleString()} pictures no card shows (${(r.bytes / 1048576).toFixed(0)} MB freed).` : "Every stored picture is used by a card."); }}>Remove pictures no card shows</button>
        </div>
        <label className="row small" style={{ margin: "12px 0 6px" }}><input type="checkbox" checked={s.autoplay} onChange={(e) => store.saveSettings({ autoplay: e.target.checked })} /> Play card sounds automatically (tap ▶ or press R to replay)</label>
        <label className="row small" style={{ margin: "6px 0" }}><input type="checkbox" checked={s.mediaSync} onChange={(e) => store.saveSettings({ mediaSync: e.target.checked })} /> Share images between devices through the sync repository</label>
        <label className="row small" style={{ margin: "6px 0 0" }}><input type="checkbox" checked={s.mediaDownload} onChange={(e) => store.saveSettings({ mediaDownload: e.target.checked })} /> Download shared images on this device</label>
        <p className="small muted" style={{ marginBottom: 0 }}>Sharing moves 15 MB of images per sync, up to about 900 MB in total — fine for a few thousand images. For a whole library, the media file above is faster and keeps your sync repository small.</p>
      </div>

      </details>
      <details className="section"><summary>Inbox <span className="small muted">packs from Claude</span></summary>
      <div className="card-box">
        <p className="small muted" style={{ marginTop: 0 }}>Packs placed in the <b>inbox</b> folder of your sync repository arrive here on the next sync and wait for your review. {store.inbox.length ? `${store.inbox.length} waiting.` : "Nothing waiting."}{store.packLog.length ? ` ${store.packLog.length} packs added so far (removable).` : ""}</p>
        <button className="btn block" onClick={onInbox}>Open inbox</button>
      </div>

      </details>
      <details className="section" open><summary>Sync between devices</summary>
      <div className="card-box">
        <p className="small muted" style={{ marginTop: 0 }}>Uses a <b>private</b> GitHub repository, like Orange. Create one named <b>yuzu-data</b>, then a fine-grained token limited to it with <b>Contents: read and write</b>. The token stays on this device.</p>
        <div className="field"><label>GitHub username</label><input defaultValue={sy.owner} autoCapitalize="none" onBlur={(e) => setSync({ owner: e.target.value.trim() })} placeholder="Amaerys" /></div>
        <div className="field"><label>Repository</label><input defaultValue={sy.repo} autoCapitalize="none" onBlur={(e) => setSync({ repo: e.target.value.trim() })} /></div>
        <div className="field"><label>Token</label><div className="row"><input className="grow" type={showToken ? "text" : "password"} defaultValue={sy.token} autoCapitalize="none" onBlur={(e) => setSync({ token: e.target.value.trim() })} placeholder="github_pat_…" /><button className="btn" onClick={() => setShowToken(!showToken)}>{showToken ? "Hide" : "Show"}</button></div></div>
        <div className="field"><label>This device's name</label><input defaultValue={s.deviceName} onBlur={(e) => store.saveSettings({ deviceName: e.target.value })} placeholder="S25 Ultra" /></div>
        <label className="row small" style={{ margin: "8px 0" }}><input type="checkbox" checked={sy.auto} onChange={(e) => setSync({ auto: e.target.checked })} /> Sync automatically after changes</label>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" disabled={!store.syncConfigured()} onClick={async () => { setSyncMsg("Checking…"); const r = await new GitHubSync({ owner: sy.owner, repo: sy.repo, token: sy.token }).check(); setSyncMsg(r.message); }}>Test</button>
          <button className="btn primary grow" disabled={!store.syncConfigured() || store.syncStatus.state === "syncing"} onClick={() => store.sync()}>{store.syncStatus.state === "syncing" ? "Syncing…" : "Sync now"}</button>
        </div>
        <p className="small" style={{ marginBottom: 0, color: store.syncStatus.state === "error" ? "var(--again)" : undefined }}>{syncMsg || store.syncStatus.message}{store.syncStatus.at && store.syncStatus.state !== "syncing" ? ` · ${fmtTime(store.syncStatus.at)}` : ""}</p>
        {store.syncLog.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary className="small muted">Sync history</summary>
            <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {store.syncLog.map((l) => <li key={l.at} className={l.ok ? "" : "muted"}>{fmtDateTime(l.at)} · {l.ok ? "✓" : "✗"} {l.message} ({(l.ms / 1000).toFixed(1)} s)</li>)}
            </ul>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={async () => { if (confirm("Forget what has been synced and compare everything with the repository again? Nothing is deleted; the next sync re-downloads and re-uploads changed files.")) { await store.resetSyncState(); store.sync(); } }}>Re-check everything</button>
              <button className="btn" onClick={async () => { setSyncMsg("Compacting…"); setSyncMsg(await store.compactNow()); }}>Compact history</button>
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>Compacting folds the repository's history into one commit so it stays the size of your collection; Yuzu does this by itself every 300 syncs.</p>
          </details>
        )}
      </div>

      </details>
      <details className="section"><summary>Data <span className="small muted">back up, restore, wipe</span></summary>
      <div className="card-box">
        <div className="small muted">{store.notes.size.toLocaleString()} notes · {store.cards.size.toLocaleString()} cards · {store.reviews.length.toLocaleString()} reviews on this device. A quick backup holds only what cannot be rebuilt (reviews, scheduling, settings, your hooks; about 1 MB); the full one includes every card's text.</div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn grow" onClick={() => { const blob = new Blob([JSON.stringify(store.quickBackup())], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `yuzu-quick-${dmy()}.json`; try { localStorage.setItem("yuzu-last-backup", String(Date.now())); } catch { /* fine */ } a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }}>Quick backup</button>
          <button className="btn grow" onClick={() => { const blob = new Blob([JSON.stringify(store.backup())], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `yuzu-backup-${dmy()}.json`; try { localStorage.setItem("yuzu-last-backup", String(Date.now())); } catch { /* fine */ } a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }}>Full backup</button>
          <button className="btn grow" onClick={() => restoreRef.current?.click()}>Restore backup</button>
          <input ref={restoreRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const r = await store.restore(JSON.parse(await f.text())); setResult(`Restored: ${r.cards} cards, ${r.notes} notes and ${r.reviews} reviews merged.`); } catch (err: any) { setResult("Restore failed: " + err.message); } e.target.value = ""; }} />
        </div>
        <button className="btn danger block" style={{ marginTop: 10 }} onClick={async () => { if (confirm("Delete all cards and reviews from this device?")) await store.wipe(); }}>Delete everything on this device</button>
      </div>
      </details>
      <details className="section"><summary>Diagnostics <span className="small muted">storage, errors, repair</span></summary>
      <Diagnostics />
      </details>
      <p className="small muted" style={{ textAlign: "center", marginTop: 24 }}>Yuzu {__VERSION__}</p>
    </div>
  );
}

function Diagnostics() {
  const [info, setInfo] = useState<{ quota?: string; persisted?: string; lastError?: any; sw?: string }>({});
  useEffect(() => { (async () => {
    const out: typeof info = {};
    try { const e = await navigator.storage?.estimate?.(); if (e?.usage !== undefined) out.quota = `${(e.usage / 1048576).toFixed(0)} MB used${e.quota ? ` of ${(e.quota / 1048576 / 1024).toFixed(1)} GB available` : ""}`; } catch { /* unsupported */ }
    try { out.persisted = (await navigator.storage?.persisted?.()) ? "yes (browser will not evict it)" : "not guaranteed"; } catch { /* unsupported */ }
    try { out.lastError = await getMeta<any>("lastError", null); } catch { /* ignore */ }
    try { out.sw = (await navigator.serviceWorker?.getRegistration())?.active ? "active" : "none"; } catch { /* ignore */ }
    setInfo(out);
  })(); }, []);
  return (
    <div className="card-box small">
      <div>Storage: {info.quota ?? "…"} · persistent: {info.persisted ?? "…"} · offline cache: {info.sw ?? "…"}</div>
      {store.loadNotes.length > 0 && <div className="muted" style={{ marginTop: 6 }}>On load: {store.loadNotes.join("; ")}</div>}
      {info.lastError && <div className="muted" style={{ marginTop: 6 }}>Last error ({fmtDateTime(info.lastError.at)}, {info.lastError.where}): {info.lastError.message}</div>}
      <button className="btn block" style={{ marginTop: 10 }} onClick={repairApp}>Repair app (reload the latest version, keep data)</button>
    </div>
  );
}

/** The full list of files the cards use that this device doesn't have, by deck, with a CSV to check against Anki. */
function MissingMedia() {
  const [list, setList] = useState<ReturnType<typeof store.missingMedia> | null>(null);
  const byDeck = useMemo(() => { const m = new Map<string, NonNullable<typeof list>>(); for (const x of list ?? []) { const k = x.deck.split("::").slice(0, 4).join(" › ") || "(no deck)"; (m.get(k) ?? m.set(k, []).get(k)!).push(x); } return [...m].sort((a, b) => b[1].length - a[1].length); }, [list]);
  function saveCsv() {
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [["file", "type", "notes using it", "deck", "example card text", "note id"].map(q).join(","), ...(list ?? []).map((x) => [x.name, x.kind, x.notes, x.deck, x.example, x.noteId].map(q).join(","))];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + rows.join("\r\n")], { type: "text/csv" }));
    a.download = `yuzu-missing-media-${dmy()}.csv`; document.body.appendChild(a); a.click(); a.remove();
  }
  return (
    <details className="how" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !list) setTimeout(() => setList(store.missingMedia()), 30); }}>
      <summary className="small">Show what's missing</summary>
      {!list ? <p className="small muted">Looking…</p> : (<>
        <p className="small muted">{list.length.toLocaleString()} files ({list.filter((x) => x.kind === "image").length.toLocaleString()} images, {list.filter((x) => x.kind === "sound").length.toLocaleString()} sounds, {list.filter((x) => x.kind === "other").length.toLocaleString()} other). If Anki's <b>Tools → Check Media</b> lists the same names under “Missing”, they are missing in Anki too and nothing on this device can fix them.</p>
        <button className="btn" onClick={saveCsv}>Save the list (CSV)</button>
        {byDeck.map(([deck, xs]) => (
          <details key={deck} className="how" style={{ marginTop: 6 }}><summary className="small"><b>{xs.length}</b> · {deck}</summary>
            <ul className="small muted" style={{ wordBreak: "break-all" }}>{xs.slice(0, 150).map((x) => <li key={x.name}><b>{x.name}</b>{x.example ? <> — “{x.example}”</> : null}{x.notes > 1 ? ` (${x.notes} notes)` : ""}</li>)}{xs.length > 150 ? <li>… {xs.length - 150} more in the CSV</li> : null}</ul>
          </details>))}
      </>)}
    </details>
  );
}

/** PC: Anki's media folder linked once → every sync sends the other devices the media they are missing. */
function AutoSend({ busy }: { busy: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => { store.loadAnkiFolderState().then(() => setTick((t) => t + 1)); return store.subscribe(() => setTick((t) => t + 1)); }, []);
  const others = store.otherWants();
  return (
    <div className="field" style={{ marginTop: 10 }}>
      <label>Send new media automatically <span className="muted">(PC with Anki)</span></label>
      {store.ankiDirAccess === "none" ? (
        <p className="small muted" style={{ margin: "0 0 6px" }}>Press <b>1. Pick Anki's media folder</b> once. From then on, whenever this PC syncs, your phone gets the pictures and sounds it is missing — new cards included. Nothing to copy by hand.</p>
      ) : store.ankiDirAccess === "prompt" ? (
        <div className="row"><span className="small grow">Linked to <b>{store.ankiDirName}</b> — the browser wants your OK again after a restart.</span><button className="btn primary" disabled={busy} onClick={() => store.allowAnkiFolder()}>Allow</button></div>
      ) : (
        <div className="row"><span className="small grow">✓ Linked to <b>{store.ankiDirName}</b>. Each sync sends what your other devices are missing.</span><button className="btn" disabled={busy} onClick={() => store.unlinkAnkiFolder()}>Unlink</button></div>
      )}
      {others.length > 0 && <ul className="small muted" style={{ margin: "6px 0 0" }}>{others.map((w) => <li key={w.device}><b>{w.device}</b>: {w.total ? `missing ${w.total.toLocaleString()} file${w.total === 1 ? "" : "s"}` : "has everything"} <span className="muted">(as of {fmtDateTime(w.at)})</span></li>)}</ul>}
      {store.sendNote && <p className="small" style={{ margin: "6px 0 0" }}>{store.sendNote}</p>}
    </div>
  );
}

/** Target recall as a slider: under the thumb, live, what that choice costs (a simulated year with the user's own data). */
function RetentionSlider() {
  const s = store.settings; const perDay = Math.max(1, s.newPerDay || 10);
  const [rows, setRows] = useState<{ key: string; curve: Awaited<ReturnType<typeof retentionTradeoff>>["curve"] } | null>(null);
  const key = `${perDay}:${s.scheduler.w.join(",")}:${store.reviews.length >> 9}`; // redo when the inputs change (or every ~500 reviews)
  useEffect(() => {
    if (rows?.key === key) return; let live = true;
    const t = setTimeout(() => retentionTradeoff(s.scheduler.w, store.reviews, { perDay, from: 0.8, to: 0.95 }).then((r) => { if (live) setRows({ key, curve: r.curve }); }), 400);
    return () => { live = false; clearTimeout(t); };
  }, [key]);
  const at = (v: number) => rows?.key === key ? rows.curve.find((r) => Math.abs(r.r - v) < 0.001) : undefined;
  const now = at(s.scheduler.desiredRetention);
  return (
    <div className="field">
      <Slider label="Target recall (FSRS-6)" value={s.scheduler.desiredRetention} min={0.8} max={0.95} step={0.01} format={(v) => `${Math.round(v * 100)}%`}
        sub="The chance you still remember a card when it comes back. Higher = more reviews."
        onCommit={(v) => store.saveSettings({ scheduler: { ...s.scheduler, desiredRetention: Math.round(v * 100) / 100 } })}
        below={(v) => { const r = at(v); return (
          <div className="kit-cost small">{!r ? <span className="muted">Working out what each choice costs you…</span> : (<>
            <span data-hint={`Study per day|A simulated year of ${perDay} new cards a day with your tuned scheduler, answer times and rating mix.`}><b>{r.minutesPerDay.toFixed(0)} min</b> a day{now && Math.abs(v - s.scheduler.desiredRetention) > 0.001 ? <span className="muted"> ({r.minutesPerDay >= now.minutesPerDay ? "+" : "−"}{Math.abs(r.minutesPerDay - now.minutesPerDay).toFixed(0)})</span> : null}</span>
            <span data-hint="Still remembered|Of everything learned in that year, the share you'd still recall at its end."><b>{Math.round(r.rememberedShare * 100)}%</b> still remembered after a year</span>
          </>)}</div>); }} />
      <p className="small muted" style={{ margin: 0 }}>Below ~85% you save time but forget more; above ~90% each extra point costs a lot more time. For medicine, 85–90% is the usual sweet spot.</p>
    </div>
  );
}

/** Today as dd-mm-yyyy for file names. */
function dmy(d = new Date()) { return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`; }

function downloadBlob(blob: Blob, name: string) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 120000); }

/** Per-device switches (like Orange): vibration and animations. Reduced-motion in the system is respected too. */
function DeviceToggles() {
  const get = (k: string) => { try { return localStorage.getItem(k) !== "off"; } catch { return true; } };
  const [h, setH] = useState(() => get("yuzu-haptics")); const [fx, setFx] = useState(() => get("yuzu-effects"));
  const set = (k: string, on: boolean) => { try { localStorage.setItem(k, on ? "on" : "off"); } catch { /* fine */ } };
  return (<>
    <label className="row small" style={{ margin: "12px 0 0" }}><input type="checkbox" checked={h} onChange={(e) => { setH(e.target.checked); set("yuzu-haptics", e.target.checked); if (e.target.checked) navigator.vibrate?.(12); }} /> Vibration (Android): ratings, holds, drags</label>
    <label className="row small" style={{ margin: "8px 0 0" }}><input type="checkbox" checked={fx} onChange={(e) => { setFx(e.target.checked); set("yuzu-effects", e.target.checked); document.documentElement.dataset.effects = e.target.checked ? "on" : "off"; }} /> Animations and effects (card fly-off, sheets sliding)</label>
  </>);
}

/** Light weekdays and a break: the load balancer steers new due dates away from them (Anki 24.11's "easy days"). */
function EasyDays() {
  const s = store.settings; const days = s.easyDays ?? [1, 1, 1, 1, 1, 1, 1];
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; const order = [5, 6, 0, 1, 2, 3, 4]; // the user's week starts on Friday
  const next = (v: number) => (v >= 1 ? 0.5 : v > 0 ? 0 : 1);
  return (
    <div className="field">
      <label>Light days and breaks</label>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {order.map((d) => <button key={d} className={"chip" + (days[d] < 1 ? " orange" : "")} data-hint={`${names[d]}|Tap to cycle: normal → light (about half the reviews) → off (as few as the schedule allows).`} onClick={() => { const e = [...days]; e[d] = next(e[d]); store.saveSettings({ easyDays: e }); }}>{names[d]} · {days[d] >= 1 ? "normal" : days[d] > 0 ? "light" : "off"}</button>)}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <span className="small">Break from</span><input type="date" value={s.breakFrom} onChange={(e) => store.saveSettings({ breakFrom: e.target.value })} style={{ width: 150 }} />
        <span className="small">to</span><input type="date" value={s.breakTo} min={s.breakFrom || undefined} onChange={(e) => store.saveSettings({ breakTo: e.target.value })} style={{ width: 150 }} />
        {(s.breakFrom || s.breakTo) && <button className="chip" onClick={() => store.saveSettings({ breakFrom: "", breakTo: "" })}>Clear</button>}
      </div>
      <span className="small muted">Each answer's next date moves by a day or two within the scheduler's normal spread to the quietest day — so reviews avoid light days, off days and your break (e.g. a night-shift week). No card is pushed past what the spread allows.</span>
    </div>
  );
}
