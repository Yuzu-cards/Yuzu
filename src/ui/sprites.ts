// Pixel art, drawn by hand. One character per pixel; "." is transparent.
// The yuzu sprite is the app's logo: header, loading screen and (via scripts/icons.mjs) the home-screen icons.
export const PALETTE: Record<string, string> = {
  K: "#3a2a07", // outline
  Y: "#f2d34b", // rind
  H: "#fff3a8", // highlight
  S: "#c9971c", // shade
  P: "#e0b52f", // pores
  G: "#8fbf4e", // leaf
  D: "#4f7428", // leaf dark
  B: "#6b4a1f", // stem
};

/** The Yuzu crest at 20 × 20 for the Arcade look (26/11/2026): G and # gold, K a hole (a pore or the sheen). */
export const CREST_PX = [
  ".......######.......",
  ".....##......##.....",
  "...##..........##...",
  "..#.##.#....#.##.#..",
  "..#..###....###..#..",
  ".#.....######.....#.",
  ".#........#.......#.",
  "#......#######.....#",
  "#.....##########...#",
  "#....#..#########..#",
  "#...#.####.#######.#",
  "#...##########.###.#",
  "#...###.##########.#",
  ".#..#######.###.#.#.",
  ".#...###.########.#.",
  "..#...######.###.#..",
  "..#.....#######..#..",
  "...##..........##...",
  ".....##......##.....",
  ".......######.......",
];

/** Pixels of a sprite as [x, y, color] triples. */
export function pixels(rows: string[], palette = PALETTE): [number, number, string][] {
  const out: [number, number, string][] = [];
  rows.forEach((row, y) => [...row].forEach((ch, x) => { const c = palette[ch]; if (c) out.push([x, y, c]); }));
  return out;
}
