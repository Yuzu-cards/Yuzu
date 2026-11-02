// Android/browser back button closes the current overlay (study, sheet, sub-screen) instead of leaving the app.
// Each open overlay pushes one history entry; closing it by tap pops that entry silently.
import { useEffect, useRef } from "react";

let depth = 0;
let ignorePops = 0; // pops we caused ourselves (closing by tap), not to be treated as the user pressing back

export function useBack(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const id = ++depth;
    history.pushState({ yuzu: id }, "");
    let popped = false;
    const onPop = () => {
      if (ignorePops > 0) { ignorePops--; return; }
      // Only the topmost overlay reacts to a back press.
      if (id !== depth) return;
      popped = true; closeRef.current();
    };
    // Escape on a keyboard closes the topmost overlay too (PC). A sheet on top handles its own Escape and stops it here.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && id === depth && !e.defaultPrevented) { e.preventDefault(); closeRef.current(); } };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      depth = Math.max(0, depth - 1);
      if (!popped && history.state?.yuzu === id) { ignorePops++; history.back(); }
    };
  }, [open]);
}
