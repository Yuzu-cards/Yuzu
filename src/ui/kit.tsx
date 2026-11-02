// Hand kit, ported from Orange (src/components/ui.jsx, 8.1.0) to typed components in Yuzu's 8-bit look:
// hold to explain, hold menus (action sheets), sliders, drag to reorder, pull to sync, undo snackbars.
// Rule from Orange: holding is a shortcut and an explainer, never the only way to reach something.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useBack } from "./useBack";

const buzz = (ms: number | number[]) => { try { if (localStorage.getItem("yuzu-haptics") !== "off") navigator.vibrate?.(ms); } catch { /* no haptics */ } };
export { buzz };

// ---------------------------------------------------------------- dialogs
/** Escape closes, Tab stays inside, focus starts on the sheet, the page behind doesn't scroll. */
export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current; const prevFocus = document.activeElement as HTMLElement | null; const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; el?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); closeRef.current?.(); }
      else if (e.key === "Tab" && el) {
        const items = [...el.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
        if (!items.length) return; const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; prevFocus?.focus?.({ preventScroll: true }); };
  }, []);
  return ref;
}

export interface SheetItem { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string; icon?: ReactNode }
/** A bottom sheet of actions (what a hold or ⋯ opens). Closes on the scrim, Escape, Android back, or a drag down. */
export function ActionSheet({ title, sub, items, onClose, children }: { title: string; sub?: string; items: (SheetItem | false | null | undefined)[]; onClose: () => void; children?: ReactNode }) {
  const ref = useDialog(onClose); useBack(true, onClose);
  const drag = useRef<{ y0: number; dy: number } | null>(null); const [dy, setDy] = useState(0);
  return createPortal(
    <div className="sheet-backdrop kit-backdrop" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1} aria-label={title} className="sheet kit-sheet" onClick={(e) => e.stopPropagation()} style={dy ? { transform: `translateY(${dy}px)`, transition: "none" } : undefined}
        onTouchStart={(e) => { if ((e.currentTarget.scrollTop ?? 0) <= 0) drag.current = { y0: e.touches[0].clientY, dy: 0 }; }}
        onTouchMove={(e) => { if (!drag.current) return; const d = e.touches[0].clientY - drag.current.y0; drag.current.dy = d; setDy(Math.max(0, d)); }}
        onTouchEnd={() => { const d = drag.current?.dy ?? 0; drag.current = null; setDy(0); if (d > 90) onClose(); }}>
        <div className="kit-sheet-head"><b>{title}</b>{sub && <span className="small muted">{sub}</span>}</div>
        {children}
        {items.filter(Boolean).map((it) => { const i = it as SheetItem; return (
          <button key={i.label} className={"kit-item" + (i.danger ? " danger" : "")} disabled={i.disabled} onClick={() => { onClose(); i.onClick(); }}>
            {i.icon}<span className="grow">{i.label}</span>{i.hint && <span className="small muted">{i.hint}</span>}
          </button>); })}
        <button className="kit-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>, document.body);
}

// ---------------------------------------------------------------- hold for meaning
/**
 * Hold (≈0.45 s) anything with data-hint="Title|explanation" and a bubble explains it. The tap that ends the hold is
 * swallowed, so holding never triggers the button. Mount once.
 */
export function HintLayer() {
  const [hint, setHint] = useState<{ title: string; text: string; x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined, hideTimer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | null = null; let swallow = false;
    const clear = () => { clearTimeout(timer); timer = undefined; start = null; };
    const down = (e: PointerEvent) => {
      setHint(null);
      const el = (e.target as Element | null)?.closest?.("[data-hint]") as HTMLElement | null; if (!el) return;
      // An element with its own hold action (data-hold) keeps the hold, unless the hint sits inside it (more specific).
      const holder = (e.target as Element).closest("[data-hold]"); if (holder && (holder === el || el.contains(holder))) return;
      start = { x: e.clientX, y: e.clientY }; clearTimeout(timer);
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect(); const below = r.top < 110; const raw = el.getAttribute("data-hint") ?? ""; const [t, ...rest] = raw.split("|");
        setHint({ title: rest.length ? t : "", text: rest.length ? rest.join("|") : t, x: Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130), y: below ? r.bottom + 8 : r.top - 8, below });
        swallow = true; buzz(10); clearTimeout(hideTimer); hideTimer = setTimeout(() => setHint(null), 5000);
      }, 450);
    };
    const move = (e: PointerEvent) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clear(); };
    const click = (e: MouseEvent) => { if (!swallow) return; swallow = false; e.preventDefault(); e.stopPropagation(); };
    const up = () => { clear(); if (swallow) setTimeout(() => (swallow = false), 400); };
    const ctx = (e: Event) => { if ((e.target as Element | null)?.closest?.("[data-hint]")) e.preventDefault(); };
    const scroll = () => { clear(); setHint(null); };
    document.addEventListener("pointerdown", down, true); document.addEventListener("pointermove", move, true); document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", clear, true); document.addEventListener("click", click, true); document.addEventListener("contextmenu", ctx, true); window.addEventListener("scroll", scroll, true);
    return () => {
      clearTimeout(timer); clearTimeout(hideTimer);
      document.removeEventListener("pointerdown", down, true); document.removeEventListener("pointermove", move, true); document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", clear, true); document.removeEventListener("click", click, true); document.removeEventListener("contextmenu", ctx, true); window.removeEventListener("scroll", scroll, true);
    };
  }, []);
  if (!hint) return null;
  return createPortal(
    <div role="tooltip" data-testid="hint" className="kit-hint" style={{ left: hint.x, top: hint.y, transform: `translate(-50%, ${hint.below ? "0" : "-100%"})` }}>
      {hint.title && <b>{hint.title}</b>}{hint.text}
    </div>, document.body);
}

// ---------------------------------------------------------------- hold for a menu
/** Hold (≈0.5 s) to run onHold instead of the tap. Spread `bind`; check wasHeld() at the start of onClick. Scrolling cancels it. */
export interface HoldPoint { x: number; y: number; target: Element }
export function useHold(onHold: ((p: HoldPoint) => void) | null, ms = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); const held = useRef(false); const start = useRef<{ x: number; y: number } | null>(null);
  const [pressing, setPressing] = useState(false);
  const cancel = () => { clearTimeout(timer.current); start.current = null; setPressing(false); };
  const bind = onHold ? {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button != null && e.button !== 0) return;
      held.current = false;
      const h = (e.target as Element).closest?.("[data-hint]"); if (h && h !== e.currentTarget && (e.currentTarget as Element).contains(h)) return; // a hint inside wins
      start.current = { x: e.clientX, y: e.clientY }; const p: HoldPoint = { x: e.clientX, y: e.clientY, target: e.target as Element };
      clearTimeout(timer.current); setPressing(true);
      timer.current = setTimeout(() => { held.current = true; setPressing(false); buzz(12); onHold(p); }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => { if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel(); },
    onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    "data-holding": pressing ? "" : undefined, "data-hold": "",
  } : {};
  const wasHeld = () => { const h = held.current; held.current = false; return h; };
  return { bind, wasHeld };
}

/** A row that taps to `onTap` and holds to `onHold` (both also reachable another way, e.g. a ⋯ button). */
export function HoldRow({ onTap, onHold, className = "", children, ...rest }: { onTap?: () => void; onHold: () => void; className?: string; children: ReactNode } & Record<string, unknown>) {
  const { bind, wasHeld } = useHold(onHold);
  return <button {...rest} {...bind} className={className + " kit-holdable"} onClick={() => { if (wasHeld()) return; onTap?.(); }}>{children}</button>;
}

// ---------------------------------------------------------------- sliders
/** A labelled slider (native range: touch, mouse, keyboard, screen readers). onChange while dragging; onCommit on release. */
export function Slider({ label, value, min, max, step = 1, onChange, onCommit, format = (v) => String(v), sub, below, testId }: { label: string; value: number; min: number; max: number; step?: number; onChange?: (v: number) => void; onCommit?: (v: number) => unknown; format?: (v: number) => string; sub?: ReactNode; below?: (v: number) => ReactNode; testId?: string }) {
  const [live, setLive] = useState(value);
  useEffect(() => setLive(value), [value]);
  const pct = ((live - min) / (max - min || 1)) * 100;
  // onCommit may answer false (or a promise of false) to refuse the change: the thumb goes back.
  const commit = () => { if (onCommit && live !== value) Promise.resolve(onCommit(live)).then((ok) => { if (ok === false) setLive(value); }); };
  return (
    <div className="kit-slider">
      <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
        <span className="grow"><span className="kit-slider-label">{label}</span>{sub && <span className="small muted" style={{ display: "block" }}>{sub}</span>}</span>
        <span className="kit-num" aria-hidden="true">{format(live)}</span>
      </div>
      <input type="range" className="px-range" aria-label={label} aria-valuetext={format(live)} data-testid={testId} min={min} max={max} step={step} value={live} style={{ "--pct": `${pct}%` } as React.CSSProperties}
        onChange={(e) => { const v = Number(e.target.value); setLive(v); onChange?.(v); }} onPointerUp={commit} onKeyUp={commit} onBlur={commit} onTouchEnd={commit} />
      {below?.(live)}
    </div>
  );
}

// ---------------------------------------------------------------- drag to reorder
function scrollParent(el: Element | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p; }
  return null;
}
/** Reorder rows (data-drag-item, direct children of listRef) by a ≡ handle: pointer capture, edge auto-scroll, ↑/↓ keys. */
export function useDragReorder({ onMove, listRef }: { onMove: (from: number, to: number) => void; listRef: RefObject<HTMLElement | null> }) {
  type St = { from: number; to: number; y0: number; y: number; box: HTMLElement | null; scroll0: number; els: HTMLElement[]; rects: DOMRect[]; gap: number; raf: number };
  const st = useRef<St | null>(null); const [dragging, setDragging] = useState<number | null>(null);
  const rows = () => [...(listRef.current?.querySelectorAll<HTMLElement>(":scope > [data-drag-item]") ?? [])];
  const end = (commit: boolean) => {
    const s = st.current; if (!s) return; cancelAnimationFrame(s.raf);
    for (const el of s.els) { el.style.transform = ""; el.style.transition = ""; el.style.zIndex = ""; el.style.position = ""; }
    st.current = null; setDragging(null); if (commit && s.to !== s.from) onMove(s.from, s.to);
  };
  const place = () => {
    const s = st.current; if (!s) return;
    const top = () => (s.box ? s.box.scrollTop : window.scrollY);
    const dy = s.y - s.y0 + (top() - s.scroll0); s.els[s.from].style.transform = `translateY(${dy}px)`;
    const mid = s.rects[s.from].top + s.rects[s.from].height / 2 + dy; let to = s.from;
    for (let i = 0; i < s.rects.length; i++) { const c = s.rects[i].top + s.rects[i].height / 2; if (i < s.from && mid < c) to = Math.min(to, i); if (i > s.from && mid > c) to = Math.max(to, i); }
    s.to = to; const h = s.rects[s.from].height + s.gap;
    s.els.forEach((el, i) => { if (i === s.from) return; const shift = s.from < to && i > s.from && i <= to ? -h : s.from > to && i < s.from && i >= to ? h : 0; el.style.transform = shift ? `translateY(${shift}px)` : ""; });
    const edge = 70; const r0 = s.box ? s.box.getBoundingClientRect() : { top: 0, bottom: window.innerHeight - 90 };
    const v = s.y < r0.top + edge ? -12 : s.y > r0.bottom - edge ? 12 : 0;
    if (v) { if (s.box) s.box.scrollTop += v; else window.scrollBy(0, v); s.raf = requestAnimationFrame(place); }
  };
  const handle = (i: number, name: string, count?: number) => ({
    "data-drag-handle": "", role: "button", tabIndex: 0, "aria-label": `Reorder ${name}`, "aria-roledescription": "drag handle",
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button != null && e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId);
      const els = rows(); const rects = els.map((el) => el.getBoundingClientRect()); const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
      for (const el of els) el.style.transition = "transform 120ms"; els[i].style.transition = "none"; els[i].style.zIndex = "20"; els[i].style.position = "relative";
      const box = scrollParent(listRef.current); st.current = { from: i, to: i, y0: e.clientY, y: e.clientY, box, scroll0: box ? box.scrollTop : window.scrollY, els, rects, gap, raf: 0 };
      setDragging(i); buzz(8);
    },
    onPointerMove: (e: React.PointerEvent) => { if (!st.current) return; st.current.y = e.clientY; cancelAnimationFrame(st.current.raf); st.current.raf = requestAnimationFrame(place); },
    onPointerUp: () => end(true), onPointerCancel: () => end(false),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "ArrowUp" && i > 0) onMove(i, i - 1); else if (e.key === "ArrowDown" && i < (count ?? rows().length) - 1) onMove(i, i + 1); else return;
      e.preventDefault(); const to = e.key === "ArrowUp" ? i - 1 : i + 1; requestAnimationFrame(() => rows()[to]?.querySelector<HTMLElement>("[data-drag-handle]")?.focus());
    },
  });
  return { handle, dragging };
}
export function DragHandle(props: Record<string, unknown>) {
  return (
    <span {...props} className="drag-handle" onClick={(e) => e.stopPropagation()}>
      <svg viewBox="0 0 12 12" width="18" height="18" shapeRendering="crispEdges" fill="currentColor" aria-hidden="true"><path d="M2 3h8v2H2zM2 7h8v2H2z" /></svg>
    </span>
  );
}

// ---------------------------------------------------------------- pull to sync
/** Pull down from the very top of the page to sync. Ignores pulls on sliders, handles and sheets. */
export function PullToSync({ enabled, onSync }: { enabled: boolean; onSync: () => void }) {
  const [pull, setPull] = useState(0); const cb = useRef(onSync); cb.current = onSync;
  useEffect(() => {
    if (!enabled) return undefined;
    let y0: number | null = null, d = 0;
    const atTop = () => (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;
    const start = (e: TouchEvent) => { if (!atTop() || document.body.style.overflow === "hidden") return; if ((e.target as Element | null)?.closest?.("[data-drag-handle], input[type=range], [role=dialog], .sheet")) return; y0 = e.touches[0].clientY; d = 0; };
    const move = (e: TouchEvent) => { if (y0 == null) return; d = e.touches[0].clientY - y0; if (d <= 0 || !atTop()) { setPull(0); return; } setPull(Math.min(110, d * 0.5)); };
    const end = () => { if (y0 != null && d * 0.5 >= 70) { buzz(15); cb.current(); } y0 = null; d = 0; setPull(0); };
    window.addEventListener("touchstart", start, { passive: true }); window.addEventListener("touchmove", move, { passive: true }); window.addEventListener("touchend", end); window.addEventListener("touchcancel", end);
    return () => { window.removeEventListener("touchstart", start); window.removeEventListener("touchmove", move); window.removeEventListener("touchend", end); window.removeEventListener("touchcancel", end); };
  }, [enabled]);
  if (!pull) return null;
  const ready = pull >= 70;
  return <div className={"kit-pull" + (ready ? " ready" : "")} style={{ top: `calc(var(--safe-t) + ${pull - 30}px)` }} aria-hidden="true">{ready ? "↑ Release to sync" : "↓ Pull to sync"}</div>;
}

// ---------------------------------------------------------------- undo snackbar
type Snack = { id: number; text: string; undo?: () => void | Promise<void> };
let pushSnack: ((s: Snack) => void) | null = null; let snackId = 0;
/** Show a message with an optional Undo, for a few seconds (anywhere in the app). */
export function snackbar(text: string, undo?: () => void | Promise<void>) { pushSnack?.({ id: ++snackId, text, undo }); }
export function SnackbarHost() {
  const [s, setS] = useState<Snack | null>(null);
  useEffect(() => { let t: ReturnType<typeof setTimeout>; pushSnack = (x) => { clearTimeout(t); setS(x); t = setTimeout(() => setS(null), x.undo ? 6000 : 2600); }; return () => { pushSnack = null; clearTimeout(t); }; }, []);
  if (!s) return null;
  return createPortal(
    <div className="kit-snack" role="status"><span className="grow">{s.text}</span>{s.undo && <button className="btn" onClick={async () => { const u = s.undo!; setS(null); await u(); }}>Undo</button>}</div>, document.body);
}

// ---------------------------------------------------------------- dd/mm/yyyy date field
const dmyOf = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const isoOf = (t: string) => { const m = /^(\d{1,2})[\/.\-\s]?(\d{1,2})[\/.\-\s]?(\d{4})$/.exec(t.trim()) || /^(\d{2})(\d{2})(\d{4})$/.exec(t.trim()); if (!m) return null; const d = new Date(+m[3], +m[2] - 1, +m[1]); return d.getDate() === +m[1] && d.getMonth() === +m[2] - 1 ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
/** A date typed as dd/mm/yyyy (or 03112026), with the phone's own calendar behind the 📅 button. Value is ISO yyyy-mm-dd or "". */
export function DateField({ value, onChange, min, label, placeholder = "dd/mm/yyyy" }: { value: string; onChange: (iso: string) => void; min?: string; label?: string; placeholder?: string }) {
  const [text, setText] = useState(dmyOf(value)); const [bad, setBad] = useState(false);
  useEffect(() => { setText(dmyOf(value)); setBad(false); }, [value]);
  const native = useRef<HTMLInputElement>(null);
  const commit = () => { if (!text.trim()) { setBad(false); onChange(""); return; } const iso = isoOf(text); if (iso) { setBad(false); onChange(iso); } else setBad(true); };
  return (
    <span className="kit-date" aria-label={label}>
      <input type="text" inputMode="numeric" placeholder={placeholder} maxLength={10} value={text} aria-invalid={bad || undefined} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      <button type="button" className="chip" aria-label="Choose from a calendar" onClick={() => { const n = native.current; if (!n) return; if ((n as any).showPicker) try { (n as any).showPicker(); return; } catch { /* falls through */ } n.click(); }}>📅</button>
      <input ref={native} type="date" tabIndex={-1} aria-hidden="true" value={value} min={min} onChange={(e) => onChange(e.target.value)} style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
      {bad && <span className="small" style={{ color: "var(--again)" }}>Use dd/mm/yyyy</span>}
    </span>
  );
}

// ---------------------------------------------------------------- 8-bit confirm (replaces window.confirm / alert)
export interface ConfirmReq { title: string; sub?: string; yes?: string; danger?: boolean; /** alert-style: one "OK", always true */ ok?: boolean }
let pushConfirm: ((r: ConfirmReq & { resolve: (v: boolean) => void }) => void) | null = null;
/** `if (!(await confirmSheet({ title, sub, yes }))) return;` — Cancel, the scrim, Escape and Android back all answer false. */
export function confirmSheet(r: ConfirmReq): Promise<boolean> { return new Promise((resolve) => { if (pushConfirm) pushConfirm({ ...r, resolve }); else resolve(window.confirm(r.title + (r.sub ? "\n" + r.sub : ""))); }); }
/** A sheet with a single OK, for things that only need telling. */
export function tellSheet(title: string, sub?: string) { return confirmSheet({ title, sub, ok: true, danger: false }); }
export function ConfirmHost() {
  const [req, setReq] = useState<(ConfirmReq & { resolve: (v: boolean) => void }) | null>(null);
  useEffect(() => { pushConfirm = (r) => setReq(r); return () => { pushConfirm = null; }; }, []);
  if (!req) return null;
  // The sheet closes first and then runs the item, so a "no" is only settled after a "yes" had its turn.
  const no = () => { const r = req; setReq(null); queueMicrotask(() => r.resolve(!!r.ok)); };
  const yes = () => { req.resolve(true); };
  return <ActionSheet title={req.title} sub={req.sub} onClose={no} items={[{ label: req.ok ? "OK" : req.yes || "Yes", danger: !req.ok && req.danger !== false, onClick: yes }]} />;
}
