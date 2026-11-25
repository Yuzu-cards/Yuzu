// Draw on the card (1.10.0, after AnkiDroid's whiteboard): a clear layer over the card for the S-Pen, a finger or the
// mouse — sketch an ECG axis, a pathway, a word's ending before you flip. Pen pressure sets the width. Nothing is saved;
// it clears on the next card. While it is open, touches draw instead of swiping or flipping.
import { useEffect, useRef, useState } from "react";

type Pt = [number, number, number]; type Stroke = { c: string; w: number; pts: Pt[] };
const INKS = ["#ff7a1a", "#3d8bfd", "#2fbf71", "#f2f2f0"];

export function Whiteboard({ target, onClose }: { target: HTMLElement | null; onClose: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null); const strokes = useRef<Stroke[]>([]); const cur = useRef<Stroke | null>(null);
  const [ink, setInk] = useState(0); const [thick, setThick] = useState(3); const [, setN] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(() => target?.getBoundingClientRect() ?? null);
  useEffect(() => { const f = () => setRect(target?.getBoundingClientRect() ?? null); f(); addEventListener("resize", f); return () => removeEventListener("resize", f); }, [target]);
  const draw = () => {
    const c = cv.current; if (!c) return; const g = c.getContext("2d")!; const dpr = devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, c.width, c.height); g.lineCap = "round"; g.lineJoin = "round";
    for (const s of [...strokes.current, ...(cur.current ? [cur.current] : [])]) {
      g.strokeStyle = s.c;
      for (let i = 1; i < s.pts.length; i++) { const [x0, y0, p0] = s.pts[i - 1], [x1, y1, p1] = s.pts[i]; g.lineWidth = s.w * (0.5 + (p0 + p1) / 2); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
      if (s.pts.length === 1) { const [x, y] = s.pts[0]; g.fillStyle = s.c; g.beginPath(); g.arc(x, y, s.w / 2, 0, Math.PI * 2); g.fill(); }
    }
  };
  useEffect(() => { const c = cv.current; if (!c || !rect) return; const dpr = devicePixelRatio || 1; c.width = Math.round(rect.width * dpr); c.height = Math.round(rect.height * dpr); draw(); }, [rect?.width, rect?.height]);
  const at = (e: React.PointerEvent): Pt => { const b = cv.current!.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top, e.pointerType === "pen" ? Math.max(0.1, e.pressure || 0.5) : 0.5]; };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const undo = () => { strokes.current.pop(); draw(); setN((n) => n + 1); };
  const clear = () => { strokes.current = []; draw(); setN((n) => n + 1); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "z" && strokes.current.length) { e.preventDefault(); e.stopImmediatePropagation(); undo(); } }; addEventListener("keydown", k, true); return () => removeEventListener("keydown", k, true); }, []);
  if (!rect) return null;
  return (<>
    <canvas ref={cv} className="whiteboard" data-testid="whiteboard" data-strokes={strokes.current.length} aria-label="Drawing layer over the card" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      onPointerDown={(e) => { stop(e); (e.target as Element).setPointerCapture?.(e.pointerId); cur.current = { c: INKS[ink], w: thick, pts: [at(e)] }; draw(); }}
      onPointerMove={(e) => { stop(e); if (!cur.current) return; const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? []; if (evs.length) for (const x of evs) cur.current.pts.push(at({ ...e, clientX: x.clientX, clientY: x.clientY, pressure: x.pressure } as any)); else cur.current.pts.push(at(e)); draw(); }}
      onPointerUp={(e) => { stop(e); if (cur.current) { strokes.current.push(cur.current); cur.current = null; setN((n) => n + 1); draw(); } }}
      onPointerCancel={() => { cur.current = null; draw(); }}
      onClick={stop} onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop} onContextMenu={(e) => e.preventDefault()} />
    <div className="wb-bar" role="toolbar" aria-label="Drawing" style={{ left: rect.left + 8, top: Math.max(8, rect.top - 48) }} onClick={stop} onPointerDown={stop} onTouchStart={stop}>
      {INKS.map((c, i) => <button key={c} className={"wb-ink" + (i === ink ? " on" : "")} style={{ background: c }} aria-label={`Ink ${i + 1}`} aria-pressed={i === ink} onClick={() => setInk(i)} />)}
      <button className="btn" onClick={() => setThick((t) => (t === 3 ? 6 : t === 6 ? 1.5 : 3))} aria-label="Pen width" title="Pen width">{thick === 1.5 ? "Fine" : thick === 3 ? "Pen" : "Thick"}</button>
      <button className="btn" onClick={undo} disabled={!strokes.current.length} aria-label="Undo the last line">↶</button>
      <button className="btn" onClick={clear} disabled={!strokes.current.length}>Clear</button>
      <button className="btn primary" onClick={onClose} data-testid="wb-close">Done</button>
    </div>
  </>);
}
