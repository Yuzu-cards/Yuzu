// Citrus Maxima's own reader (Amaerys/Citrus-Maxima docs/js/inbound.js @ 45e6562), vendored so Yuzu's tests check status.json
// exactly the way Citrus will read it. Refresh with: cp <citrus>/docs/js/inbound.js and keep the safeUrl shim below.
const safeUrl = (u) => { if (u == null || String(u).trim() === "") return ""; try { const x = new URL(String(u || ""), "https://amaerys.github.io/Citrus-Maxima/"); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };
// Everything that arrives from other apps goes through here: never trust the shape, cap everything, and say what was ignored.
// The contract lives in HUB.md. A status.json can carry (all optional):
//   summary, next, today{date,done}, asks[], pending[]            — what Citrus already understood
//   metrics[{key,label,value,goal,unit,date}]                      — today's numbers (cards reviewed, sets lifted…); history is kept by Citrus
//   progress[{key,label,pct}]                                      — long-run progress (German A2: 62 %), can drive an objective
//   inbox[{id,type,title,text,due|date,start,end,minutes,pri,url}] — things the app proposes: tasks, events, notes. You accept or dismiss.

export const CONTRACT = 2;
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/, SLUG = /[^a-z0-9_-]+/g;
const CAP = { asks: 30, pending: 10, metrics: 12, progress: 12, inbox: 25, actions: 6 };

const validDate = (v) => typeof v === 'string' && DATE.test(v) && !isNaN(new Date(v + 'T00:00:00'));
export const slug = (v) => String(v ?? '').toLowerCase().trim().replace(SLUG, '-').replace(/^-+|-+$/g, '').slice(0, 40);
export const refOf = (app, id) => `${app}:${id}`;

/** A clean copy of a status file, keyed by the lowercase app name. Returns null if it isn't an object at all.
 *  `issues` lists what was ignored, so an app's author can see exactly what Citrus did with the file. */
export function normalizeStatus(st, fallbackName = '') {
  if (!st || typeof st !== 'object' || Array.isArray(st)) return null;
  const issues = [];
  const str = (v, max = 300) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
  const app = slug(st.app || st._folder || fallbackName);
  if (!app) return null;
  const list = (v, name) => { if (v == null) return []; if (!Array.isArray(v)) { issues.push(`${name}: expected a list, ignored`); return []; } if (v.length > CAP[name]) issues.push(`${name}: only the first ${CAP[name]} of ${v.length} are read`); return v.slice(0, CAP[name]); };
  const updatedAt = !isNaN(Date.parse(st.updatedAt)) ? new Date(st.updatedAt).toISOString() : '';
  if (!updatedAt) issues.push('updatedAt: missing or not an ISO time — Citrus cannot tell how fresh this is');
  const today = st.today && typeof st.today === 'object' ? { done: !!st.today.done, date: validDate(st.today.date) ? st.today.date : '' } : null;
  const dayOf = (v) => validDate(v) ? v : today?.date || (updatedAt ? updatedAt.slice(0, 10) : '');

  const asks = list(st.asks, 'asks').filter((a, i) => { const ok = a && typeof a === 'object' && validDate(a.date); if (!ok) issues.push(`asks[${i}]: needs a date like 2026-11-07, ignored`); return ok; })
    .map(a => ({ date: a.date, title: str(a.title, 80), minutes: Math.max(0, Math.min(240, +a.minutes || 0)), slot: a.slot === 'before' ? 'before' : 'free' }));
  const pending = (Array.isArray(st.pending) ? st.pending : typeof st.pending === 'string' ? [st.pending] : []).map(p => str(p, 120)).filter(Boolean).slice(0, CAP.pending);

  const metrics = list(st.metrics, 'metrics').map((m, i) => {
    const key = slug(m?.key), value = Number(m?.value);
    if (!key || !Number.isFinite(value)) { issues.push(`metrics[${i}]: needs a key and a numeric value, ignored`); return null; }
    return { key, label: str(m.label || m.key, 40), value, goal: Number.isFinite(+m.goal) && +m.goal > 0 ? +m.goal : 0, unit: str(m.unit, 12), date: dayOf(m.date) };
  }).filter(m => m && m.date);
  const progress = list(st.progress, 'progress').map((p, i) => {
    const key = slug(p?.key), pct = Number(p?.pct);
    if (!key || !Number.isFinite(pct)) { issues.push(`progress[${i}]: needs a key and pct 0–100, ignored`); return null; }
    return { key, label: str(p.label || p.key, 40), pct: Math.max(0, Math.min(100, pct)), date: dayOf(p.date) };
  }).filter(p => p && p.date);

  // deep links: buttons Citrus shows for the app ("Start reviews"), opened with ?from=citrus appended
  const aseen = new Set();
  const actions = list(st.actions, 'actions').map((a, i) => {
    const id = slug(a?.id), url = safeUrl(a?.url), label = str(a?.label, 28).trim();
    if (!id || !url || !label || aseen.has(id)) { issues.push(`actions[${i}]: needs id, label and an http(s) url, ignored`); return null; }
    aseen.add(id); return { id, label, url, icon: str(a.icon, 4), minutes: Math.max(0, Math.min(240, Math.round(+a.minutes || 0))) };
  }).filter(Boolean);

  const seen = new Set();
  const inbox = list(st.inbox, 'inbox').map((it, i) => {
    if (!it || typeof it !== 'object') { issues.push(`inbox[${i}]: not an object, ignored`); return null; }
    const id = slug(it.id); if (!id) { issues.push(`inbox[${i}]: needs a stable id (so it is not offered twice), ignored`); return null; }
    if (seen.has(id)) { issues.push(`inbox[${i}]: duplicate id "${id}", ignored`); return null; }
    seen.add(id);
    const type = ['task', 'event', 'note'].includes(it.type) ? it.type : 'task';
    const title = str(it.title || (type === 'note' ? it.text : ''), 120).trim();
    if (!title) { issues.push(`inbox[${i}] "${id}": needs a title, ignored`); return null; }
    const date = validDate(it.date) ? it.date : validDate(it.due) ? it.due : '';
    if (type === 'event' && !date) { issues.push(`inbox[${i}] "${id}": an event needs a date, ignored`); return null; }
    const expires = validDate(it.expires) ? it.expires : '';
    return { id, type, title, text: str(it.text, 400), date, start: TIME.test(it.start || '') ? it.start : '', end: TIME.test(it.end || '') ? it.end : '', minutes: Math.max(0, Math.min(480, Math.round(+it.minutes || 0))), pri: Math.max(0, Math.min(2, Math.round(+it.pri || 0))), url: safeUrl(it.url), expires };
  }).filter(Boolean);

  return {
    app, title: str(st.title, 40), icon: str(st.icon, 4), color: /^#[0-9a-f]{3,8}$/i.test(st.color || '') ? st.color : '', url: safeUrl(st.url || st.extra?.url),
    summary: str(st.summary), updatedAt, asks, pending, metrics, progress, inbox, actions, issues,
    next: st.next && typeof st.next === 'object' ? { title: str(st.next.title, 80), minutes: Math.max(0, +st.next.minutes || 0) } : null,
    today,
    due: Number.isFinite(+st.due) ? +st.due : undefined, estimatedMinutes: Number.isFinite(+st.estimatedMinutes) ? +st.estimatedMinutes : undefined,
    extra: st.extra && typeof st.extra === 'object' ? { streak: +st.extra.streak || undefined } : {},
  };
}

/** For the "paste a status.json" tester: what Citrus would read from this text. */
export function validateStatus(text) {
  let json;
  try { json = JSON.parse(text); } catch (e) { return { ok: false, error: `Not valid JSON: ${e.message}`, issues: [] }; }
  const parsed = normalizeStatus(json, json?.app || 'app');
  if (!parsed) return { ok: false, error: 'It must be a JSON object with an "app" name.', issues: [] };
  return { ok: !parsed.issues.length, parsed, issues: parsed.issues };
}
