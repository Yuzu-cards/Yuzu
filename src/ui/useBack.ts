// Android/browser back button closes the current overlay (study, sheet, sub-screen) instead of leaving the app.
// Each open overlay pushes one history entry; closing it by tap pops that entry silently.
// One stack for the whole app: back and Escape go to the topmost overlay only, so stacked sheets unwind one at a time.
import { useEffect, useRef } from "react";

type Entry = { id: number; close: () => void; popped: boolean };
const stack: Entry[] = [];
let seq = 0;
let ignorePops = 0; // traversals we caused ourselves (closing by tap), not to be treated as the user pressing back
let pendingBack = 0; // entries to drop, batched into one history.go(-n) (two history.back() in one task can collapse into one)
let installed = false;

function dropEntry() {
  if (pendingBack++ > 0) return;
  queueMicrotask(() => { const n = pendingBack; pendingBack = 0; if (!n) return; ignorePops++; history.go(-n); });
}
/** An overlay that was asked to close by back but stayed open (e.g. "Discard this card?" → Cancel) gets its back step again. */
function rearm() {
  if (ignorePops > 0 || pendingBack > 0) return; // after our own traversal lands
  const top = stack[stack.length - 1];
  if (top?.popped) { top.popped = false; history.pushState({ yuzu: top.id }, ""); }
}
function install() {
  if (installed) return; installed = true;
  window.addEventListener("popstate", () => {
    if (ignorePops > 0) { ignorePops--; rearm(); return; }
    const top = stack[stack.length - 1]; if (!top || top.popped) return;
    top.popped = true; top.close();
    setTimeout(rearm, 0);
  });
  // Escape on a keyboard (and B on a gamepad) closes the topmost overlay too (PC).
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const top = stack[stack.length - 1]; if (!top) return;
    e.preventDefault(); top.close();
  });
}

export function useBack(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    install();
    const entry: Entry = { id: ++seq, close: () => closeRef.current(), popped: false };
    stack.push(entry);
    history.pushState({ yuzu: entry.id }, "");
    return () => {
      const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1);
      if (!entry.popped) dropEntry();
    };
  }, [open]);
}

/** True while any overlay (sheet, study, sub-screen) is open. */
export const overlayOpen = () => stack.length > 0;
