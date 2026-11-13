// "?" — every way to drive Yuzu without touching the screen: keyboard, mouse and gamepad, all active at once.
import { Sheet } from "./kit";

const ROWS: [string, [string, string, string][]][] = [
  ["Anywhere", [["Today · Library · Progress · Settings", "T · L · P · S", "LB / RB"], ["Start studying everything", "G · Enter on Today", "Menu"], ["Search (Today, Library; elsewhere it opens Library)", "/", "—"], ["Write a card · Capture", "N · C", "—"], ["Why so many reviews?", "W", "—"],
    ["Move between buttons · press", "Tab / Shift+Tab · Enter", "D-pad or stick · A"], ["Change a slider or a dropdown", "← / →", "D-pad ← / → (A lists a dropdown's choices)"],
    ["Menu of a deck, category or card row (what holding opens)", "Right-click · M · Shift+F10", "Y"], ["Back / close", "Esc", "B"], ["Leave a text box (a search box empties first)", "Esc", "B"],
    ["Type (Steam Deck)", "—", "Steam + X opens the on-screen keyboard"], ["Undo outside studying", "the Undo button on the message", "D-pad to it · A"], ["This list (also in Settings → Controls)", "?", "View"]]],
  ["Studying", [["Show the answer", "Space", "A"], ["Again · Hard · Good · Easy", "1 · 2 · 3 · 4", "D-pad ← ↓ → ↑"], ["Good (after the answer)", "Space / Enter", "A"], ["Undo", "Ctrl+Z", "X"], ["Card info", "I", "Y"], ["Card menu", "M · right-click the card", "Menu"], ["First-letter hint", "H", "—"], ["Replay sound", "R", "—"], ["Pick an option (multiple choice)", "1–5 · ↑↓ then Enter", "D-pad ↑↓ choose · A confirm"], ["Card menu: move · press · close", "↑↓ · Enter · Esc", "D-pad · A · B"]]],
];

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Keyboard, mouse and gamepad" label="Controls" onClose={onClose} testId="controls" style={{ maxHeight: "92vh", overflow: "auto" }}>
      <p className="small muted" style={{ marginTop: 4 }}>All three work at the same time. With a mouse, hover anything with a hint to read it; right-click a card or a row for its menu (the same as holding it).</p>
      {ROWS.map(([h, rows]) => <div key={h}><h2>{h}</h2>
        <table className="keys"><thead><tr className="keys-row head"><th scope="col">What</th><th scope="col">Keyboard</th><th scope="col">Gamepad</th></tr></thead>
          <tbody>{rows.map(([w, k, g]) => <tr key={w} className="keys-row"><td>{w}</td><td><kbd>{k}</kbd></td><td><kbd>{g}</kbd></td></tr>)}</tbody></table></div>)}
    </Sheet>
  );
}
