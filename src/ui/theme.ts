// Visual identity helpers: a color per body system (card spines, mastery bars), a deterministic
// tilt per card so a stack of cards never looks machine-made, and the stamp text for a card's state.
import type { Card } from "../lib/model";
import { humanInterval } from "../scheduler/fsrs";

export const SYSTEM_COLORS: Record<string, string> = {
  Cardiovascular: "#D65A3C", Respiratory: "#4FA3A3", Neurology: "#D9A43C", Gastrointestinal: "#E8A83E", Renal: "#4D86C6",
  Endocrine: "#9AB83E", "Hematology & Oncology": "#B23A48", "Infectious Disease": "#6FA34A", "Musculoskeletal & Rheumatology": "#A9794B",
  Dermatology: "#E07C9A", Psychiatry: "#9C8AD6", Reproductive: "#D96C8F", Immunology: "#3F9C8C", Biochemistry: "#8C9A3A",
  Pharmacology: "#FF7A1A", "ENT & Eye": "#3FA7C9",
};
const FALLBACK = ["#C97B4A", "#7A9A6A", "#6F86B5", "#B58BC9", "#C9A05B"];

export function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function systemColor(name: string | undefined): string {
  if (!name) return "#8C8373";
  return SYSTEM_COLORS[name] ?? FALLBACK[hash(name) % FALLBACK.length];
}

/** Tilt in degrees for a card, between -0.9 and 0.9. */
export function tilt(id: string): number { return ((hash(id) % 181) - 90) / 100; }

export function stamp(c: Card, now = Date.now()): string {
  if (c.suspended) return "paused";
  if (c.state === "new") return "new";
  if (c.state === "learning") return "learning";
  if (c.state === "relearning") return "again";
  const over = now - c.due;
  return over > 86400000 * 2 ? `${Math.round(over / 86400000)}d late` : `every ${humanInterval(Math.max(0, c.due - c.lastReview))}`;
}
