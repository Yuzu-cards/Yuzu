// The Yuzu crest (26/11/2026): a Japanese family-crest yuzu — a lopsided, knobbly fruit with a spiral of pores and a sheen,
// a five-pointed calyx, a short curved stalk and two winged leaves, inside a ring. One drawing, written out as
//   src/ui/crest.generated.ts  (the shapes, for the in-app mark: colours come from CSS)
//   public/icons/crest.svg     (gold on ink, for the icons; scripts/icons.mjs turns it into PNGs)
import fs from "node:fs";
const f = (n) => +n.toFixed(2);
function rAsym(t) {
  const a = t + Math.PI / 2;
  const base = (41 * 33) / Math.sqrt((33 * Math.cos(t)) ** 2 + (41 * Math.sin(t)) ** 2);
  const lump = 1.9 * Math.sin(5 * a + 0.7) + 1.0 * Math.sin(8 * a + 2.1) + 0.45 * Math.sin(13 * a + 0.4);
  const lean = 2.2 * Math.cos(t - 0.35); // the right side fuller and lower: a real fruit, not a stamp
  const aa = Math.atan2(Math.sin(a - 0.12), Math.cos(a - 0.12)); // the stem a touch off-centre
  const dimple = -5.5 * Math.exp(-((aa / 0.3) ** 2));
  return base + lump + lean + dimple;
}
const CX = 50, CY = 61, S = 0.8;
const pts = []; for (let i = 0; i < 180; i++) { const t = (2 * Math.PI * i) / 180; const r = rAsym(t) * S; pts.push(`${f(CX + r * Math.cos(t))},${f(CY + r * Math.sin(t))}`); }
const fruit = "M" + pts.join(" L") + " Z";
const ta = 0.12 - Math.PI / 2; const tr = rAsym(ta) * S; const X = CX + tr * Math.cos(ta), Y = CY + tr * Math.sin(ta);
const pores = []; const ga = Math.PI * (3 - Math.sqrt(5));
for (let i = 1; i <= 36; i++) { const fr = Math.sqrt(i / 37) * 0.86, t = i * ga + 0.4, r = rAsym(t) * fr * S; const x = CX + r * Math.cos(t), y = CY + r * Math.sin(t); if ((x - (CX - 12)) ** 2 / 100 + (y - (CY - 9)) ** 2 / 40 < 1) continue; pores.push([f(x), f(y), f(1.2 + (0.25 * ((i * 7) % 3)) / 2)]); }
const sheen = `M${CX - 18} ${CY - 4} C${CX - 15} ${CY - 12} ${CX - 8} ${CY - 16} ${CX - 2} ${CY - 16.5}`;
const cal = []; for (let k = 0; k < 10; k++) { const ang = -Math.PI / 2 + (k * Math.PI) / 5 + 0.12, rr = k % 2 === 0 ? 4.6 : 2.0; cal.push(`${f(X + rr * Math.cos(ang))},${f(Y + rr * 0.62 * Math.sin(ang) + 1)}`); }
const calyx = "M" + cal.join(" L") + " Z";
const stalk = `M${f(X - 1.6)} ${f(Y - 0.5)} C${f(X - 1.8)} ${f(Y - 4)} ${f(X - 0.5)} ${f(Y - 7)} ${f(X + 1.2)} ${f(Y - 9)} L${f(X + 3.2)} ${f(Y - 8.2)} C${f(X + 1.8)} ${f(Y - 6.5)} ${f(X + 1.2)} ${f(Y - 3.5)} ${f(X + 1.6)} ${f(Y - 0.5)} Z`;
const LX = f(X + 2.2), LY = f(Y - 8.6);
// a leaf, drawn once and mirrored: its stalk, the small winged leaf on the stalk, the blade, the blade's midrib
const leaf = { stalk: "M0 0 C3 -3 6 -5 10 -6", wing: "M4 -2.5 C0.5 -5 1.5 -10.5 7.5 -13 C9.5 -9 9 -5 4 -2.5 Z", blade: "M9 -6 C16 -14 26 -17 36 -16 C31 -8 21 -3 10 -4 Z", rib: "M11 -5.5 C18 -10 26 -13 34 -15.5" };
const shape = { ring: { cx: 50, cy: 50, r: 47, w: 5 }, fruit, pores, sheen, calyx, stalk, leaf, leafAt: [LX, LY] };
fs.writeFileSync("src/ui/crest.generated.ts", `// Made by scripts/crest.mjs: do not edit by hand.\nexport const CREST = ${JSON.stringify(shape)} as const;\n`);
/** The crest as SVG markup; `gold` the crest, `ink` the cut-outs (pores, sheen, midribs, the calyx's outline). */
export function crestSvg(gold, ink, extra = "") {
  const lv = (sx) => `<g transform="translate(${LX} ${LY}) scale(${sx} 1) rotate(-14) scale(.9)"><path d="${leaf.stalk}" stroke="${gold}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="${leaf.wing}" fill="${gold}"/><path d="${leaf.blade}" fill="${gold}"/><path d="${leaf.rib}" stroke="${ink}" stroke-width="1" fill="none"/></g>`;
  return `<circle cx="50" cy="50" r="47" fill="none" stroke="${gold}" stroke-width="5"/><path d="${fruit}" fill="${gold}"/>` + pores.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${ink}"/>`).join("") + `<path d="${sheen}" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="${calyx}" fill="${gold}" stroke="${ink}" stroke-width=".7"/><path d="${stalk}" fill="${gold}"/>${lv(1)}${lv(-1)}${extra}`;
}
fs.mkdirSync("public/icons", { recursive: true });
fs.writeFileSync("public/icons/crest.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 124 124"><rect x="-12" y="-12" width="124" height="124" fill="#15120d"/>${crestSvg("#F2C22B", "#15120d")}</svg>\n`);
console.log("crest ok", pores.length, "pores");
