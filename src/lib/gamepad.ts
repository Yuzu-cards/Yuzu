// Gamepad (Steam Deck, Xbox/PlayStation pads): the standard mapping turned into the same keys and taps the app already
// understands, so mouse, keyboard and pad all work at once with nothing to switch.
//   Study:  A flip / Good · D-pad ← Again ↓ Hard → Good ↑ Easy (the swipe directions) · B leave · X undo · Y card info · Menu card menu
//           multiple choice (front): D-pad ↑↓ move the highlight over the options, A picks the highlighted one
//           card menu open, a sheet open or typing a hook: the D-pad moves between its buttons, A presses, B closes it
//   Else:   D-pad / left stick move between buttons · A press · B back · Y the focused row's hold menu · LB / RB previous / next tab
//           Menu start studying · View shortcuts. On a slider ← / → change its value; on a dropdown ← / → step through it, A lists it.
import { pickSheet, snackbar } from "../ui/kit";
const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, VIEW = 8, MENU = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
let running = false; let prev: boolean[] = []; let stickAt = 0; let lastFocus: HTMLElement | null = null;

function key(k: string, mods: KeyboardEventInit = {}) {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true, cancelable: true, ...mods })); // a press is a press: down and up
}
const studying = () => !!document.querySelector(".study");
const isText = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search|email|url|password|tel|number|)$/.test((el as HTMLInputElement).type)));
/** The Deck has no keyboard until asked for: say how, once per device, the first time the pad lands in a text field. */
function textTip(el: Element | null) {
  if (!isText(el)) return;
  try { if (localStorage.getItem("yuzu-pad-kb-tip")) return; localStorage.setItem("yuzu-pad-kb-tip", "1"); } catch { /* still say it */ }
  snackbar("Typing: Steam + X opens the on-screen keyboard (Steam Deck)");
}
/** ← / → on a slider steps it (and saves it a moment after the last step, like letting go of it). */
let commitTimer: ReturnType<typeof setTimeout> | undefined;
function stepRange(el: HTMLInputElement, dir: 1 | -1) {
  const min = Number(el.min || 0), max = Number(el.max || 100), step = Number(el.step) || 1;
  const v = Math.min(max, Math.max(min, Number(el.value) + dir * step)); if (v === Number(el.value)) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, String(+v.toFixed(6)));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  clearTimeout(commitTimer); commitTimer = setTimeout(() => el.dispatchEvent(new KeyboardEvent("keyup", { key: dir > 0 ? "ArrowRight" : "ArrowLeft", bubbles: true })), 350);
}
function setSelect(el: HTMLSelectElement, i: number) {
  if (i < 0 || i >= el.options.length || i === el.selectedIndex || el.options[i].disabled) return;
  el.selectedIndex = i; el.dispatchEvent(new Event("change", { bubbles: true }));
}
/** ← / → on a dropdown moves to the previous / next choice that can be picked. */
function stepSelect(el: HTMLSelectElement, dir: 1 | -1) {
  for (let i = el.selectedIndex + dir; i >= 0 && i < el.options.length; i += dir) if (!el.options[i].disabled) { setSelect(el, i); return; }
}
/** A on a dropdown: its choices as a sheet the pad can move through (a native list can't be opened from script). */
async function openSelect(el: HTMLSelectElement) {
  const label = el.getAttribute("aria-label") || el.closest(".field")?.querySelector("label")?.textContent || "Choose";
  const i = await pickSheet(label, [...el.options].map((o) => ({ label: o.text, disabled: o.disabled })), el.selectedIndex);
  if (i !== null) setSelect(el, i);
  try { (el as any).focus({ focusVisible: true }); } catch { el.focus(); }
}
/** Everything the pad can land on, top to bottom: inside the topmost sheet when one is open. */
function focusables(): HTMLElement[] {
  const sheets = document.querySelectorAll<HTMLElement>(".sheet-backdrop, [role=dialog], .study [role=menu]"); const scope: ParentNode = sheets.length ? sheets[sheets.length - 1] : document;
  return [...scope.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], summary, input:not([type=hidden]):not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])")]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; });
}
function move(dir: 1 | -1, list = focusables()) {
  if (!list.length) return;
  const cur = document.activeElement as HTMLElement | null; let i = cur ? list.indexOf(cur) : -1;
  i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length; // wraps at either end
  const el = list[i]; lastFocus?.classList.remove("pad-focus"); el.classList.add("pad-focus"); lastFocus = el;
  try { (el as any).focus({ focusVisible: true, preventScroll: true }); } catch { el.focus(); }
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  textTip(el);
}
function press(b: number) {
  window.dispatchEvent(new CustomEvent("yuzu-pad", { detail: b }));
  const active = document.activeElement as HTMLElement | null;
  // Over study, a sheet, the card menu or the hook box being written takes the pad (it moves between their buttons).
  const overlay = !!document.querySelector(".sheet-backdrop, [role=dialog], .study [role=menu]") || (!!active && active.tagName === "TEXTAREA");
  if (studying() && !overlay) {
    if (active?.tagName === "INPUT") active.blur(); // the typed-answer box: the pad answers the card, not the box
    const opts = [...document.querySelectorAll<HTMLElement>(".study .mcq-opt:not([disabled])")];
    if (opts.length) { // multiple choice, front: move a highlight, A confirms; ← → do nothing (no instant wrong pick)
      if (b === UP || b === DOWN) { move(b === DOWN ? 1 : -1, opts); return; }
      if (b === LEFT || b === RIGHT) return;
      if (b === A && active && opts.includes(active)) { active.click(); return; }
    }
    if (b === A) key(" "); else if (b === B) key("Escape"); else if (b === X) key("z", { ctrlKey: true }); else if (b === Y) key("i"); else if (b === MENU) key("m");
    else if (b === LEFT) key("1"); else if (b === DOWN) key("2"); else if (b === RIGHT) key("3"); else if (b === UP) key("4");
    return;
  }
  const cur = document.activeElement as HTMLElement | null;
  if ((b === LEFT || b === RIGHT) && cur instanceof HTMLInputElement && cur.type === "range") stepRange(cur, b === LEFT ? -1 : 1);
  else if ((b === LEFT || b === RIGHT) && cur instanceof HTMLSelectElement) stepSelect(cur, b === LEFT ? -1 : 1);
  else if (b === UP || b === LEFT) move(-1); else if (b === DOWN || b === RIGHT) move(1);
  else if (b === A) { if (cur instanceof HTMLSelectElement) void openSelect(cur); else if (cur && cur !== document.body) { cur.click(); if (isText(cur)) { cur.focus(); textTip(cur); } } else move(1); }
  else if (b === B) key("Escape");
  else if (b === Y) { const h = cur?.closest?.("[data-hold]"); if (h) { const r = h.getBoundingClientRect(); h.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + Math.min(40, r.width / 2), clientY: r.bottom - 4 })); } }
  else if (b === LB || b === RB) window.dispatchEvent(new CustomEvent("yuzu-tab", { detail: b === LB ? -1 : 1 }));
  else if (b === MENU) { if (studying()) key("m"); else window.dispatchEvent(new CustomEvent("yuzu-study")); } // over study: Menu closes the card menu again
  else if (b === VIEW) key("?");
}
function loop() {
  const pads = navigator.getGamepads?.() ?? []; const gp = [...pads].find((p) => p && p.connected);
  if (!gp) { running = false; return; }
  const now = gp.buttons.map((x) => x.pressed);
  for (let i = 0; i < now.length; i++) if (now[i] && !prev[i]) press(i);
  prev = now;
  // the left stick works like the d-pad, repeating while held
  const [ax, ay] = [gp.axes[0] ?? 0, gp.axes[1] ?? 0]; const t = performance.now();
  if ((Math.abs(ax) > 0.6 || Math.abs(ay) > 0.6) && t - stickAt > 260) { stickAt = t; press(Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? RIGHT : LEFT) : ay > 0 ? DOWN : UP); }
  requestAnimationFrame(loop);
}
export function startGamepad() {
  if (typeof window === "undefined" || !("getGamepads" in navigator)) return;
  const go = () => { if (!running) { running = true; prev = []; requestAnimationFrame(loop); } };
  window.addEventListener("gamepadconnected", go);
  if ([...(navigator.getGamepads?.() ?? [])].some(Boolean)) go();
  const clear = () => { lastFocus?.classList.remove("pad-focus"); lastFocus = null; };
  document.addEventListener("pointerdown", clear, true);
  // the pad ring goes as soon as focus moves some other way (Tab, a click, a sheet opening), so only one place looks focused
  document.addEventListener("keydown", (e) => { if (e.isTrusted && e.key === "Tab") clear(); }, true);
  document.addEventListener("focusin", (e) => { if (lastFocus && e.target !== lastFocus) clear(); }, true);
}
/** For tests: act as if a pad button was pressed. */
export const padPress = press;
