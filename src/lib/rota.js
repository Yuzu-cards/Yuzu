// The work rota, read from the department's schedule files in My Apps/Rotas (Orange's parser, shared by the Citrus
// apps): your row, the day header, the month. Shift codes are the Qiddiya ER / HABIB key. @ts-nocheck
import { readXlsx, serialToDate } from "./xlsx.js";
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseLocal = (iso) => new Date(iso + "T12:00:00");
// ---- Shift codes (Qiddiya ER / HABIB key; anything else still shows, as a generic duty) ----
const LOCATIONS = { 1: "Upper Village", 2: "Lower Village", 3: "Upper office clinic 242", 4: "Lower office clinic 242" };
// Upper Village is the longer drive: sessions before those shifts are shorter.
const FAR = new Set(["1"]);
const RULES = [
  { re: /^D5$/, kind: "day", start: 6, end: 18, label: "Day (SABIC Compound)" },
  { re: /^N5$/, kind: "night", start: 18, end: 6, label: "Night (SABIC Compound)" },
  { re: /^E5$/, kind: "evening", start: 10, end: 20, label: "Evening (SABIC Compound)" },
  { re: /^D[1-4]?$/, kind: "day", start: 8, end: 20, label: "Day" },
  { re: /^E[1-4]?$/, kind: "evening", start: 10, end: 22, label: "Evening" },
  { re: /^N[1-4]?$/, kind: "night", start: 20, end: 8, label: "Night" },
  { re: /^SF$/, kind: "late", start: 13, end: 1, label: "Late (SF)" },
  { re: /^AD$/, kind: "day", start: 9, end: 19, label: "Admin day" },
  { re: /^(SPD|STC|HQ)$/, kind: "day", start: 7, end: 16.5, label: "SABIC centre" },
  { re: /^OR$/, kind: "day", start: 8, end: 17, label: "Orientation" },
  { re: /^NA$/, kind: "day", start: 8, end: 20, label: "Nairiyah project" },
  { re: /^(AL|EL|AL\/EL|SL|EM\\?\/?L|EML|LEAVE|ANNUAL LEAVE|SICK LEAVE|EID LEAVE|EMERGENCY LEAVE|VACATION)$/, kind: "leave", label: "Leave" },
];

export const KINDS = {
  off: { label: "Off", glyph: "", tone: "off" },
  day: { label: "Day shift", glyph: "☀", tone: "day" },
  evening: { label: "Evening shift", glyph: "◐", tone: "evening" },
  late: { label: "Late shift", glyph: "◑", tone: "evening" },
  night: { label: "Night shift", glyph: "☾", tone: "night" },
  leave: { label: "Leave", glyph: "✈", tone: "leave" },
  duty: { label: "Duty", glyph: "■", tone: "day" },
};

/** Quick picks when setting a day by hand. */
export const PICKS = ["", "D", "E", "N", "SF", "AD", "AL"];

const hh = (h) => {
  const H = Math.floor(h) % 24;
  return `${String(H).padStart(2, "0")}:${h % 1 ? "30" : "00"}`;
};

/** Everything Orange knows about one code: kind, hours, location. */
export function shiftInfo(code) {
  const c = String(code || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!c) return { code: "", kind: "off", label: "Off", hours: "" };
  const rule = RULES.find((r) => r.re.test(c));
  const digit = /^[DNE]([1-4])$/.exec(c)?.[1];
  if (!rule) return { code: c, kind: "duty", label: c, hours: "" };
  return {
    code: c,
    kind: rule.kind,
    label: rule.label,
    start: rule.start,
    end: rule.end,
    hours: rule.start != null ? `${hh(rule.start)}–${hh(rule.end)}` : "",
    location: digit ? LOCATIONS[digit] : "",
    far: !!digit && FAR.has(digit),
  };
}

// ---- Reading the schedule ----
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\bdr\b\.?|\bdoctor\b/g, " ")
    .replace(/[^a-z؀-ۿ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Whether a name cell is you: every word of your name appears in it ("Dr.Amro" ⊇ "amro"). */
export function nameMatches(cell, name) {
  const words = norm(name).split(" ").filter(Boolean);
  const hay = ` ${norm(cell)} `;
  return words.length > 0 && words.every((w) => hay.includes(` ${w}`) || hay.includes(w));
}

const isCode = (v) => typeof v === "string" && /^[A-Za-z][A-Za-z0-9\\/ ]{0,20}$/.test(v.trim());

/** The row that numbers the days 1, 2, 3… (and the column of each day). */
function findDayHeader(rows, beforeRow) {
  let best = null;
  for (const [r, cells] of rows) {
    if (r >= beforeRow) continue;
    const cols = new Map();
    for (const [c, v] of cells) if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 31) cols.set(v, c);
    // 1..28 at least, each to the right of the one before
    let ok = cols.size >= 28;
    for (let d = 2; ok && d <= 28; d++) if (!(cols.get(d) > cols.get(d - 1))) ok = false;
    if (ok && (!best || r > best.row)) best = { row: r, cols };
  }
  return best;
}

const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Which month the sheet is for: the "Month&Year" date, a date anywhere above the grid, a month name, or the weekdays row. */
function findMonth(rows, header, today) {
  const looksDate = (v) => typeof v === "number" && v > 40000 && v < 60000;
  // 1) a date in the rows above the day header (the "Month&Year" cell)
  for (let r = header.row - 1; r >= Math.max(1, header.row - 12); r--) {
    for (const v of rows.get(r)?.values() || []) {
      if (looksDate(v)) return serialToDate(v).slice(0, 7);
      if (typeof v === "string" && /^\d{4}-\d{2}(-\d{2})?/.test(v.trim())) return v.trim().slice(0, 7);
    }
  }
  // 2) the weekdays row just under the header: find the month (around today) whose 1st is that weekday
  const wdRow = rows.get(header.row + 1);
  const firstWd = wdRow ? String(wdRow.get(header.cols.get(1)) || "").slice(0, 3).toLowerCase() : "";
  const want = WD.indexOf(firstWd);
  if (want >= 0) {
    const t = parseLocal(today);
    for (const k of [0, 1, -1, 2, -2]) {
      const d = new Date(t.getFullYear(), t.getMonth() + k, 1);
      if (d.getDay() === want) return localDate(d).slice(0, 7);
    }
  }
  return null;
}

/**
 * Your row in a schedule workbook. Returns { month, days, name, candidates } or throws a plain-word error.
 * `month` is "YYYY-MM"; `days` maps "1".."31" to the code ("" = off).
 */
export async function rotaFromXlsx(buf, name, today = localDate()) {
  const sheets = await readXlsx(buf);
  const found = [];
  for (const sheet of sheets) {
    for (const [r, cells] of sheet.rows) {
      for (const [c, v] of cells) {
        if (typeof v !== "string" || !nameMatches(v, name)) continue;
        const header = findDayHeader(sheet.rows, r);
        if (!header) continue;
        const days = {};
        let worked = 0;
        const last = Math.max(...header.cols.keys());
        for (let d = 1; d <= last; d++) {
          const val = sheet.rows.get(r)?.get(header.cols.get(d));
          let code = isCode(val) ? val.trim().toUpperCase().replace(/\s+/g, " ") : "";
          if (code.length > 5 && shiftInfo(code).kind === "leave") code = "AL"; // "Annual Leave" written out
          days[String(d)] = code;
          if (code) worked++;
        }
        found.push({ sheet, row: r, col: c, name: v.trim(), header, days, worked });
      }
    }
  }
  if (!found.length) throw new Error(`Couldn't find "${name}" in this schedule. Check the name in Rota settings.`);
  found.sort((a, b) => b.worked - a.worked);
  const pick = found[0];
  const month = findMonth(pick.sheet.rows, pick.header, today);
  // Trim days that don't exist in that month (a 31-column grid in November).
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const len = new Date(y, m, 0).getDate();
    for (const k of Object.keys(pick.days)) if (+k > len) delete pick.days[k];
  }
  return { month, days: pick.days, name: pick.name, candidates: found.map((f) => f.name) };
}

