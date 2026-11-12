// "?" — every way to drive Yuzu without touching the screen: keyboard, mouse and gamepad, all active at once.
import { IconClose } from "./icons";
import { useBack } from "./useBack";

const ROWS: [string, [string, string, string][]][] = [
  ["Anywhere", [["Today · Library · Progress · Settings", "T · L · P · S", "LB / RB"], ["Start studying", "Enter (on Today)", "Menu"], ["Search", "/", "—"], ["Write a card · Capture", "N · C", "—"], ["Why so many reviews?", "W", "—"], ["Move between buttons · press", "Tab · Enter", "D-pad or stick · A"], ["Back / close", "Esc", "B"], ["This list", "?", "View"]]],
  ["Studying", [["Show the answer", "Space", "A"], ["Again · Hard · Good · Easy", "1 · 2 · 3 · 4", "D-pad ← ↓ → ↑"], ["Good (after the answer)", "Space / Enter", "A"], ["Undo", "Ctrl+Z", "X"], ["Card info", "I", "Y"], ["Card menu", "M · right-click the card", "Menu"], ["First-letter hint", "H", "—"], ["Replay sound", "R", "—"], ["Pick an option (multiple choice)", "1–5", "D-pad"]]],
];

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  useBack(true, onClose);
  return (
    <div className="sheet-backdrop" onClick={onClose}><div className="sheet" role="dialog" aria-label="Controls" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh", overflow: "auto" }}>
      <div className="row"><b className="grow">Keyboard, mouse and gamepad</b><button className="icon-btn" aria-label="Close" onClick={onClose}><IconClose /></button></div>
      <p className="small muted" style={{ marginTop: 4 }}>All three work at the same time. With a mouse, hover anything with a hint to read it; right-click a card for its menu.</p>
      {ROWS.map(([h, rows]) => <div key={h}><h2>{h}</h2>
        <div className="keys" role="table"><div className="keys-row head" role="row"><span>What</span><span>Keyboard</span><span>Gamepad</span></div>
          {rows.map(([w, k, g]) => <div key={w} className="keys-row" role="row"><span>{w}</span><span><kbd>{k}</kbd></span><span><kbd>{g}</kbd></span></div>)}</div></div>)}
    </div></div>
  );
}
