// Image occlusion editor: pick a picture, drag boxes over what you want to learn, name each box. Each box becomes a card.
import { useRef, useState } from "react";
import { store } from "../lib/store";
import { boxFrom, type Mask } from "../lib/occlusion";
import { IconClose } from "./icons";
import { snackbar } from "./kit";

/** A picture file → a data URL no larger than 1600 px on its long side (phone photos are 4000+). */
export async function shrinkImage(file: Blob, max = 1600): Promise<string> {
  const bmp = await createImageBitmap(file); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const webp = c.toDataURL("image/webp", 0.85); return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/jpeg", 0.85);
}

export function OcclusionEditor({ onClose }: { onClose: () => void }) {
  const [img, setImg] = useState(""); const [masks, setMasks] = useState<Mask[]>([]); const [title, setTitle] = useState(""); const [cat, setCat] = useState("Medicine::Inbox");
  const [drag, setDrag] = useState<{ ax: number; ay: number; bx: number; by: number } | null>(null); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pt = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return [Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)), Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))] as const; };
  const live = drag ? boxFrom(drag.ax, drag.ay, drag.bx, drag.by) : null;
  return (
    <div className="sheet-backdrop" onClick={onClose}><div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh", overflow: "auto" }}>
      <div className="row"><b className="grow">Image occlusion</b><button className="icon-btn" aria-label="Close editor" onClick={onClose}><IconClose /></button></div>
      {!img ? <>
        <p className="small muted" style={{ marginTop: 4 }}>Pick a diagram or photo, then drag a box over each thing you want to learn. Every box becomes one card: that box is hidden, you name it.</p>
        <input type="file" accept="image/*" aria-label="Picture" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setBusy(true); try { setImg(await shrinkImage(f)); } catch { setMsg("That file couldn't be read as a picture"); } finally { setBusy(false); } }} />
        {busy && <p className="small muted">Preparing the picture…</p>}
      </> : <>
        <p className="small muted" style={{ margin: "4px 0 8px" }}>Drag on the picture to draw a box.</p>
        <div ref={box} className="io" data-testid="io-canvas" style={{ position: "relative", lineHeight: 0, touchAction: "none", userSelect: "none" }}
          onPointerDown={(e) => { const [x, y] = pt(e); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrag({ ax: x, ay: y, bx: x, by: y }); }}
          onPointerMove={(e) => { if (drag) { const [x, y] = pt(e); setDrag({ ...drag, bx: x, by: y }); } }}
          onPointerUp={() => { if (live && live.w > 1.5 && live.h > 1.5) setMasks((m) => [...m, live]); setDrag(null); }}>
          <img src={img} alt="" draggable={false} style={{ width: "100%", height: "auto", display: "block", borderRadius: 8 }} />
          {masks.map((m, i) => <div key={i} className="io-box io-hide" style={{ left: m.x + "%", top: m.y + "%", width: m.w + "%", height: m.h + "%", opacity: 0.7, color: "#fff", fontSize: 12, lineHeight: "16px", textAlign: "center" }}>{i + 1}</div>)}
          {live && <div className="io-box io-open" style={{ left: live.x + "%", top: live.y + "%", width: live.w + "%", height: live.h + "%" }} />}
        </div>
        {masks.map((m, i) => <div key={i} className="row" style={{ gap: 6, marginTop: 6 }}><b style={{ minWidth: 20 }}>{i + 1}</b>
          <input className="grow" style={{ minWidth: 0 }} aria-label={`Name of box ${i + 1}`} placeholder="What is it? (the answer)" value={m.label} onChange={(e) => setMasks(masks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <button className="icon-btn" aria-label={`Remove box ${i + 1}`} onClick={() => setMasks(masks.filter((_, j) => j !== i))}><IconClose /></button></div>)}
        <div className="field"><label>Title (optional)</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Heart: anterior view" /></div>
        <div className="field"><label>Deck</label><input value={cat} onChange={(e) => setCat(e.target.value)} autoCapitalize="none" /></div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => { setImg(""); setMasks([]); }}>Other picture</button>
          <button className="btn primary grow" disabled={!masks.length || busy} onClick={async () => { setBusy(true); try { const m = await store.addOcclusion({ title: title.trim(), image: img, masks, category: cat.trim() }); setMsg(m); snackbar(m); setImg(""); setMasks([]); setTitle(""); } catch (e: any) { setMsg(e?.message ?? String(e)); } finally { setBusy(false); } }}>Make {masks.length || ""} card{masks.length === 1 ? "" : "s"}</button>
        </div>
      </>}
      {msg && <p className="small" style={{ marginBottom: 0 }}>{msg}</p>}
    </div></div>
  );
}
