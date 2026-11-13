// "Yuzu" card look: one calm reading style laid over every deck's own CSS (AnKing, Rob's, Dellas, Langenscheidt, packs…).
// It keeps the deck's structure and meaning (highlights, tables, images, hint sections) but unifies type, colour,
// spacing and the answer divider so 100k cards from a dozen decks read like one book. Applied inside the card's
// shadow root after the deck CSS; "Deck's own look" in Settings turns it off.
export const SKIN_CSS = `
:host { --c-ink: #1b1710; --c-ink-2: #4a4234; --accent: #c2510b; --accent-soft: rgba(232,98,12,.14); --rule: rgba(27,23,16,.22); --tint: rgba(27,23,16,.05); }
.night_mode, .nightMode { --c-ink: #f1e8d6; --c-ink-2: #c9bba0; --accent: #ffa25a; --accent-soft: rgba(255,140,60,.16); --rule: rgba(255,255,255,.2); --tint: rgba(255,255,255,.05); }
.card, .card.night_mode, .night_mode .card {
  font-family: var(--sans, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif) !important;
  font-size: 19px !important; line-height: 1.55 !important; color: var(--c-ink) !important; background: transparent !important;
  text-align: left !important; padding: 0 !important; margin: 0 !important; max-width: 62ch; letter-spacing: 0 !important;
  -webkit-font-smoothing: antialiased;
}
.card.yz-short { text-align: center !important; font-size: 24px !important; margin: 0 auto !important; }
.card * { font-family: inherit !important; letter-spacing: inherit; }
.card code, .card pre, .card kbd { font-family: ui-monospace, Menlo, Consolas, monospace !important; font-size: .88em; }
.card font[size], .card [style*="font-size"] { font-size: inherit !important; }
.card [style*="background"]:not(img) { background-color: var(--tint) !important; }
.card b, .card strong { font-weight: 700; }
.card i, .card em { color: var(--c-ink-2); }
.card u { text-decoration-color: var(--accent); text-underline-offset: 3px; }
.card a { color: var(--accent) !important; }
/* cloze: an orange answer with a 2-px underline, a bracket where it is still hidden */
.card .cloze, .card .cloze b, .card .cloze u, .card .cloze i, .card .cloze font, .card .cloze span { color: var(--accent) !important; font-weight: 700 !important; }
.card .cloze { background: var(--accent-soft) !important; padding: 0 3px; box-shadow: inset 0 -2px 0 var(--accent); border-radius: 0 !important; }
.card .cloze-inactive, .card .cloze-inactive * { color: inherit !important; background: none !important; box-shadow: none !important; font-weight: inherit !important; }
/* answer divider and the deck's "extra" sections */
.card hr, .card hr#answer { border: 0 !important; height: 0 !important; border-top: 2px dashed var(--rule) !important; margin: 18px 0 14px !important; background: none !important; }
.card #extra, .card .extra, .card #back, .card .back, .card [id$="Extra"], .card .hints, .card #hint, .card .hint-container {
  font-size: .9em !important; color: var(--c-ink-2) !important; border-left: 4px solid var(--accent) !important; background: var(--tint) !important;
  padding: 8px 12px !important; margin: 12px 0 0 !important; border-radius: 0 !important; text-align: left !important;
}
.card .src, .card #source, .card .source, .card .copyright { font-size: 12px !important; color: var(--c-ink-2) !important; opacity: .8; margin-top: 12px !important; }
/* AnKing-style hint buttons become tap-to-open sections (see render.ts) */
.card details.yz-hint > summary { color: var(--accent) !important; border-color: var(--accent) !important; font-size: 13px !important; font-weight: 700; background: transparent; }
.card details.yz-hint .hints { border-left: 4px solid var(--accent) !important; }
.card .button-general, .card #pic, .card #tags-container { display: none !important; }
/* lists, tables, images */
.card ul, .card ol { padding-left: 1.3em !important; margin: 6px 0 !important; text-align: left !important; }
.card li { margin: 3px 0 !important; }
.card table { border-collapse: collapse !important; margin: 10px 0 !important; font-size: .86em !important; width: auto !important; max-width: 100%; display: block; overflow-x: auto; }
.card td, .card th { border: 1px solid var(--rule) !important; padding: 5px 8px !important; background: transparent !important; color: inherit !important; text-align: left !important; vertical-align: top; }
.card th { background: var(--tint) !important; font-weight: 700; }
.card img { box-sizing: border-box; max-width: 100% !important; height: auto !important; border: 2px solid var(--rule); border-radius: 0 !important; margin: 8px auto !important; display: block; background: #fff; }
.card .typeans, .card input { font-family: inherit !important; }
/* language cards: the deck's big headword stays big */
.card .word, .card .german, .card .front-word, .card #word { font-size: 1.35em !important; font-weight: 700; }
`;

/** Center a card whose visible text is short (single words, vocabulary) — long text reads better left-aligned. */
export function isShortCard(html: string): boolean {
  const text = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 0 && text.length <= 48 && !/<(table|ul|ol|img)\b/i.test(html);
}
