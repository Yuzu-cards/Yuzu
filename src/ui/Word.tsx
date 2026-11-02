// Hold a word on a card (Mephisto's pattern): the word under the finger, with ways to look it up, find it in your own
// cards, copy, share, or hand it to the phone's own selection toolbar. Works inside the card's shadow root.
import { useMemo } from "react";
import { store } from "../lib/store";
import { ActionSheet, snackbar } from "./kit";

export interface WordHit { word: string; sentence: string; range: Range }

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;
/** The word at a viewport point inside `root` (a shadow root or document), or null when the finger is not on text. */
export function wordAt(root: Document | ShadowRoot, x: number, y: number): WordHit | null {
  const el = root.elementFromPoint(x, y); if (!el) return null;
  // Only text nodes of this element and its descendants (an image or a button is not a word).
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n: Node | null; let seen = 0;
  while ((n = walker.nextNode()) && seen++ < 400) {
    const t = n.textContent ?? ""; if (!t.trim()) continue;
    const probe = document.createRange(); probe.selectNodeContents(n);
    const rs = probe.getClientRects(); let near = false;
    for (const r of rs) if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) { near = true; break; }
    if (!near) continue;
    for (const m of t.matchAll(WORD)) {
      const r = document.createRange(); r.setStart(n, m.index!); r.setEnd(n, m.index! + m[0].length);
      for (const b of r.getClientRects()) if (x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1) {
        const word = m[0].replace(/^['’\-]+|['’\-]+$/g, ""); if (word.length < 2 || !/\p{L}/u.test(word)) return null;
        const whole = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        const at = whole.indexOf(word); const from = Math.max(0, whole.lastIndexOf(". ", at) + 1); const to = whole.indexOf(". ", at + word.length);
        return { word, sentence: whole.slice(from, to < 0 ? Math.min(whole.length, at + 140) : to + 1).trim(), range: r };
      }
    }
  }
  return null;
}

const looksGerman = (s: string) => /[äöüß]/i.test(s) || /\b(der|die|das|und|ist|nicht|mit|ein|eine)\b/i.test(s);

export function WordSheet({ hit, deckPath, noteId, onClose, onSearch, onMenu }: { hit: WordHit; deckPath: string; noteId?: string; onClose: () => void; onSearch?: (q: string) => void; onMenu: () => void }) {
  const w = hit.word; const lower = w.toLowerCase();
  const n = useMemo(() => { let c = 0; for (const note of store.notes.values()) if (note.id !== noteId && store.searchText(note).includes(lower)) c++; return c; }, [lower, noteId]);
  const german = /^Language|German|Deutsch/i.test(deckPath) || looksGerman(hit.sentence);
  const open = (url: string) => { window.open(url, "_blank", "noopener"); };
  const select = () => {
    try { const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(hit.range); snackbar("Selected — the phone's own menu can take it from here"); } catch { snackbar("Couldn't select it here"); }
  };
  return (
    <ActionSheet title={w} sub={hit.sentence !== w ? `“${hit.sentence.length > 140 ? hit.sentence.slice(0, 140) + "…" : hit.sentence}”` : undefined} onClose={onClose} items={[
      { label: n ? `In ${n.toLocaleString()} other card${n === 1 ? "" : "s"}` : "Not in any other card", hint: n ? "Library" : undefined, disabled: !n || !onSearch, onClick: () => onSearch?.(w) },
      german ? { label: "Translate", hint: "Google Translate", onClick: () => open(`https://translate.google.com/?sl=de&tl=en&text=${encodeURIComponent(w)}&op=translate`) }
             : { label: "Define", hint: "Google", onClick: () => open(`https://www.google.com/search?q=define+${encodeURIComponent(w)}`) },
      { label: "Wiktionary", onClick: () => open(`https://${german ? "de" : "en"}.wiktionary.org/wiki/${encodeURIComponent(w)}`) },
      { label: "Copy", onClick: async () => { try { await navigator.clipboard.writeText(w); snackbar("Copied"); } catch { select(); } } },
      typeof navigator.share === "function" && { label: "Share", hint: "any translator app", onClick: () => navigator.share({ text: w }).catch(() => {}) },
      { label: "Select", hint: "phone's own menu", onClick: select },
      { label: "Card menu…", onClick: onMenu },
    ]} />
  );
}
