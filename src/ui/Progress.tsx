import { store } from "../lib/store";
import { confirmSheet } from "./kit";
import { fmtDate } from "../lib/dates";
import { DAY } from "../scheduler/fsrs";
import { systemColor } from "./theme";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useBack } from "./useBack";
import { Recap } from "./Recap";

/** What each mastery label means, with the stability thresholds from Settings. */
function masteryHint(k: string) {
  const t = store.settings.mastery;
  return ({ learning: `Learning|Seen, but stability under ${t.developing} days — still fragile.`, developing: `Developing|Stability ${t.developing}–${t.mastered} days: recall holds for weeks.`, mastered: `Mastered|Stability ${t.mastered}–${t.durable} days: recall holds for months.`, durable: `Durable|Stability over ${t.durable} days: you'd likely still know it in a quarter of a year without review.` } as Record<string, string>)[k] ?? "";
}
const MASTERY: { key: "durable" | "mastered" | "developing" | "learning"; label: string; color: string }[] = [
  { key: "durable", label: "durable", color: "var(--yuzu)" }, { key: "mastered", label: "mastered", color: "var(--orange)" },
  { key: "developing", label: "developing", color: "var(--orange-2)" }, { key: "learning", label: "learning", color: "var(--again)" },
];

function Calibration() {
  const v = store.getVersion();
  const rows = useMemo(() => store.calibration(), [v]);
  if (!rows.length) return null;
  const W = 300, H = 120, pad = 30;
  const x = (p: number) => pad + p * (W - pad - 6), y = (p: number) => H - pad + 6 - p * (H - pad - 6);
  return (
    <div className="card-box">
      <div className="small muted" style={{ marginBottom: 6 }}>Predicted recall (horizontal) vs what actually happened (vertical). Dots on the line = the scheduler knows your memory.</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 420, display: "block" }}>
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--line)" strokeDasharray="2 4" strokeWidth={2} shapeRendering="crispEdges" />
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(0)} stroke="var(--line)" /><line x1={x(0)} y1={y(0)} x2={x(0)} y2={y(1)} stroke="var(--line)" />
        {[0, 0.5, 1].map((t) => <text key={t} x={x(t)} y={H - 4} fontSize="10" fill="var(--muted)" textAnchor="middle" style={{ fontFamily: "var(--px)" }}>{t * 100}%</text>)}
        {[0.5, 1].map((t) => <text key={t} x={pad - 2} y={y(t) + 3} fontSize="10" fill="var(--muted)" textAnchor="end" style={{ fontFamily: "var(--px)" }}>{t * 100}%</text>)}
        {rows.map((r) => { const h = 2 + Math.round(Math.min(4, Math.log10(r.n + 1) * 1.6)); return <rect key={r.bucket} data-hint={`Predicted ${r.bucket}|You remembered ${Math.round(r.observed * 100)}% of ${r.n.toLocaleString()} reviews the scheduler expected ${Math.round(r.predicted * 100)}% for. On the dotted line = it knows your memory.`} x={Math.round(x(r.predicted)) - h} y={Math.round(y(r.observed)) - h} width={h * 2} height={h * 2} fill="var(--orange)" shapeRendering="crispEdges"><title>{r.bucket}: predicted {(r.predicted * 100).toFixed(0)}%, observed {(r.observed * 100).toFixed(0)}% ({r.n} reviews)</title></rect>; })}
      </svg>
      <div className="small muted">{store.settings.fit ? `FSRS-6 weights fitted ${fmtDate(store.settings.fit.at)} on ${store.settings.fit.n.toLocaleString()} reviews.` : "Using default FSRS-6 weights; tuning to your history runs automatically once there is enough (Settings → Studying)."}</div>
    </div>
  );
}

export function Progress({ onBoss }: { onBoss?: (path: string, view: "systems", name: string) => void }) {
  const v = store.getVersion();
  const d = useMemo(() => derive(), [v]);
  return <ProgressView {...d} onBoss={onBoss} />;
}

function derive() {
  const stats = store.stats();
  const counts = store.stateCounts();
  const now = Date.now();
  const start = store.dayStart(now);
  // Last 12 weeks heatmap of reviews per day.
  const days = 84;
  const perDay = new Array(days).fill(0);
  for (const r of store.reviews) {
    const d = Math.floor((start + DAY - r.ts) / DAY); // 0 = today
    if (d >= 0 && d < days) perDay[days - 1 - d]++;
  }
  const maxD = Math.max(1, ...perDay);
  // Retention over last 30 days: share of non-Again ratings on review cards.
  let ok = 0, all = 0;
  for (const r of store.reviews) if (r.ts > now - 30 * DAY && r.state === "review") { all++; if (r.rating > 1) ok++; }
  const retention = all ? Math.round((ok / all) * 100) : null;
  // This week vs last week: reviews, minutes, recall.
  const wk = (from: number, to: number) => { let n = 0, ms = 0, okk = 0, rv = 0; for (const r of store.reviews) if (r.ts >= from && r.ts < to) { n++; ms += Math.min(r.durationMs || 0, 120000); if (r.state === "review") { rv++; if (r.rating > 1) okk++; } } return { n, mins: Math.round(ms / 60000), recall: rv ? Math.round((okk / rv) * 100) : null }; };
  const week = wk(now - 7 * DAY, now + 1), lastWeek = wk(now - 14 * DAY, now - 7 * DAY);
  const mastery = store.masteryBySystem(now);
  const systems = [...mastery].map(([name, m]) => ({ name, total: m.total, learned: m.total - m.unseen })).sort((a, b) => b.learned - a.learned || b.total - a.total);
  const tree = store.tree();
  const cats = tree.children.map((c) => ({ name: c.name, total: c.total, learned: c.reviewed, pct: c.total ? Math.round((c.reviewed / c.total) * 100) : 0 })).sort((a, b) => b.learned - a.learned);
  return { stats, counts, perDay, maxD, retention, systems, mastery, cats, now, week, lastWeek };
}

function ProgressView({ stats, counts, perDay, maxD, retention, systems, mastery, cats, week, lastWeek, onBoss }: ReturnType<typeof derive> & { onBoss?: (path: string, view: "systems", name: string) => void }) {
  return (
    <div className="screen">
      <h1>Progress</h1>
      <RecapButton />
      <Mastered />
      <div className="stat-grid">
        <div className="stat"><b>{stats.streak}</b><span>day streak</span></div>
        <div className="stat"><b>{retention === null ? "–" : retention + "%"}</b><span>retention, 30 days</span></div>
        <div className="stat"><b>{store.reviews.length.toLocaleString()}</b><span>reviews all time</span></div>
      </div>
      <div className="card-box" style={{ marginTop: 12 }}>
        <b>This week</b>
        <div className="small muted" style={{ marginTop: 4 }}>{week.n.toLocaleString()} reviews in {week.mins} min{week.recall !== null ? `, ${week.recall}% recalled` : ""}. {lastWeek.n ? `Last week: ${lastWeek.n.toLocaleString()} in ${lastWeek.mins} min${lastWeek.recall !== null ? `, ${lastWeek.recall}%` : ""}.` : "No reviews the week before."}</div>
      </div>
      <h2>Last 12 weeks</h2>
      <div className="card-box" style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gridAutoFlow: "column", gridTemplateRows: "repeat(7, 1fr)", gap: 3 }}>
        {perDay.map((n, i) => (
          <div key={i} title={`${n} reviews`} style={{ aspectRatio: "1", background: n === 0 ? "var(--ink-3)" : n / maxD > 0.66 ? "var(--yuzu)" : n / maxD > 0.33 ? "var(--orange)" : "color-mix(in srgb, var(--orange) 45%, var(--ink-3))" }} />
        ))}
      </div>
      <h2>Cards</h2>
      <div className="card-box">
        <div className="row small" style={{ gap: 14, flexWrap: "wrap" }}>
          <span className="c-new">{counts.new.toLocaleString()} new</span>
          <span className="c-learn">{(counts.learning + counts.relearning).toLocaleString()} learning</span>
          <span className="c-due">{counts.review.toLocaleString()} learned</span>
          <span className="muted">{counts.suspended.toLocaleString()} suspended</span>
          {store.mastery.log.length > 0 && <span style={{ color: "var(--yuzu)" }}>{store.mastery.log.length.toLocaleString()} mastered &amp; retired</span>}
        </div>
      </div>
      <h2>Is the scheduler calibrated?</h2>
      <Calibration />
      {systems.length > 0 && (<><h2>Systems</h2>
        <div className="row small muted" style={{ gap: 10, flexWrap: "wrap", marginBottom: 6 }}>{MASTERY.map((m) => <span key={m.key} className="row" style={{ gap: 4 }} data-hint={masteryHint(m.key)}><i style={{ width: 10, height: 10, borderRadius: 2, background: m.color, display: "inline-block" }} />{m.label}</span>)}<span>(from memory stability, among cards you have seen)</span></div>
        {systems.map((s) => { const m = mastery.get(s.name); const seen = m ? m.total - m.unseen : 0; return (
          <div key={s.name} className="list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div className="row"><i style={{ width: 10, height: 10, borderRadius: 3, background: systemColor(s.name), display: "inline-block" }} /><span className="t">{s.name}</span>{store.settings.bosses[`systems:${s.name}`]?.passed && <span className="chip yuzu" title="Boss defeated">⚔</span>}{m?.secs != null && <span className="small muted">{m.secs.toFixed(0)} s/card</span>}<span className="small muted">{seen.toLocaleString()} / {s.total.toLocaleString()} seen</span>{onBoss && (m?.mastered ?? 0) + (m?.durable ?? 0) >= 10 && <button className="chip" onClick={() => onBoss(s.name, "systems", s.name)}>Boss</button>}</div>
            <div className="mastery-bar">{m && MASTERY.map((k) => <i key={k.key} style={{ width: `${(m[k.key] / Math.max(1, seen)) * 100}%`, background: k.color }} />)}</div>
            {m && seen > 0 && <div className="small muted">{MASTERY.filter((k) => m[k.key]).map((k) => `${m[k.key]} ${k.label}`).join(" · ")}</div>}
          </div>); })}</>)}
      <h2>By category</h2>
      {cats.map((c) => (
        <div key={c.name} className="list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
          <div className="row"><span className="t">{c.name}</span><span className="small muted">{c.learned.toLocaleString()} / {c.total.toLocaleString()}</span></div>
          <div className="bar" style={{ margin: 0, height: 6 }}><i style={{ width: `${c.pct}%`, background: "var(--orange)" }} /></div>
        </div>
      ))}
    </div>
  );
}

const yrs = (d: number) => `${(d / 365.25).toFixed(d < 3650 ? 1 : 0)} y`;
/** Retiring cards: >5 years to the next review → offered here; >20 years → retired on their own. Both go to the log. */
function Mastered() {
  const v = store.getVersion();
  const cands = useMemo(() => store.masteryCandidates(), [v]);
  const log = store.mastery.log;
  const [open, setOpen] = useState<"list" | "log" | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  useBack(open !== null, () => setOpen(null)); // Android back closes the sheet
  const monthAgo = Date.now() - 30 * 86400000;
  const byYou = log.filter((e) => e.by === "you").length, auto = log.length - byYou, recent = log.filter((e) => e.at > monthAgo).length;
  const ask = (store.settings.retireAskYears ?? 5) * 365.25;
  const nearing = useMemo(() => { let n = 0; for (const c of store.cards.values()) { const d = store.intervalDays(c); if (d > ask / 2 && d <= ask) n++; } return n; }, [v, ask]);
  if (!cands.length && !log.length && !nearing) return null;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const shownLog = [...log].reverse().filter((e) => !q || (e.front + " " + e.back + " " + e.deck).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card-box" style={{ marginBottom: 14 }}>
      <b>Mastered</b>
      <div className="stat-grid" style={{ marginTop: 8 }}>
        <div className="stat"><b>{log.length.toLocaleString()}</b><span>retired ({byYou.toLocaleString()} by you, {auto.toLocaleString()} auto)</span></div>
        <div className="stat"><b>{recent.toLocaleString()}</b><span>in the last 30 days</span></div>
        <div className="stat"><b>{nearing.toLocaleString()}</b><span>getting close (next review {Math.round(ask / 365.25 / 2 * 10) / 10}–{Math.round(ask / 365.25)} y away)</span></div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {cands.length > 0 && <button className="btn primary" onClick={() => { setSel(new Set(cands.map((c) => c.id))); setOpen("list"); }}>{cands.length.toLocaleString()} ready to retire</button>}
        {log.length > 0 && <button className="btn" onClick={() => setOpen("log")}>Log · {log.length.toLocaleString()}</button>}
      </div>
      <p className="small muted" style={{ margin: "8px 0 0" }}>Next review more than {store.settings.retireAskYears ?? 5} year{(store.settings.retireAskYears ?? 5) === 1 ? "" : "s"} away: you decide here. {store.settings.retireAutoYears ? `More than ${store.settings.retireAutoYears} years: retired automatically.` : "Nothing is retired automatically."} Change both in Settings → Studying. “I've mastered this” in a card's ⋯ menu retires it right away. Retired cards are deleted (their pictures too) and kept in the log.</p>
      {open === "list" && createPortal(
        <div className="sheet-backdrop" onClick={() => setOpen(null)}><div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "85vh", overflow: "auto" }}>
          <b>{cands.length.toLocaleString()} cards next due in more than {store.settings.retireAskYears ?? 5} year{(store.settings.retireAskYears ?? 5) === 1 ? "" : "s"}</b>
          <p className="small muted">Ticked cards are retired: deleted, with their question and answer kept in the Mastered log. “Keep studying” takes them off this list for good.</p>
          <div className="row" style={{ gap: 8, margin: "6px 0" }}>
            <button className="btn" onClick={() => setSel(new Set(cands.map((c) => c.id)))}>All</button>
            <button className="btn" onClick={() => setSel(new Set())}>None</button>
          </div>
          <ul className="retire-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {cands.slice(0, 500).map((c) => { const t = store.cardText(c); return (
              <li key={c.id} style={{ padding: "8px 0", borderBottom: "1px dashed var(--line)" }}>
                <label className="row" style={{ alignItems: "flex-start", gap: 10 }}>
                  <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} style={{ marginTop: 4 }} />
                  <span className="grow"><span className="small muted">{c.source.split("::").slice(-2).join(" › ")} · next in {yrs(store.intervalDays(c))} · {c.reps} reviews{c.lapses ? `, ${c.lapses} lapses` : ""}</span><br />{t.front || "(no text)"}{t.back ? <><br /><span className="muted">→ {t.back}</span></> : null}</span>
                </label>
              </li>); })}
            {cands.length > 500 && <li className="small muted">… and {(cands.length - 500).toLocaleString()} more (“All” includes them)</li>}
          </ul>
          <div className="row" style={{ gap: 8, marginTop: 10, position: "sticky", bottom: 0, background: "var(--ink-2)", paddingTop: 8 }}>
            <button className="btn primary grow" disabled={!sel.size} onClick={async () => { if (!(await confirmSheet({ title: `Retire ${sel.size.toLocaleString()} card${sel.size === 1 ? "" : "s"} as mastered?`, sub: "They are deleted; the Mastered log keeps what they said.", yes: "Mark mastered" }))) return; await store.masterCards([...sel], "you"); setSel(new Set()); setOpen(null); }}>Mark mastered ({sel.size.toLocaleString()})</button>
            <button className="btn grow" disabled={!sel.size} onClick={async () => { await store.keepCards([...sel]); setSel(new Set()); setOpen(null); }}>Keep studying</button>
          </div>
        </div></div>, document.body
      )}
      {open === "log" && createPortal(
        <div className="sheet-backdrop" onClick={() => setOpen(null)}><div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "85vh", overflow: "auto" }}>
          <b>Mastered log · {log.length.toLocaleString()} cards</b>
          <input placeholder="Search the log" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", margin: "8px 0", background: "var(--ink-3)", color: "var(--text)", border: "2px solid var(--line)", padding: "8px 10px", font: "inherit" }} />
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {shownLog.slice(0, 300).map((e) => (
              <li key={e.id + e.at} style={{ padding: "8px 0", borderBottom: "1px dashed var(--line)" }}>
                <span className="small muted">{fmtDate(e.at)} · {e.by === "auto" ? "retired automatically" : "marked by you"} · {e.deck.split("::").slice(-2).join(" › ")} · was next in {yrs(e.intervalDays)} · {e.reps} reviews{e.lapses ? `, ${e.lapses} lapses` : ""}{e.firstReview ? ` · learning since ${fmtDate(e.firstReview)}` : ""}</span><br />
                {e.front}{e.back ? <><br /><span className="muted">→ {e.back}</span></> : null}
              </li>))}
            {shownLog.length > 300 && <li className="small muted">… {(shownLog.length - 300).toLocaleString()} more — search to narrow</li>}
          </ul>
        </div></div>, document.body
      )}
    </div>
  );
}

/** Recap entry + "known right now" (the sum of every learned card's recall probability). */
function RecapButton() {
  const [open, setOpen] = useState(false);
  const v = store.getVersion(); const k = useMemo(() => store.knowledgeNow(), [Math.floor(v / 20)]);
  return (<>
    <div className="card-box row" style={{ gap: 12, marginBottom: 12 }}>
      <span className="grow" data-hint="Known right now|The sum of every learned card's predicted recall today, from your own forgetting curves — the expected number of cards you'd get right if all were asked now."><b className="kit-num" style={{ fontSize: 20 }}>{k.known.toLocaleString()}</b><span className="small muted" style={{ display: "block", marginTop: 4 }}>cards you'd likely recall right now, of {k.of.toLocaleString()} learned</span></span>
      <button className="btn primary" onClick={() => setOpen(true)}>Recap</button>
    </div>
    {open && <Recap onClose={() => setOpen(false)} />}
  </>);
}
