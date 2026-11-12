// Square-wave blips (WebAudio), quiet and short. Off when the user turns sound off or the page is hidden.
import { store } from "../lib/store";

let ctx: AudioContext | null = null;
function tone(freq: number, at: number, dur = 0.07, gain = 0.05) {
  if (!ctx) ctx = new AudioContext();
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = "square"; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(gain, t); g.gain.setValueAtTime(0, t + dur);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
}
function play(notes: [number, number][], step = 0.075) {
  if (!store.settings.sfx || typeof AudioContext === "undefined" || document.visibilityState === "hidden") return;
  try { notes.forEach(([f, d], i) => tone(f, i * step, d)); } catch { /* audio unavailable */ }
}
export const sfx = {
  answer(g: 1 | 2 | 3 | 4) {
    if (g === 1) play([[247, 0.06], [185, 0.09]]);
    else if (g === 2) play([[330, 0.06]]);
    else if (g === 3) play([[523, 0.05], [659, 0.07]], 0.06);
    else play([[523, 0.04], [659, 0.04], [784, 0.08]], 0.05);
  },
  goal() { play([[523, 0.07], [659, 0.07], [784, 0.07], [1047, 0.16]], 0.09); },
  win() { play([[392, 0.08], [523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.22]], 0.1); },
  lose() { play([[392, 0.1], [330, 0.1], [262, 0.2]], 0.12); },
  tap() { play([[880, 0.03]]); },
};

export const THEMES: { id: "yuzu" | "orange" | "gameboy" | "night"; name: string; sw: string[] }[] = [
  { id: "yuzu", name: "Yuzu", sw: ["#15120d", "#f2d34b", "#ff7a1a"] },
  { id: "orange", name: "Orange", sw: ["#160b04", "#ffb14a", "#ff7a1a"] },
  { id: "gameboy", name: "Game Boy", sw: ["#0f380f", "#8bac0f", "#cadc9f"] },
  { id: "night", name: "Night", sw: ["#0b1022", "#5ee0ff", "#ff7a1a"] },
];
export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id; try { localStorage.setItem("yuzu-theme", id); } catch { /* fine */ }
  const meta = document.querySelector('meta[name="theme-color"]'); const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  meta?.setAttribute("content", document.documentElement.dataset.ui === "paper" ? "#F3F4F9" : t.sw[0]);
}
/** The interface (Arcade: 8-bit; Clean: dark, soft corners, system type; Paper: light) and text size, per device. */
export type UiMode = "arcade" | "clean" | "paper"; export type TextSize = "small" | "normal" | "large";
export function uiMode(): UiMode { return (document.documentElement.dataset.ui as UiMode) || "arcade"; }
export function textSize(): TextSize { return (document.documentElement.dataset.size as TextSize) || "normal"; }
export function setUi(m: UiMode) { document.documentElement.dataset.ui = m; try { localStorage.setItem("yuzu-ui", m); } catch { /* fine */ } applyTheme(document.documentElement.dataset.theme || "yuzu"); }
export function setTextSize(z: TextSize) { document.documentElement.dataset.size = z; try { localStorage.setItem("yuzu-size", z); } catch { /* fine */ } }
