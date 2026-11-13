// Image occlusion editor: pick a picture, drag boxes over what you want to learn, name each box. Each box becomes a card.
// Boxes are drawn over the picture; a tapped box can be dragged to move it, resized by its corner handle, or removed with its ✕
// (mouse, touch and pen through pointer events; with a keyboard: Tab to a box, arrows move it, Shift+arrows resize, Delete removes).
import { useRef, useState } from "react";
import { store } from "../lib/store";
import { boxFrom, type Mask } from "../lib/occlusion";
import { IconClose } from "./icons";
import { snackbar } from "./kit";
import { useBack } from "./useBack";

/** A picture file → a data URL no larger than 1600 px on its long side (phone photos are 4000+). */
export async function shrinkImage(file: Blob, max = 1600): Promise<string> {
  const bmp = await createImageBitmap(file); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const webp = c.toDataURL("image/webp", 0.85); return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/jpeg", 0.85);
}

/** Smallest box kept, in percent of the picture (smaller is a stray tap). */
export const MIN_BOX = 1.5;
const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
/** Move a box by (dx, dy) percent, kept inside the picture. */
export function moveBox(m: Mask, dx: number, dy: number): Mask { return { ...m, x: r1(clamp(m.x + dx, 0, 100 - m.w)), y: r1(clamp(m.y + dy, 0, 100 - m.h)) }; }
/** Resize a box from its bottom-right corner by (dw, dh) percent, never smaller than MIN_BOX nor past the picture's edge. */
export function resizeBox(m: Mask, dw: number, dh: number): Mask { return { ...m, w: r1(clamp(m.w + dw, MIN_BOX, 100 - m.x)), h: r1(clamp(m.h + dh, MIN_BOX, 100 - m.y)) }; }

type Act = { mode: "draw"; ax: number; ay: number; bx: number; by: number } | { mode: "move" | "resize"; i: number; ax: number; ay: number; orig: Mask; moved: boolean };

export function OcclusionEditor({ onClose }: { onClose: () => void }) {
  useBack(true, onClose); // Esc on a PC, the back gesture on a phone
  const [img, setImg] = useState(""); const [masks, setMasks] = useState<Mask[]>([]); const [title, setTitle] = useState(""); const [cat, setCat] = useState(() => { try { return localStorage.getItem("yuzu-edit-deck") || "Medicine::Inbox"; } catch { return "Medicine::Inbox"; } });
  const [act, setAct] = useState<Act | null>(null); const [sel, setSel] = useState(-1); const [msg, setMsg] = useState(""); const [hint, setHint] = useState(""); const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null); const hintT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const say = (t: string) => { setHint(t); clearTimeout(hintT.current); hintT.current = setTimeout(() => setHint(""), 2200); };
  const pt = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return [clamp(((e.clientX - r.left) / r.width) * 100, 0, 100), clamp(((e.clientY - r.top) / r.height) * 100, 0, 100)] as const; };
  const live = act?.mode === "draw" ? boxFrom(act.ax, act.ay, act.bx, act.by) : null;
  const setMask = (i: number, m: Mask) => setMasks((ms) => ms.map((x, j) => (j === i ? m : x)));
  const remove = (i: number) => { setMasks((ms) => ms.filter((_, j) => j !== i)); setSel(-1); };
  const down = (e: React.PointerEvent) => {
    if (e.button > 0) return; const [x, y] = pt(e); const t = e.target as HTMLElement;
    box.current!.setPointerCapture?.(e.pointerId);
    const i = Number(t.closest("[data-box]")?.getAttribute("data-box") ?? -1);
    if (i >= 0 && masks[i]) { setSel(i); setAct({ mode: t.closest("[data-resize]") ? "resize" : "move", i, ax: x, ay: y, orig: masks[i], moved: false }); return; }
    setSel(-1); setAct({ mode: "draw", ax: x, ay: y, bx: x, by: y });
  };
  const move = (e: React.PointerEvent) => {
    if (!act) return; const [x, y] = pt(e);
    if (act.mode === "draw") { setAct({ ...act, bx: x, by: y }); return; }
    const m = act.mode === "move" ? moveBox(act.orig, x - act.ax, y - act.ay) : resizeBox(act.orig, x - act.ax, y - act.ay);
    if (!act.moved) setAct({ ...act, moved: true }); setMask(act.i, m);
  };
  const up = () => {
    if (act?.mode === "draw" && live) {
      if (live.w >= MIN_BOX && live.h >= MIN_BOX) { setMasks((m) => [...m, live]); setSel(masks.length); }
      else if (live.w > 0 || live.h > 0) say("Box too small — drag a bigger one");
    }
    setAct(null);
  };
  const keys = (e: React.KeyboardEvent, i: number) => {
    const step = e.altKey ? 0.5 : 2; const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) { e.preventDefault(); setSel(i); setMask(i, e.shiftKey ? resizeBox(masks[i], d[0], d[1]) : moveBox(masks[i], d[0], d[1])); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(i); }
  };
  const pick = async (f: File | undefined) => { if (!f) return; setBusy(true); setMsg(""); try { setImg(await shrinkImage(f)); setTitle((t) => t || f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim()); } catch { setMsg("That file couldn't be read as a picture"); } finally { setBusy(false); } };
  const make = async () => {
    setBusy(true);
    try { const m = await store.addOcclusion({ title: title.trim(), image: img, masks, category: cat.trim() }); setMsg(m); snackbar(m); setImg(""); setMasks([]); setTitle(""); setSel(-1); }
    catch (e: any) { setMsg(e?.message ?? String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="sheet-backdrop" onClick={onClose}><div className={"sheet io-sheet" + (img ? " io-sheet-on" : "")} role="dialog" aria-label="Image occlusion" onClick={(e) => e.stopPropagation()}>
      <div className="row"><b className="grow">Image occlusion</b><button className="icon-btn" aria-label="Close editor" onClick={onClose}><IconClose /></button></div>
      {!img ? <>
        <p className="small muted" style={{ marginTop: 4 }}>Pick a diagram or photo, then drag a box over each thing you want to learn. Every box becomes one card: that box is hidden, you name it.</p>
        <label className="btn primary io-pick" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget.querySelector("input") as HTMLInputElement)?.click(); } }}>Choose a picture
          <input type="file" accept="image/*" aria-label="Picture" className="io-file" onChange={(e) => pick(e.target.files?.[0])} /></label>
        {busy && <p className="small muted">Preparing the picture…</p>}
      </> : <>
        <div className="io-top">
          <p className="small muted io-tip" aria-live="polite">{hint ? <b className="io-warn">{hint}</b> : sel >= 0 ? `Box ${sel + 1}: drag it to move, the corner to resize, ✕ to remove. Tap the picture elsewhere to draw a new box.` : "Drag on the picture to draw a box."}</p>
          <div className="io-stage">
            <div ref={box} className="io io-ed" data-testid="io-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
              <img src={img} alt="" draggable={false} />
              {masks.map((m, i) => <div key={i} data-box={i} tabIndex={0} role="button" aria-label={`Box ${i + 1}${m.label ? ": " + m.label : ""}`} aria-pressed={sel === i} className={"io-box io-hide" + (sel === i ? " io-sel" : "")} onFocus={() => setSel(i)} onKeyDown={(e) => keys(e, i)}
                style={{ left: m.x + "%", top: m.y + "%", width: m.w + "%", height: m.h + "%" }}><span className="io-num">{i + 1}</span>
                {sel === i && <><button type="button" className="io-del" aria-label={`Remove box ${i + 1}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); remove(i); }}>✕</button><span className="io-handle" data-resize aria-hidden="true" /></>}</div>)}
              {live && <div className="io-box io-open" style={{ left: live.x + "%", top: live.y + "%", width: live.w + "%", height: live.h + "%" }} />}
            </div>
          </div>
        </div>
        <div className="io-rest">
          {masks.map((m, i) => <div key={i} className={"field row io-row" + (sel === i ? " on" : "")} style={{ gap: 6 }}><b className="io-n" onClick={() => setSel(i)}>{i + 1}</b>
            <input className="grow" style={{ minWidth: 0 }} aria-label={`Name of box ${i + 1}`} placeholder="What is it? (the answer)" value={m.label} onFocus={() => setSel(i)} onChange={(e) => setMask(i, { ...m, label: e.target.value })} />
            <button className="icon-btn" aria-label={`Remove box ${i + 1}`} onClick={() => remove(i)}><IconClose /></button></div>)}
          <div className="field"><label>Title (optional)</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Heart: anterior view" /></div>
          <div className="field"><label>Deck</label><input value={cat} onChange={(e) => setCat(e.target.value)} autoCapitalize="none" /></div>
        </div>
        <div className="row io-foot">
            <button className="btn" onClick={() => { setImg(""); setMasks([]); setSel(-1); }}>Other picture</button>
            <button className="btn primary grow" disabled={!masks.length || busy} onClick={make}>Make {masks.length || ""} card{masks.length === 1 ? "" : "s"}</button>
        </div>
      </>}
      {msg && <p className="small" style={{ marginBottom: 0 }}>{msg}</p>}
    </div></div>
  );
}
