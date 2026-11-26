// 12×12 bitmap icons drawn in currentColor, and the pixel yuzu logo. Each "#" is one pixel; runs are merged into rects.
import { useId } from "react";
import { CREST_PX } from "./sprites";
import { CREST } from "./crest.generated";
const CREST_RECTS = bitmap(CREST_PX); // gold pixels only: the ink pixels are holes

function bitmap(rows: string[]) {
  const rects: [number, number, number][] = [];
  rows.forEach((row, y) => { let x = 0; while (x < row.length) { if (row[x] === "#") { const x0 = x; while (row[x] === "#") x++; rects.push([x0, y, x - x0]); } else x++; } });
  return rects;
}
function make(rows: string[], label?: string) {
  const rects = bitmap(rows);
  return function Icon({ size = 24 }: { size?: number }) {
    return (
      <svg viewBox="0 0 12 12" width={size} height={size} shapeRendering="crispEdges" aria-hidden={label ? undefined : true} aria-label={label} fill="currentColor" className="px-icon">
        {rects.map(([x, y, w], i) => <rect key={i} x={x} y={y} width={w} height={1} />)}
      </svg>
    );
  };
}

/**
 * The Yuzu crest (26/11/2026): a lopsided, knobbly yuzu with its winged leaves in a ring, Japanese family-crest style
 * (scripts/crest.mjs draws it once). The vector crest in the Clean and Paper looks, a hand-drawn 20 × 20 pixel crest in
 * Arcade; the pores and the sheen are real holes, so it sits on any background. Colour: `currentColor` (gold; deeper on Paper).
 */
export function YuzuMark({ size = 28 }: { size?: number }) {
  const id = "crest" + useId().replace(/[^a-z0-9]/gi, "");
  const lv = (sx: number) => <g transform={`translate(${CREST.leafAt[0]} ${CREST.leafAt[1]}) scale(${sx} 1) rotate(-14) scale(.9)`}>
    <path d={CREST.leaf.stalk} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /><path d={CREST.leaf.wing} fill="currentColor" />
    <path d={CREST.leaf.blade} fill="currentColor" mask={`url(#${id}-rib)`} /></g>;
  return (
    <span className="yuzu-mark" style={{ width: size, height: size }} role="img" aria-label="Yuzu">
      <svg className="mark-vec" viewBox="0 0 100 100" width={size} height={size} aria-hidden>
        <defs><mask id={id} maskUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120"><rect x="-10" y="-10" width="120" height="120" fill="#fff" />
          {CREST.pores.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#000" />)}
          <path d={CREST.sheen} stroke="#000" strokeWidth="2.6" fill="none" strokeLinecap="round" /></mask>
          {/* the midrib, cut out of each blade (the blade's own coordinates: the mask follows its transform) */}
          <mask id={`${id}-rib`} maskUnits="userSpaceOnUse" x="-5" y="-25" width="50" height="30"><rect x="-5" y="-25" width="50" height="30" fill="#fff" /><path d={CREST.leaf.rib} stroke="#000" strokeWidth="1" fill="none" /></mask></defs>
        <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="5" />
        <g mask={`url(#${id})`}><path d={CREST.fruit} fill="currentColor" /><path d={CREST.calyx} fill="currentColor" /></g>
        <path d={CREST.stalk} fill="currentColor" />
        <g className="mark-leaves">{lv(1)}{lv(-1)}</g>
      </svg>
      <svg className="mark-px" viewBox="0 0 20 20" width={size} height={size} shapeRendering="crispEdges" aria-hidden>
        {CREST_RECTS.map(([x, y, w], i) => <rect key={i} x={x} y={y} width={w} height={1} fill="currentColor" />)}
      </svg>
    </span>
  );
}

export const IconToday = make([
  "....####....",
  "..##....##..",
  ".#........#.",
  ".#...#....#.",
  "#....#.....#",
  "#....#.....#",
  "#....####..#",
  "#..........#",
  ".#........#.",
  ".#........#.",
  "..##....##..",
  "....####....",
]);
export const IconLibrary = make([
  "............",
  "#####.......",
  "#...#.......",
  "#...#######.",
  "#.........#.",
  "###########.",
  "#.........#.",
  "#.........#.",
  "#.........#.",
  "#.........#.",
  "###########.",
  "............",
]);
export const IconProgress = make([
  "............",
  ".......##...",
  ".......##...",
  ".......##...",
  "...##..##...",
  "...##..##...",
  "...##..##.##",
  "...##..##.##",
  "##.##..##.##",
  "##.##..##.##",
  "############",
  "............",
]);
export const IconSettings = make([
  ".....##.....",
  "..#..##..#..",
  ".###.##.###.",
  "..########..",
  "..###..###..",
  "####....####",
  "####....####",
  "..###..###..",
  "..########..",
  ".###.##.###.",
  "..#..##..#..",
  ".....##.....",
]);
export const IconClose = make([
  "............",
  ".##......##.",
  ".###....###.",
  "..###..###..",
  "...######...",
  "....####....",
  "....####....",
  "...######...",
  "..###..###..",
  ".###....###.",
  ".##......##.",
  "............",
]);
export const IconUndo = make([
  "............",
  "...#........",
  "..##........",
  ".#########..",
  "..##......#.",
  "...#.......#",
  "...........#",
  "...........#",
  "..........#.",
  "....######..",
  "............",
  "............",
]);
export const IconFlag = make([
  "............",
  ".##########.",
  ".##.......#.",
  ".##......#..",
  ".##.....#...",
  ".##......#..",
  ".##.......#.",
  ".##########.",
  ".##.........",
  ".##.........",
  ".##.........",
  ".##.........",
]);
export const IconPause = make([
  "............",
  "..###..###..",
  "..###..###..",
  "..###..###..",
  "..###..###..",
  "..###..###..",
  "..###..###..",
  "..###..###..",
  "..###..###..",
  "..###..###..",
  "..###..###..",
  "............",
]);
export const IconChevron = make([
  "............",
  "...##.......",
  "....##......",
  ".....##.....",
  "......##....",
  ".......##...",
  ".......##...",
  "......##....",
  ".....##.....",
  "....##......",
  "...##.......",
  "............",
]);
export const IconPlay = make([
  "............",
  "..##........",
  "..####......",
  "..######....",
  "..########..",
  "..#########.",
  "..#########.",
  "..########..",
  "..######....",
  "..####......",
  "..##........",
  "............",
]);
export const IconFlame = make([
  ".....#......",
  ".....##.....",
  "....###.....",
  "....####....",
  "...######...",
  "..###.####..",
  "..##...###..",
  ".###....###.",
  ".##..#...##.",
  ".##.###..##.",
  "..##...###..",
  "...######...",
]);
export const IconInfo = make([
  "....####....",
  "..##....##..",
  ".#...##...#.",
  ".#...##...#.",
  "#..........#",
  "#...###....#",
  "#....##....#",
  "#....##....#",
  ".#...##...#.",
  ".#..####..#.",
  "..##....##..",
  "....####....",
]);
export const IconPin = make([
  "....####....",
  "....####....",
  "....#..#....",
  "....#..#....",
  "...#....#...",
  "..#......#..",
  "..########..",
  ".....##.....",
  ".....##.....",
  ".....##.....",
  ".....##.....",
  "............",
]);
export const IconMore = make([
  "............",
  "............",
  "............",
  "............",
  "............",
  ".##..##..##.",
  ".##..##..##.",
  "............",
  "............",
  "............",
  "............",
  "............",
]);
export const IconEdit = make([
  "........##..",
  ".......####.",
  "......#.####",
  ".....#...##.",
  "....#...#...",
  "...#...#....",
  "..#...#.....",
  ".#...#......",
  "#...#.......",
  "#..#........",
  "####........",
  "............",
]);
export const IconSound = make([
  "............",
  ".....#......",
  "....##...#..",
  "...###....#.",
  "######..#.#.",
  "######...#.#",
  "######...#.#",
  "######..#.#.",
  "...###....#.",
  "....##...#..",
  ".....#......",
  "............",
]);

// Settings chapters (25/11/2026): look, studying, cards and files, sync and data, help
export const IconBrush = make([
  "..........##",
  ".........###",
  "........###.",
  ".......###..",
  "......###...",
  ".....###....",
  "....##......",
  "..###.......",
  ".####.......",
  ".####.......",
  "####........",
  "###.........",
]);
export const IconCap = make([
  "............",
  ".....##.....",
  "...######...",
  ".##########.",
  "############",
  ".##########.",
  "..########.#",
  "..#......#.#",
  "..#......#.#",
  "...######..#",
  "..........##",
  "............",
]);
export const IconCards = make([
  "...#######..",
  "...#.....#..",
  "#######..#..",
  "#.....#..#..",
  "#.###.#..#..",
  "#.....#..#..",
  "#.###.#..#..",
  "#.....#..#..",
  "#.##..#####.",
  "#.....#.....",
  "#######.....",
  "............",
]);
export const IconCloud = make([
  "............",
  "....####....",
  "...#....#...",
  ".###.....#..",
  "#........##.",
  "#..........#",
  "#..........#",
  ".##########.",
  "............",
  ".....##.....",
  "....####....",
  ".....##.....",
]);
export const IconHelp = make([
  "...######...",
  "..#......#..",
  ".#...##...#.",
  "#...#..#...#",
  "#......#...#",
  "#.....#....#",
  "#....#.....#",
  "#....#.....#",
  ".#........#.",
  "..#..#...#..",
  "...######...",
  "............",
]);
