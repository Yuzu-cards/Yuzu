// "?" — every way to drive Yuzu without touching the screen: keyboard, mouse and gamepad, all active at once.
import { IconClose } from "./icons";
import { useBack } from "./useBack";

const ROWS: [string, [string, string, string][]][] = [
  ["Anywhere", [["Today · Library · Progress · Settings", "T · L · P · S", "LB / RB"], ["Start studying everything", "G · Enter on Today", "Menu"], ["Search (Today, Library; elsewhere it opens Library)", "/", "—"], ["Write a card · Capture", "N · C", "—"], ["Why so many reviews?", "W", "—"],
    ["Move between buttons · press", "Tab / Shift+Tab · Enter", "D-pad or stick · A"], ["Change a slider or a dropdown", "← / →", "D-pad ← / → (A lists a dropdown's choices)"],
    ["Menu of a deck, category or card row (what holding opens)", "Right-click · M · Shift+F10", "Y"], ["Back / close", "Esc", "B"], ["Leave a text box (a search box empties first)", "Esc", "B"],
    ["Type (Steam Deck)", "—", "Steam + X opens the on-screen keyboard"], ["Undo outside studying", "the Undo button on the message", "D-pad to it · A"], ["This list (also in Settings → Controls)", "?", "View"]]],
  ["Studying", [["Show the answer", "Space", "A"], ["Again · Hard · Good · Easy", "1 · 2 · 3 · 4", "D-pad ← ↓ → ↑"], ["Good (after the answer)", "Space / Enter", "A"], ["Undo", "Ctrl+Z", "X"], ["Card info", "I", "Y"], ["Card menu", "M · right-click the card", "Menu"], ["First-letter hint", "H", "—"], ["Replay sound", "R", "—"], ["Pick an option (multiple choice)", "1–5", "D-pad ↑ ↓ choose · A confirm"]]],
];

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  useBack(true, onClose);
  return (
    <div className="sheet-backdrop" onClick={onClose}><div className="sheet" role="dialog" aria-label="Controls" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh", overflow: "auto" }}>
      <div className="row"><b className="grow">Keyboard, mouse and gamepad</b><button className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button></div>
      <p className="small muted" style={{ marginTop: 4 }}>All three work at the same time. With a mouse, hover anything with a hint to read it; right-click a card or a row for its menu (the same as holding it).</p>
      {ROWS.map(([h, rows]) => <div key={h}><h2>{h}</h2>
        <div className="keys" role="table"><div className="keys-row head" role="row"><span>What</span><span>Keyboard</span><span>Gamepad</span></div>
          {rows.map(([w, k, g]) => <div key={w} className="keys-row" role="row"><span>{w}</span><span><kbd>{k}</kbd></span><span><kbd>{g}</kbd></span></div>)}</div></div>)}
    </div></div>
  );
}
