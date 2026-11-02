// Google Calendar: read the shift rota that Pomelo (the scheduler) and the hospital put there, turn it into light and
// off days for the load balancer and the coach, and write Yuzu study blocks back when asked.
import { gfetch } from "./google";

const API = "https://www.googleapis.com/calendar/v3";
export interface CalendarInfo { id: string; name: string; primary?: boolean }
export interface ShiftDay { iso: string; title: string; night: boolean; allDay: boolean; start?: string; end?: string }
export interface ShiftRules { calendarId: string; match: string; night: string }
export const DEFAULT_RULES: ShiftRules = { calendarId: "primary", match: "shift|duty|on call|ER|clinic|rota", night: "night|N\\b|nachtdienst|evening" };

export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoDay(d); };

export class GoogleCalendar {
  constructor(private fetchImpl = gfetch) {}
  private async json(url: string, init?: RequestInit) { const r = await this.fetchImpl(url, init); return r.status === 404 ? null : r.json(); }
  async calendars(): Promise<CalendarInfo[]> {
    const j = await this.json(`${API}/users/me/calendarList?fields=items(id,summary,primary)&minAccessRole=reader`);
    return (j?.items ?? []).map((c: any) => ({ id: c.id, name: c.summary, primary: !!c.primary }));
  }
  /** Events in [from, to) that look like shifts, one entry per calendar day they touch. */
  async shifts(rules: ShiftRules, from: Date, to: Date): Promise<ShiftDay[]> {
    let re: RegExp, night: RegExp;
    try { re = new RegExp(rules.match || DEFAULT_RULES.match, "i"); night = new RegExp(rules.night || DEFAULT_RULES.night, "i"); } catch { re = new RegExp(DEFAULT_RULES.match, "i"); night = new RegExp(DEFAULT_RULES.night, "i"); }
    const out: ShiftDay[] = []; let page: string | undefined;
    do {
      const j = await this.json(`${API}/calendars/${encodeURIComponent(rules.calendarId || "primary")}/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(from.toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}&fields=nextPageToken,items(summary,start,end)${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
      for (const e of j?.items ?? []) {
        const title: string = e.summary ?? ""; if (!re.test(title)) continue;
        const allDay = !!e.start?.date; const s = allDay ? e.start.date : isoDay(new Date(e.start?.dateTime)); let en = allDay ? addDays(e.end?.date ?? s, -1) : isoDay(new Date(e.end?.dateTime ?? e.start?.dateTime)); if (en < s) en = s;
        const startH = allDay ? -1 : new Date(e.start.dateTime).getHours();
        const isNight = night.test(title) || (!allDay && (startH >= 18 || startH < 5));
        for (let d = s; d <= en; d = addDays(d, 1)) out.push({ iso: d, title, night: isNight, allDay, start: e.start?.dateTime, end: e.end?.dateTime });
      }
      page = j?.nextPageToken;
    } while (page);
    return out;
  }
  /** Put a study block in the calendar (returns the event id). */
  async addBlock(calendarId: string, iso: string, hhmm: string, minutes: number, title = "Yuzu · cards"): Promise<string> {
    const start = new Date(`${iso}T${hhmm}:00`); const end = new Date(start.getTime() + minutes * 60000);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const j = await this.json(`${API}/calendars/${encodeURIComponent(calendarId || "primary")}/events?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary: title, description: "Added by Yuzu", start: { dateTime: start.toISOString(), timeZone: tz }, end: { dateTime: end.toISOString(), timeZone: tz }, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] }, extendedProperties: { private: { yuzu: "1" } } }) });
    return j?.id ?? "";
  }
}

/** Day weights from shifts: a night shift makes that day and the morning after light; a day shift leaves the day as it is. */
export function weightsFromShifts(days: ShiftDay[], nightWeight = 0.5, afterNight = 0.5): Record<string, number> {
  const w: Record<string, number> = {};
  for (const d of days) if (d.night) { w[d.iso] = Math.min(w[d.iso] ?? 1, nightWeight); const next = addDays(d.iso, 1); w[next] = Math.min(w[next] ?? 1, afterNight); }
  return w;
}
