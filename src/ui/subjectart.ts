// Subject designs (1.10.0): a card about the heart looks like one. Drawn by the app at display time from the card's body
// system (the auto::System tag, the same one that colours the spine) — no card is edited, nothing syncs, and it switches
// off in a tap. Line art in the system's colour lives in the right-hand margin (and, in "Rich", a band along the foot),
// never under the text. Decks shown in their own look are left alone.
//
// Each motif is a vertical tile (48 × 160) that repeats down the margin, plus an optional horizontal foot tile (160 × 22).
// Stroke-only, round caps, so they read as fine pen drawings at any size.

type Art = { strip: string; foot?: string; head?: string };
const T = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" stroke="#C" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ART: Record<string, Art> = {
  // arteries branching into capillaries; an ECG trace along the foot
  Cardiovascular: {
    strip: T(48, 160, `<path d="M30 0 C28 30 34 50 30 80 C26 110 32 130 30 160" stroke-width="3"/><path d="M30 28 C20 34 14 40 8 52"/><path d="M14 42 C10 40 6 41 3 38"/><path d="M8 52 C6 58 7 62 4 66"/><path d="M31 92 C40 98 43 104 46 114" stroke-width="2"/><path d="M42 104 C46 104 47 100 48 98"/><path d="M46 114 C44 120 45 124 47 128"/><path d="M29 130 C20 134 16 140 12 150"/><circle cx="4" cy="66" r="1.2"/><circle cx="47" cy="128" r="1.2"/>`),
    foot: T(160, 22, `<path d="M0 12 H40 L46 12 L50 6 L54 12 H62 L66 15 L70 1 L75 21 L79 12 H92 C98 12 100 7 106 7 C112 7 114 12 120 12 H160"/>`),
  },
  // the bronchial tree ending in alveoli
  Respiratory: {
    strip: T(48, 160, `<path d="M26 0 V44" stroke-width="3"/><path d="M26 44 C20 56 14 62 10 76"/><path d="M26 44 C32 58 38 64 40 80"/><path d="M10 76 C8 84 6 88 4 94"/><path d="M10 76 C14 84 16 88 18 96"/><path d="M40 80 C38 88 36 92 34 98"/><path d="M40 80 C43 88 45 92 46 98"/><g stroke-width="1.2"><circle cx="4" cy="98" r="3"/><circle cx="18" cy="100" r="3"/><circle cx="34" cy="102" r="3"/><circle cx="46" cy="102" r="2.5"/></g><path d="M26 112 V160" stroke-width="3" opacity=".35"/>`),
    foot: T(160, 22, `<path d="M0 11 C20 3 40 3 60 11 C80 19 100 19 120 11 C140 3 150 5 160 11"/>`),
  },
  // a neuron: dendrites, soma, a myelinated axon
  Neurology: {
    strip: T(48, 160, `<circle cx="24" cy="30" r="6.5" fill="#P" fill-opacity=".55" stroke="#P" stroke-width="1.6"/><circle cx="24" cy="30" r="2" fill="#P"/><path d="M19 26 L8 14 M12 18 L6 20 M20 24 L18 8 M28 25 L36 10 M33 15 L40 14 M30 32 L44 34"/><path d="M24 36 V160" stroke-width="1.4"/><g stroke="#P" stroke-width="5" opacity=".6"><path d="M24 50 V66"/><path d="M24 74 V90"/><path d="M24 98 V114"/><path d="M24 122 V138"/></g><path d="M24 150 L16 158 M24 150 L32 158"/><circle cx="16" cy="158" r="1.6" fill="#P" stroke="#P"/><circle cx="32" cy="158" r="1.6" fill="#P" stroke="#P"/>`),
    foot: T(160, 22, `<path d="M0 14 H50 L56 4 L62 18 L66 14 H160"/>`),
  },
  // intestinal villi
  Gastrointestinal: {
    strip: T(48, 160, `<path d="M46 0 V160" stroke-width="2.4"/><path d="M46 8 C30 8 24 14 24 20 C24 26 30 30 46 30"/><path d="M46 40 C26 40 18 47 18 54 C18 61 26 66 46 66"/><path d="M46 76 C32 76 26 82 26 88 C26 94 32 98 46 98"/><path d="M46 108 C24 108 16 116 16 124 C16 132 24 136 46 136"/><path d="M46 144 C34 144 30 148 30 152 C30 156 34 160 46 160"/><g stroke-width="1" opacity=".6"><path d="M38 14 V26 M33 48 V60 M37 82 V94 M30 114 V130"/></g>`),
  },
  // a nephron: glomerulus, tubule, the loop of Henle
  Renal: {
    strip: T(48, 160, `<circle cx="16" cy="18" r="9"/><path d="M11 14 C15 10 19 22 22 16 M10 21 C14 18 18 26 21 22" stroke-width="1.1"/><path d="M24 22 C34 26 38 34 30 40 C22 46 30 54 36 58 V124 C36 136 22 136 22 124 V66"/><path d="M22 66 C16 62 12 70 18 74 C24 78 14 86 10 92 V160" stroke-width="1.3"/>`),
  },
  // steroid rings and a hormone droplet
  Endocrine: {
    strip: T(48, 160, `<path d="M14 10 L24 4 L34 10 V22 L24 28 L14 22 Z"/><path d="M24 28 L34 34 V46 L24 52 L14 46 V34 Z"/><path d="M34 46 L44 52 V64 L34 70 L24 64 V52"/><path d="M14 46 L4 52 V58" /><path d="M24 92 C30 102 34 108 34 114 A10 10 0 0 1 14 114 C14 108 18 102 24 92 Z" stroke-width="1.4"/><circle cx="24" cy="140" r="2"/><circle cx="16" cy="152" r="1.4"/><circle cx="32" cy="150" r="1.6"/>`),
  },
  // red cells, a few white
  "Hematology & Oncology": {
    strip: T(48, 160, `<ellipse cx="18" cy="20" rx="11" ry="9"/><ellipse cx="18" cy="20" rx="5" ry="3.5" stroke-width="1"/><ellipse cx="34" cy="52" rx="10" ry="8"/><ellipse cx="34" cy="52" rx="4.5" ry="3" stroke-width="1"/><circle cx="14" cy="88" r="10" stroke-width="1.4"/><path d="M9 86 C12 82 16 92 19 88 M10 92 C14 90 16 94 19 92" stroke-width="1.1"/><ellipse cx="30" cy="124" rx="11" ry="9"/><ellipse cx="30" cy="124" rx="5" ry="3.5" stroke-width="1"/><ellipse cx="12" cy="150" rx="8" ry="6" stroke-width="1.3"/>`),
  },
  // rods and cocci, a flagellum
  "Infectious Disease": {
    strip: T(48, 160, `<rect x="8" y="10" width="26" height="11" rx="5.5"/><path d="M34 15 C40 10 42 22 48 16" stroke-width="1.1"/><g><circle cx="14" cy="44" r="4"/><circle cx="22" cy="46" r="4"/><circle cx="30" cy="44" r="4"/><circle cx="38" cy="48" r="4"/></g><rect x="16" y="70" width="11" height="26" rx="5.5" transform="rotate(20 21 83)"/><path d="M10 116 C14 110 18 122 22 116 C26 110 30 122 34 116 C38 110 42 122 46 116"/><circle cx="16" cy="144" r="4.5"/><circle cx="30" cy="148" r="4.5"/>`),
  },
  // a long bone with its spongy end
  "Musculoskeletal & Trauma": {
    strip: T(48, 160, `<path d="M14 6 C8 6 6 14 12 18 C10 22 12 28 18 26 V134 C12 132 10 138 12 142 C6 146 8 154 14 154 C18 154 20 150 22 148 C24 150 26 154 30 154 C36 154 38 146 32 142 C34 138 32 132 26 134 V26 C32 28 34 22 32 18 C38 14 36 6 30 6 C26 6 24 10 22 12 C20 10 18 6 14 6 Z" stroke-width="1.5"/><g stroke-width=".9" opacity=".7"><path d="M14 12 L20 18 M20 10 L28 18 M26 10 L32 16 M14 146 L20 140 M22 150 L30 142"/></g>`),
  },
  // skin layers and a follicle
  Dermatology: {
    strip: T(48, 160, `<path d="M44 0 C38 20 46 40 40 60 C34 80 44 100 38 120 C32 140 42 150 40 160" stroke-width="2"/><path d="M30 0 C26 20 32 40 28 60 C24 80 32 100 28 120 C24 140 30 150 28 160" stroke-width="1.2" opacity=".7"/><path d="M14 40 V96" /><path d="M14 96 C8 96 8 106 14 106 C20 106 20 96 14 96"/><path d="M14 40 C14 30 18 22 24 16" stroke-width="1.1"/><g stroke-width="1" opacity=".6"><circle cx="8" cy="130" r="2"/><circle cx="18" cy="138" r="2"/><circle cx="10" cy="148" r="2"/></g>`),
  },
  // an ovum with its corona
  "Obstetrics & Gynecology": {
    strip: T(48, 160, `<circle cx="24" cy="44" r="14"/><circle cx="24" cy="44" r="5" stroke-width="1.2"/><g stroke-width="1"><circle cx="24" cy="24" r="2"/><circle cx="38" cy="32" r="2"/><circle cx="42" cy="48" r="2"/><circle cx="34" cy="62" r="2"/><circle cx="14" cy="62" r="2"/><circle cx="6" cy="46" r="2"/><circle cx="10" cy="30" r="2"/></g><path d="M24 96 C14 96 10 108 18 114 C26 120 34 112 30 104" stroke-width="1.4"/><path d="M24 130 C30 140 30 150 24 160" stroke-width="1.2"/>`),
  },
  // building blocks and a star
  Pediatrics: {
    strip: T(48, 160, `<rect x="8" y="14" width="18" height="18"/><rect x="22" y="38" width="18" height="18"/><path d="M14 20 V26 M18 20 V26 M14 23 H18" stroke-width="1.2"/><path d="M24 84 L27 92 L36 92 L29 97 L32 106 L24 100 L16 106 L19 97 L12 92 L21 92 Z" stroke-width="1.3"/><circle cx="18" cy="134" r="8"/><path d="M14 136 C16 139 20 139 22 136" stroke-width="1.1"/><circle cx="15" cy="131" r=".8"/><circle cx="21" cy="131" r=".8"/>`),
  },
  // ripples of thought
  Psychiatry: {
    strip: T(48, 160, `<path d="M24 20 C12 20 8 36 18 40 C10 48 18 60 28 54 C34 62 46 54 40 44 C48 36 40 22 30 26 C30 20 26 20 24 20 Z" stroke-width="1.4"/><path d="M20 32 C24 30 26 36 30 34 M22 46 C26 44 28 48 32 46" stroke-width="1"/><g stroke-width="1.1" opacity=".75"><path d="M10 96 C18 88 30 88 38 96"/><path d="M6 108 C18 96 30 96 42 108"/><path d="M2 120 C18 104 30 104 46 120"/></g>`),
  },
  // a benzene ring and a drop
  "Toxicology & Environmental": {
    strip: T(48, 160, `<path d="M24 8 L36 15 V29 L24 36 L12 29 V15 Z"/><path d="M24 13 L31 17 M17 27 L24 31 M31 27 V18" stroke-width="1"/><path d="M36 29 L44 34 M24 36 V46 M12 15 L4 10"/><path d="M24 80 C32 92 36 98 36 106 A12 12 0 0 1 12 106 C12 98 16 92 24 80 Z"/><path d="M18 106 A6 6 0 0 0 24 112" stroke-width="1.1"/><path d="M10 140 H38 M14 148 H34 M18 156 H30" stroke-width="1.2"/>`),
  },
  // an eye and sound waves
  "ENT & Eye": {
    strip: T(48, 160, `<path d="M4 30 C14 16 34 16 44 30 C34 44 14 44 4 30 Z"/><circle cx="24" cy="30" r="7"/><circle cx="24" cy="30" r="2.5" stroke-width="1.2"/><g stroke-width="1.3"><path d="M20 96 C24 100 24 108 20 112"/><path d="M26 90 C33 98 33 110 26 118"/><path d="M32 84 C42 96 42 112 32 124"/></g><path d="M8 100 C8 94 14 92 14 98 C14 104 10 104 10 110" stroke-width="1.6"/>`),
  },
  // antibodies
  Immunology: {
    strip: T(48, 160, `<path d="M24 50 V30 M24 30 L14 18 M24 30 L34 18 M14 18 L10 10 M34 18 L38 10 M16 24 L11 17 M32 24 L37 17" stroke-width="1.7"/><path d="M20 120 V100 M20 100 L10 88 M20 100 L30 88 M10 88 L6 80 M30 88 L34 80" stroke-width="1.7"/><circle cx="38" cy="78" r="5" stroke-width="1.2"/><path d="M35 74 L41 82 M41 74 L35 82" stroke-width=".9"/>`),
  },
  // German decks: a cathedral — tracery windows and quatrefoils in gold, an arcade frieze along the foot, a gilt rule on top
  German: {
    strip: T(48, 160, `<path d="M10 70 V30 C10 16 24 8 24 8 C24 8 38 16 38 30 V70 Z" stroke-width="1.5"/><path d="M24 8 V70 M10 44 H38" stroke-width="1"/><path d="M16 40 C16 30 24 24 24 24 C24 24 32 30 32 40" stroke="#P" stroke-width="1.2"/><circle cx="24" cy="54" r="5" stroke="#P" stroke-width="1.2"/><g stroke-width="1.3"><circle cx="24" cy="100" r="9"/><circle cx="24" cy="91" r="4.5" stroke="#P"/><circle cx="33" cy="100" r="4.5" stroke="#P"/><circle cx="24" cy="109" r="4.5" stroke="#P"/><circle cx="15" cy="100" r="4.5" stroke="#P"/></g><path d="M24 124 L28 136 L24 148 L20 136 Z" stroke-width="1.1"/><path d="M24 148 V160" stroke-width="1"/>`),
    foot: T(160, 22, `<path d="M0 20 H160" stroke-width="1"/><g stroke-width="1.2"><path d="M4 20 V12 C4 6 10 2 10 2 C10 2 16 6 16 12 V20"/><path d="M24 20 V12 C24 6 30 2 30 2 C30 2 36 6 36 12 V20"/><path d="M44 20 V12 C44 6 50 2 50 2 C50 2 56 6 56 12 V20"/><path d="M64 20 V12 C64 6 70 2 70 2 C70 2 76 6 76 12 V20"/><path d="M84 20 V12 C84 6 90 2 90 2 C90 2 96 6 96 12 V20"/><path d="M104 20 V12 C104 6 110 2 110 2 C110 2 116 6 116 12 V20"/><path d="M124 20 V12 C124 6 130 2 130 2 C130 2 136 6 136 12 V20"/><path d="M144 20 V12 C144 6 150 2 150 2 C150 2 156 6 156 12 V20"/></g><g stroke="#P"><circle cx="10" cy="12" r="1.6"/><circle cx="30" cy="12" r="1.6"/><circle cx="50" cy="12" r="1.6"/><circle cx="70" cy="12" r="1.6"/><circle cx="90" cy="12" r="1.6"/><circle cx="110" cy="12" r="1.6"/><circle cx="130" cy="12" r="1.6"/><circle cx="150" cy="12" r="1.6"/></g>`),
    head: T(160, 14, `<path d="M80 1 L84 7 L80 13 L76 7 Z" fill="#P" stroke="#P" stroke-width=".8"/><circle cx="70" cy="7" r="1.3" fill="#C"/><circle cx="90" cy="7" r="1.3" fill="#C"/>`),
  },
  // language decks: a ruled notebook margin
  Languages: {
    strip: T(48, 160, `<path d="M10 0 V160" stroke="#c24d4d" stroke-width="1.4" opacity=".7"/><g stroke-width="1" opacity=".55"><path d="M16 20 H48 M16 40 H48 M16 60 H48 M16 80 H48 M16 100 H48 M16 120 H48 M16 140 H48 M16 160 H48"/></g>`),
  },
};
/** Systems that have a design. */
export const ART_SYSTEMS = Object.keys(ART).filter((k) => !["Languages", "German", "Mephisto"].includes(k));
/** The deck-wide designs that win over a card's system: German decks (gothic), other language decks (a notebook). */
export type DeckTheme = "German" | "Languages" | "none" | null;
/** "none": the Mephisto deck, which carries its own design inside its cards — nothing is drawn over it. */
export function deckTheme(source: string, lang: string | null): DeckTheme {
  if (/(^|::)\s*Mephisto/i.test(source)) return "none";
  if (lang && /^de\b/i.test(lang)) return "German";
  return lang ? "Languages" : null;
}
/** Fixed colours for the deck designs (the spine follows them): gilt and ultramarine; blood and candlelight. */
export const THEME_COLORS: Record<string, { main: string; accent: string; spine: string }> = {
  German: { main: "#B8892C", accent: "#3D5FB0", spine: "#2F4A8A" },
  Languages: { main: "#5f7bb0", accent: "#c24d4d", spine: "#5f7bb0" },
};

/** A second colour for parts of a drawing (neurons: gold dendrites and axon, pink cell body and myelin). */
const ACCENT: Record<string, string> = { Neurology: "#EE9DB6", German: THEME_COLORS.German?.accent ?? "#3D5FB0" };
const enc = (svg: string, color: string, accent = color) => `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/#P/g, accent).replace(/#C/g, color))}")`;
const cache = new Map<string, { key: string; strip: string; foot?: string; head?: string } | null>();
/** The CSS images for a card: its deck's design (Mephisto, German, another language) first, else its body system's, else none. */
export function artFor(system: string | undefined, theme: DeckTheme, color: string): { key: string; strip: string; foot?: string; head?: string } | null {
  if (theme === "none") return null;
  const key = theme ?? (system && ART[system] ? system : ""); if (!key) return null;
  const col = theme ? THEME_COLORS[theme].main : color;
  const k = key + "|" + col; if (cache.has(k)) return cache.get(k)!;
  const a = ART[key]; const out = { key, strip: enc(a.strip, col, ACCENT[key]), ...(a.foot ? { foot: enc(a.foot, col, ACCENT[key]) } : {}), ...(a.head ? { head: enc(a.head, col, ACCENT[key]) } : {}) };
  cache.set(k, out); return out;
}
export type ArtLevel = "off" | "subtle" | "rich";

/** Inside the card (after the Yuzu reading style) for the German design: type, cloze and extras. Readable first: the body
 *  stays a book face (EB Garamond), only a vocab card's headword is set in blackletter (UnifrakturMaguntia). */
export const THEME_CSS: Record<string, string> = {
  German: `
:host { --accent: #2F4A8A; --accent-soft: rgba(61,95,176,.12); --gild: #8a6518; --rule: rgba(138,101,24,.45); }
.night_mode, .nightMode { --accent: #A9BEFF; --accent-soft: rgba(169,190,255,.14); --gild: #E2BE6A; --rule: rgba(226,190,106,.4); }
.card, .card.night_mode, .night_mode .card { font-family: "EB Garamond", Garamond, Georgia, serif !important; font-size: 21px !important; line-height: 1.5 !important; }
.card .vw { font-family: "UnifrakturMaguntia", "EB Garamond", serif !important; font-size: 2em !important; font-weight: 400 !important; line-height: 1.15 !important; letter-spacing: .01em; }
.card .va { font-family: "EB Garamond", serif !important; font-style: italic; color: var(--gild) !important; font-weight: 600 !important; opacity: 1 !important; }
.card .vm { font-variant: small-caps; letter-spacing: .02em; }
.card .vex { font-style: italic; border-left: 2px solid var(--rule); padding-left: 10px; }
.card .cloze { box-shadow: inset 0 -2px 0 var(--gild) !important; }
.card hr, .card hr#answer { border-top: 1px solid var(--rule) !important; }
.card #extra, .card .extra, .card .hints { border-left-color: var(--gild) !important; font-style: italic; }
.yz-sound { color: var(--gild) !important; }
`,
};
