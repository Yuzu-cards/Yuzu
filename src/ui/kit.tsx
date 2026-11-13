import { latinDigits } from "../lib/num";
// Hand kit, ported from Orange (src/components/ui.jsx, 8.1.0) to typed components in Yuzu's 8-bit look:
// hold to explain, hold menus (action sheets), sliders, drag to reorder, pull to sync, undo snackbars.
// Rule from Orange: holding is a shortcut and an explainer, never the only way to reach something.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useBack } from "./useBack";
import { IconClose } from "./icons";

const buzz = (ms: number | number[]) => { try { if (localStorage.getItem("yuzu-haptics") !== "off") navigator.vibrate?.(ms); } catch { /* no haptics */ } };
export { buzz };

// ---------------------------------------------------------------- dialogs
const dialogs: HTMLElement[] = []; // open dialogs, topmost last
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
/** Tab stays inside, focus starts on the sheet and goes back where it was, the page behind is inert and doesn't scroll.
 *  Escape and Android back are useBack's (topmost overlay only). */
export function useDialog(_onClose?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; const a0 = document.activeElement as HTMLElement | null; const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; el?.focus({ preventScroll: true });
    // Everything behind (the app, sheets further down) is inert: no Tab, no screen reader, no stray clicks. Toasts and the snackbar stay live.
    const behind = [document.getElementById("root"), ...document.querySelectorAll<HTMLElement>("body > .sheet-backdrop, body > [role=dialog]")]
      .filter((x): x is HTMLElement => !!x && !!el && !x.contains(el) && !x.hasAttribute("inert"));
    for (const x of behind) x.setAttribute("inert", "");
    // Focus goes back where it was; if it had fallen to the page (a tap on the scrim), back into the sheet below.
    const prevFocus = a0 && a0 !== document.body ? a0 : dialogs[dialogs.length - 1] ?? null;
    if (el) dialogs.push(el);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !el || dialogs[dialogs.length - 1] !== el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1]; const a = document.activeElement as HTMLElement | null;
      if (!a || !el.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && (a === first || a === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey); const i = el ? dialogs.indexOf(el) : -1; if (i >= 0) dialogs.splice(i, 1);
      for (const x of behind) x.removeAttribute("inert");
      if (!dialogs.length) document.body.style.overflow = prevOverflow;
      if (prevFocus?.isConnected) prevFocus.focus?.({ preventScroll: true });
    };
  }, []);
  return ref;
}

let sheetSeq = 0;
/**
 * Every sheet: a dialog with its title as a heading, a close button, Escape / Android back / pad B, focus kept inside and
 * given back on close. A tap on the dimmed area closes it, unless something has been typed (`dirty`): then it asks first,
 * and so do Escape and back.
 */
export function Sheet({ title, label, onClose, dirty = false, discard = "Discard what you typed?", wide, className = "", style, closeLabel = "Close", head, bare, children, testId }: {
  title: string; /** a shorter accessible name than the title */ label?: string; onClose: () => void; dirty?: boolean; discard?: string; wide?: boolean; className?: string; style?: React.CSSProperties;
  closeLabel?: string; /** extra things in the title row (chips) */ head?: ReactNode; /** no title row: the sheet draws its own (title still names the dialog) */ bare?: boolean; children: ReactNode; testId?: string;
}) {
  const [id] = useState(() => "sheet-t" + ++sheetSeq);
  const closeRef = useRef(onClose); closeRef.current = onClose; const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const asking = useRef(false);
  const close = () => {
    if (!dirtyRef.current) { closeRef.current(); return; }
    if (asking.current) return; asking.current = true;
    confirmSheet({ title: discard, sub: "Cancel to keep editing.", yes: "Discard" }).then((ok) => { asking.current = false; if (ok) closeRef.current(); });
  };
  const ref = useDialog(); useBack(true, close);
  const down = useRef(false); // a press that starts inside the sheet and ends on the scrim (selecting text) is not a tap outside
  return createPortal(
    <div className="sheet-backdrop" onPointerDown={(e) => { down.current = e.target === e.currentTarget; }} onMouseDown={(e) => { if (e.target === e.currentTarget) e.preventDefault(); /* focus stays in the sheet */ }} onClick={(e) => { if (e.target === e.currentTarget && down.current) close(); down.current = false; }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={bare || label ? undefined : id} aria-label={label ?? (bare ? title : undefined)} tabIndex={-1} data-testid={testId}
        className={"sheet" + (wide ? " sheet-wide" : "") + (className ? " " + className : "")} style={style}>
        {!bare && <div className="row sheet-head"><h2 id={id} className="grow sheet-title">{title}</h2>{head}<button className="icon-btn" aria-label={closeLabel} onClick={close}><IconClose /></button></div>}
        {children}
      </div>
    </div>, document.body);
}

/** A real button that opens the file picker (reachable by Tab and the pad); the input itself stays out of the way (a script click still opens it). */
export function FileButton({ label, accept, capture, onFile, className = "btn", disabled, inputLabel }: { label: ReactNode; inputLabel?: string; accept?: string; capture?: boolean | "environment" | "user"; onFile: (f: File) => void; className?: string; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <button type="button" className={className} disabled={disabled} onClick={() => input.current?.click()}>{label}</button>
    <input ref={input} type="file" style={{ display: "none" }} tabIndex={-1} aria-hidden="true" aria-label={inputLabel} accept={accept} capture={capture}
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
  </>;
}

/** Ties every `.field > label` to the field next to it (htmlFor / id), so screen readers name it and a tap on the label focuses it. Mount once. */
export function FieldLabels() {
  useEffect(() => {
    let n = 0; let queued = false;
    const link = () => {
      queued = false;
      for (const lab of document.querySelectorAll<HTMLLabelElement>(".field > label:not([for])")) {
        if (lab.querySelector("input,select,textarea")) continue; // wraps its own control
        const f = lab.parentElement?.querySelector<HTMLElement>("input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([aria-hidden=true]),select,textarea"); if (!f) continue;
        if (!f.id) f.id = "yuzu-f" + ++n; lab.htmlFor = f.id;
      }
    };
    const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(link); } });
    link(); mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return null;
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
type HintPos = { title: string; text: string; x: number; y: number; below: boolean; side?: boolean };
/** Over or under the element, centred; on the desktop rail to its right, so it never covers the next tabs. */
function place(el: HTMLElement, r: DOMRect, below: boolean, t: string, rest: string[]): HintPos {
  const title = rest.length ? t : "", text = rest.length ? rest.join("|") : t;
  if (el.closest("nav.tabs") && window.innerWidth >= 1100) return { title, text, x: r.right + 8, y: Math.min(Math.max(r.top + r.height / 2, 60), window.innerHeight - 60), below: false, side: true };
  return { title, text, x: Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130), y: below ? r.bottom + 8 : r.top - 8, below };
}
export function HintLayer() {
  const [hint, setHint] = useState<HintPos | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined, hideTimer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | null = null; let swallow = false;
    const clear = () => { clearTimeout(timer); timer = undefined; start = null; };
    const down = (e: PointerEvent) => {
      setHint(null); clearTimeout(hoverTimer); clearTimeout(hideTimer); quiet = hoverEl; // a click ends hovering: no hint pops up after it

      const el = (e.target as Element | null)?.closest?.("[data-hint]") as HTMLElement | null; if (!el) return;
      // An element with its own hold action (data-hold) keeps the hold, unless the hint sits inside it (more specific).
      const holder = (e.target as Element).closest("[data-hold]"); if (holder && (holder === el || el.contains(holder))) return;
      start = { x: e.clientX, y: e.clientY }; clearTimeout(timer);
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect(); const below = r.top < 110; const raw = el.getAttribute("data-hint") ?? ""; const [t, ...rest] = raw.split("|");
        setHint(place(el, r, below, t, rest));
        swallow = true; buzz(10); clearTimeout(hideTimer); hideTimer = setTimeout(() => setHint(null), 5000);
      }, 450);
    };
    const move = (e: PointerEvent) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clear(); };
    const click = (e: MouseEvent) => { if (!swallow) return; swallow = false; e.preventDefault(); e.stopPropagation(); };
    const up = () => { clear(); if (swallow) setTimeout(() => (swallow = false), 400); };
    const ctx = (e: Event) => { if ((e.target as Element | null)?.closest?.("[data-hint]")) e.preventDefault(); };
    const scroll = () => { clear(); clearTimeout(hoverTimer); setHint(null); };
    // A mouse: hovering a hint shows it after a moment (no hold needed); leaving, clicking or scrolling hides it, and it
    // goes by itself after 4 s. The element just clicked stays quiet until the pointer leaves it.
    let hoverEl: HTMLElement | null = null; let hoverTimer: ReturnType<typeof setTimeout> | undefined; let quiet: HTMLElement | null = null;
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return; const el = (e.target as Element | null)?.closest?.("[data-hint]") as HTMLElement | null; if (el === hoverEl) return;
      hoverEl = el; clearTimeout(hoverTimer); if (el !== quiet) quiet = null; setHint(null); if (!el || el === quiet) return;
      const rail = !!el.closest("nav.tabs") && window.innerWidth >= 1100; // the rail's labels are already visible: wait longer
      hoverTimer = setTimeout(() => { if (hoverEl !== el || !el.isConnected || quiet === el) return; const r = el.getBoundingClientRect(); const below = r.top < 110; const raw = el.getAttribute("data-hint") ?? ""; const [t, ...rest] = raw.split("|");
        setHint(place(el, r, below, t, rest)); clearTimeout(hideTimer); hideTimer = setTimeout(() => setHint(null), 4000); }, rail ? 900 : 650);
    };
    const out = (e: PointerEvent) => { if (e.pointerType === "mouse" && !e.relatedTarget) { hoverEl = null; quiet = null; clearTimeout(hoverTimer); setHint(null); } }; // left the window
    document.addEventListener("pointerover", over, true); document.addEventListener("pointerout", out, true);
    document.addEventListener("pointerdown", down, true); document.addEventListener("pointermove", move, true); document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", clear, true); document.addEventListener("click", click, true); document.addEventListener("contextmenu", ctx, true); window.addEventListener("scroll", scroll, true);
    return () => {
      clearTimeout(timer); clearTimeout(hideTimer); clearTimeout(hoverTimer); document.removeEventListener("pointerover", over, true); document.removeEventListener("pointerout", out, true);
      document.removeEventListener("pointerdown", down, true); document.removeEventListener("pointermove", move, true); document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", clear, true); document.removeEventListener("click", click, true); document.removeEventListener("contextmenu", ctx, true); window.removeEventListener("scroll", scroll, true);
    };
  }, []);
  if (!hint) return null;
  return createPortal(
    <div role="tooltip" data-testid="hint" className="kit-hint" data-side={hint.side ? "" : undefined} style={{ left: hint.x, top: hint.y, transform: hint.side ? "translate(0, -50%)" : `translate(-50%, ${hint.below ? "0" : "-100%"})` }}>
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
    // Right-click, the ContextMenu key, Shift+F10 (and pad Y / key M, which send a contextmenu) open the same menu as a
    // hold. A touch long-press also fires contextmenu, but there the hold timer already answers it.
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); if ((e.nativeEvent as PointerEvent).pointerType === "touch") return; cancel(); onHold({ x: e.clientX, y: e.clientY, target: e.target as Element }); },
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
/**
 * A labelled slider. The native range stays for the keyboard, gamepad and screen readers, but a finger or a pen only moves
 * it by dragging the thumb sideways: a press on the track, or a swipe that turns out to be a scroll, changes nothing
 * (a long Settings page is scrolled right across these). The − / + buttons step it with a deliberate tap. A mouse may
 * still click the track. onChange while dragging; onCommit on release, followed by a snackbar with Undo (`undo={false}`
 * where the commit can't be taken back that way).
 */
const THUMB = 22; // px, the thumb's width in styles.css (.px-range::-webkit-slider-thumb)
export function Slider({ label, value, min, max, step = 1, onChange, onCommit, format = (v) => String(v), sub, below, testId, undo = true }: { label: string; value: number; min: number; max: number; step?: number; onChange?: (v: number) => void; onCommit?: (v: number) => unknown; format?: (v: number) => string; sub?: ReactNode; below?: (v: number) => ReactNode; testId?: string; undo?: boolean }) {
  const [live, setLiveState] = useState(value); const liveRef = useRef(value);
  const setLive = (v: number) => { liveRef.current = v; setLiveState(v); };
  useEffect(() => setLive(value), [value]);
  const valueRef = useRef(value); valueRef.current = value;
  const input = useRef<HTMLInputElement>(null);
  const pct = ((live - min) / (max - min || 1)) * 100;
  const dec = (String(step).split(".")[1] ?? "").length;
  const snap = (v: number) => Number(Math.min(max, Math.max(min, min + Math.round((v - min) / step) * step)).toFixed(dec));
  const geo = () => { const r = input.current!.getBoundingClientRect(); return { left: r.left + THUMB / 2, span: Math.max(1, r.width - THUMB) }; };
  const atX = (x: number) => { const g = geo(); return snap(min + ((x - g.left) / g.span) * (max - min)); };
  const thumbX = () => { const g = geo(); return g.left + ((liveRef.current - min) / (max - min || 1)) * g.span; };
  const move = (v: number) => { if (v === liveRef.current) return; setLive(v); onChange?.(v); };
  // onCommit may answer false (or a promise of false) to refuse the change: the thumb goes back.
  const commit = () => {
    clearTimeout(stepTimer.current); stepTimer.current = undefined;
    const v = liveRef.current, prev = valueRef.current; if (!onCommit || v === prev) return;
    Promise.resolve(onCommit(v)).then((ok) => {
      if (ok === false) { setLive(valueRef.current); return; }
      if (undo) snackbar(`${label}: ${format(v)}`, async () => { setLive(prev); await onCommit(prev); });
    });
  };
  const stepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nudge = (dir: 1 | -1) => { move(snap(liveRef.current + dir * step)); clearTimeout(stepTimer.current); stepTimer.current = setTimeout(commit, 900); };
  type Gesture = { id: number; x0: number; y0: number; off: number; drag: boolean };
  const gest = useRef<Gesture | null>(null);
  const end = (keep: boolean) => { const g = gest.current; gest.current = null; if (!g?.drag) return; if (keep) commit(); else setLive(valueRef.current); };
  return (
    <div className="kit-slider">
      <div className="row" style={{ alignItems: "center", gap: 8 }}>
        <span className="grow"><span className="kit-slider-label">{label}</span>{sub && <span className="small muted" style={{ display: "block" }}>{sub}</span>}</span>
        <button type="button" className="kit-step" tabIndex={-1} aria-label={`Less: ${label}`} disabled={live <= min} onClick={() => nudge(-1)}>−</button>
        <span className="kit-num" aria-hidden="true">{format(live)}</span>
        <button type="button" className="kit-step" tabIndex={-1} aria-label={`More: ${label}`} disabled={live >= max} onClick={() => nudge(1)}>+</button>
      </div>
      <div className="kit-range" data-testid={testId ? testId + "-box" : undefined}
        onPointerDown={(e) => {
          if (e.button != null && e.button !== 0) return; input.current?.focus({ preventScroll: true });
          const off = e.clientX - thumbX();
          if (e.pointerType === "mouse") { // a click is deliberate: jump there (or grab the thumb where it is) and drag
            e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId);
            gest.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, off: Math.abs(off) <= THUMB / 2 + 2 ? off : 0, drag: true }; move(atX(e.clientX - gest.current.off)); return;
          }
          // Touch and pen: only a press on the thumb itself (with a finger's margin) can become a drag.
          gest.current = Math.abs(off) <= THUMB / 2 + 14 ? { id: e.pointerId, x0: e.clientX, y0: e.clientY, off, drag: false } : null;
        }}
        onPointerMove={(e) => {
          const g = gest.current; if (!g || g.id !== e.pointerId) return;
          const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
          if (!g.drag) {
            if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { gest.current = null; return; } // a scroll, not a drag
            if (Math.abs(dx) < 8) return;
            g.drag = true; e.currentTarget.setPointerCapture?.(e.pointerId); buzz(6);
          }
          move(atX(e.clientX - g.off));
        }}
        onPointerUp={(e) => { if (gest.current?.id === e.pointerId) end(true); }}
        onPointerCancel={(e) => { if (gest.current?.id === e.pointerId) end(false); }}
        onLostPointerCapture={(e) => { if (gest.current?.id === e.pointerId) end(true); }}>
        <input ref={input} type="range" className="px-range" aria-label={label} aria-valuetext={format(live)} data-testid={testId} min={min} max={max} step={step} value={live} style={{ "--pct": `${pct}%` } as React.CSSProperties}
          onChange={(e) => move(Number(e.target.value))} onKeyUp={commit} onBlur={commit} />
      </div>
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
    const start = (e: TouchEvent) => { if (!atTop() || document.body.style.overflow === "hidden") return; if ((e.target as Element | null)?.closest?.("[data-drag-handle], input[type=range], .kit-range, [role=dialog], .sheet")) return; y0 = e.touches[0].clientY; d = 0; };
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
const isoOf = (t0: string) => { const t = latinDigits(t0); const m = /^(\d{1,2})[\/.\-\s]?(\d{1,2})[\/.\-\s]?(\d{4})$/.exec(t.trim()) || /^(\d{2})(\d{2})(\d{4})$/.exec(t.trim()); if (!m) return null; const d = new Date(+m[3], +m[2] - 1, +m[1]); return d.getDate() === +m[1] && d.getMonth() === +m[2] - 1 ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
/** A date typed as dd/mm/yyyy (or 03112026), with the phone's own calendar behind the 📅 button. Value is ISO yyyy-mm-dd or "". */
export function DateField({ value, onChange, min, label, placeholder = "dd/mm/yyyy" }: { value: string; onChange: (iso: string) => void; min?: string; label?: string; placeholder?: string }) {
  const [text, setText] = useState(dmyOf(value)); const [bad, setBad] = useState<"" | "form" | "min">("");
  useEffect(() => { setText(dmyOf(value)); setBad(""); }, [value]);
  const native = useRef<HTMLInputElement>(null);
  // `min` is checked here too: the native picker's own min only guards the calendar, not what is typed.
  const take = (iso: string) => { if (min && iso < min) { setBad("min"); return; } setBad(""); onChange(iso); };
  const commit = () => { if (!text.trim()) { setBad(""); onChange(""); return; } const iso = isoOf(text); if (iso) take(iso); else setBad("form"); };
  return (
    <span className="kit-date">
      <input type="text" aria-label={label ?? "Date (dd/mm/yyyy)"} inputMode="numeric" placeholder={placeholder} maxLength={10} value={text} aria-invalid={!!bad || undefined} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      <button type="button" className="chip" aria-label="Choose from a calendar" onClick={() => { const n = native.current; if (!n) return; if ((n as any).showPicker) try { (n as any).showPicker(); return; } catch { /* falls through */ } n.click(); }}>📅</button>
      <input ref={native} type="date" tabIndex={-1} aria-hidden="true" value={value} min={min} onChange={(e) => { if (e.target.value) { setText(dmyOf(e.target.value)); take(e.target.value); } else onChange(""); }} style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
      {bad && <span className="small" role="alert" style={{ color: "var(--again)" }}>{bad === "min" && min ? `Must be on or after ${dmyOf(min)}` : "Use dd/mm/yyyy"}</span>}
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

// ---------------------------------------------------------------- pick one (a <select> opened from the gamepad)
type PickReq = { title: string; options: { label: string; disabled?: boolean }[]; current: number; resolve: (i: number | null) => void };
let pushPick: ((r: PickReq) => void) | null = null;
/** A sheet of choices; answers the picked index, or null for Cancel / B / Escape. */
export function pickSheet(title: string, options: { label: string; disabled?: boolean }[], current = -1): Promise<number | null> {
  return new Promise((resolve) => { if (pushPick) pushPick({ title, options, current, resolve }); else resolve(null); });
}
export function PickHost() {
  const [req, setReq] = useState<PickReq | null>(null);
  useEffect(() => { pushPick = (r) => setReq(r); return () => { pushPick = null; }; }, []);
  useEffect(() => { if (!req) return; const id = requestAnimationFrame(() => { const items = document.querySelectorAll<HTMLElement>(".kit-sheet .kit-item"); const el = items[Math.max(0, req.current)]; try { (el as any)?.focus({ focusVisible: true }); } catch { el?.focus(); } }); return () => cancelAnimationFrame(id); }, [req]);
  if (!req) return null;
  let picked: number | null = null;
  const close = () => { const r = req; setReq(null); queueMicrotask(() => r.resolve(picked)); };
  return <ActionSheet title={req.title} onClose={close} items={req.options.map((o, i) => ({ label: o.label, disabled: o.disabled, hint: i === req.current ? "✓" : undefined, onClick: () => { picked = i; } }))} />;
}

/** True while a media query matches (e.g. a wide screen), following window resizes. */
export function useMedia(query: string): boolean {
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => { const m = window.matchMedia?.(query); if (!m) return; const f = () => setOn(m.matches); f(); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, [query]);
  return on;
}
