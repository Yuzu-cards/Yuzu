// Image occlusion: one picture, several labelled boxes; each box is its own card (hide that one, name it).
// The Masks field holds one box per line, in percent of the picture:  x,y,w,h,label
export const IO_ID = "yuzu-io";
export interface Mask { x: number; y: number; w: number; h: number; label: string }
const r1 = (n: number) => Math.round(Math.max(0, Math.min(100, n)) * 10) / 10;
export function parseMasks(field: string): Mask[] {
  return field.split(/\r?\n|<br\s*\/?>/i).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [x, y, w, h, ...rest] = l.split(","); const m = { x: Number(x), y: Number(y), w: Number(w), h: Number(h), label: rest.join(",").trim() };
    return m;
  }).filter((m) => [m.x, m.y, m.w, m.h].every(Number.isFinite) && m.w > 0 && m.h > 0);
}
export function formatMasks(ms: Mask[]): string { return ms.map((m) => `${r1(m.x)},${r1(m.y)},${r1(m.w)},${r1(m.h)},${m.label.replace(/[\r\n]+/g, " ").trim()}`).join("\n"); }
/** A normalised box from two drag corners (any direction), clipped to the picture. */
export function boxFrom(ax: number, ay: number, bx: number, by: number): Mask { const x = Math.min(ax, bx), y = Math.min(ay, by); return { x: r1(x), y: r1(y), w: r1(Math.max(ax, bx) - x), h: r1(Math.max(ay, by) - y), label: "" }; }
