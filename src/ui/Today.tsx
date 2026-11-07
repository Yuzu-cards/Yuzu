import { store, type View } from "../lib/store";
import type { Card } from "../lib/model";
import { YuzuMark, IconPlay } from "./icons";
import { DAY } from "../scheduler/fsrs";
import { systemColor } from "./theme";
import { useMemo, useRef, useState } from "react";
import { ActionSheet, DragHandle, HoldRow, PullToSync, useDragReorder, snackbar, type SheetItem } from "./kit";
import { Recap } from "./Recap";
import { sendImproveToClaude } from "./Improve";

/** A yuzu cut in half, drawn on a 30×30 pixel grid: 8 segments fill (yellow; orange while partly done) toward the daily goal. */
export function YuzuGoal({ value, max, size = 150, center, sub }: { value: number; max: number; size?: number; center?: string | number; sub?: string }) {
  const frac = Math.min(1, max ? value / max : 0);
  const cells = useMemo(() => {
    const N = 30, c = 15, segs = 8, filled = frac * segs, out: [number, number, string][] = [];
    const hole = center !== undefined ? 7.2 : 2.6;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy);
      if (r > 14.6) continue;
      let col: string;
      if (r > 13.6) col = "#3a2a07";                        // outline
      else if (r > 12.4) col = r > 13.1 ? "#c9971c" : "#f2d34b"; // rind
      else if (r > 11.4) col = "#fff3c2";                    // pith ring
      else if (r < hole) col = r > hole - 1 ? "#fff3c2" : "#1a1508"; // centre (dark hole for the number)
      else {
        let a = Math.atan2(dx, -dy); if (a < 0) a += Math.PI * 2; // 0 at the top, clockwise
        const seg = Math.floor(a / (Math.PI * 2 / segs));
        const edge = Math.min(a % (Math.PI * 2 / segs), Math.PI * 2 / segs - (a % (Math.PI * 2 / segs))) * r;
        if (edge < 0.55) col = "#fff3c2";                    // membrane between segments
        else { const f = Math.max(0, Math.min(1, filled - seg)); col = f >= 1 ? "#f2d34b" : f > 0 ? "#ff7a1a" : "#3b3220"; if (f >= 1 && (x + y) % 7 === 0) col = "#e0b52f"; }
      }
      out.push([x, y, col]);
    }
    return out;
  }, [frac, center !== undefined]);
  const label = String(center ?? `${Math.round(frac * 100)}%`);
  const fs = label.length > 4 ? 2.4 : 4; // in grid units; 4 units = 20 px at 150 px size, so each font pixel is 2×2 screen pixels
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" className="ring" shapeRendering="crispEdges" aria-label={`${value} of ${max} reviews today`}>
      {cells.map(([x, y, c], i) => <rect key={i} x={x} y={y} width={1} height={1} fill={c} />)}
      <text x={15} y={sub ? 15.6 : 17} textAnchor="middle" fontSize={fs} fill="var(--text)" style={{ fontFamily: "var(--px)" }}>{label}</text>
      {sub && <text x={15} y={19.4} textAnchor="middle" fontSize={2} fill="#a99e86" style={{ fontFamily: "var(--px)" }}>{sub}</text>}
    </svg>
  );
}

type OnStudy = (path: string, view?: View, extra?: { only?: "all" | "due" | "new"; preset?: import("../lib/model").Card[]; title?: string; minutes?: number }) => void;
type Filter = "flagged" | "improve" | "suspended" | "leech" | "overfilled";
export function Today({ onStudy, onInbox, onSearch, onBoss, onFilter, onTab }: { onStudy: OnStudy; onInbox?: () => void; onSearch?: (q: string) => void; onBoss?: (path: string, view: View, name: string) => void; onFilter?: (f: Filter) => void; onTab?: (t: "today" | "library" | "progress" | "settings") => void }) {
  const v = store.getVersion();
  const d = useMemo(() => derive(), [v]);
  return <TodayView {...d} onStudy={onStudy} onInbox={onInbox} onSearch={onSearch} onBoss={onBoss} onFilter={onFilter} onTab={onTab} />;
}

function derive() {
  const pins = store.settings.pins.map((p) => {
    const cards = store.cardsIn(p.path, p.view); const now = Date.now();
    const name = p.view === "smart" ? (store.settings.smart.find((s) => s.id === p.path)?.name ?? "Smart deck") : (p.path.split("::").pop() || "All");
    return { ...p, name, due: cards.filter((c) => !c.suspended && c.state !== "new" && c.due <= now).length, fresh: cards.filter((c) => !c.suspended && c.state === "new").length };
  });
  const tree = store.tree();
  const stats = store.stats();
  const queue = store.queue("");
  const counts = store.stateCounts();
  const now = Date.now();
  // Reviews falling due each of the next 7 days; cards already overdue are counted apart (a backlog would flatten the chart).
  const day0 = store.dayStart(now); const forecast = [0, 0, 0, 0, 0, 0, 0]; let overdue = 0;
  for (const c of store.cards.values()) {
    if (c.suspended || c.state !== "review") continue;
    if (c.due < day0) { overdue++; continue; }
    const d = Math.floor((c.due - day0) / DAY); if (d < 7) forecast[d]++;
  }
  const maxF = Math.max(1, ...forecast);
  const top = tree.children.filter((c) => c.due + c.newCount + c.learning > 0).sort((a, b) => b.due - a.due).slice(0, 6);
  const missed = store.missedToday(now); const weakest = store.weakestSystem(now);
  // A boss fight worth offering: a system with 10+ well-learned cards that has not been beaten in the last 14 days.
  const mastery = store.masteryBySystem(now);
  const bossReady = [...mastery].filter(([name, m]) => m.mastered + m.durable >= 10 && (now - (store.settings.bosses[`systems:${name}`]?.at ?? 0)) > 14 * DAY).sort((a, b) => (b[1].mastered + b[1].durable) - (a[1].mastered + a[1].durable)).slice(0, 1).map(([name, m]) => ({ name, ready: m.mastered + m.durable }))[0] ?? null;
  return { pins, tree, stats, queue, counts, now, forecast, maxF, overdue, top, missed, weakest, bossReady };
}

function TodayView({ pins, tree, stats, queue, counts, now, forecast, maxF, overdue, top, missed, weakest, bossReady, onStudy, onInbox, onSearch, onBoss, onFilter, onTab }: ReturnType<typeof derive> & { onStudy: OnStudy; onInbox?: () => void; onSearch?: (q: string) => void; onBoss?: (path: string, view: View, name: string) => void; onFilter?: (f: Filter) => void; onTab?: (t: "today" | "library" | "progress" | "settings") => void }) {
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState<{ title: string; sub?: string; items: SheetItem[] } | null>(null);
  const [recap, setRecap] = useState(false);
  const pinList = useRef<HTMLDivElement>(null);
  const { handle } = useDragReorder({ listRef: pinList, onMove: (a, b) => { const p = [...store.settings.pins]; const [x] = p.splice(a, 1); p.splice(b, 0, x); store.saveSettings({ pins: p }); } });
  const unpin = (path: string, view: View) => { const before = store.settings.pins; store.saveSettings({ pins: before.filter((x) => !(x.path === path && x.view === view)) }); snackbar("Unpinned", () => store.saveSettings({ pins: before })); };
  const deckSheet = (title: string, path: string, view: View, due: number, fresh: number, pinned: boolean, sub?: string) => setSheet({ title, sub, items: [
    { label: "Study", onClick: () => onStudy(path, view), disabled: due + fresh === 0 },
    { label: `Due only (${due.toLocaleString()})`, onClick: () => onStudy(path, view, { only: "due" }), disabled: !due },
    { label: `New only (${fresh.toLocaleString()})`, onClick: () => onStudy(path, view, { only: "new" }), disabled: !fresh },
    ...(view === "systems" && onBoss ? [{ label: "Boss fight", onClick: () => onBoss(path, view, path.split("::").pop() || path) }] : []),
    pinned ? { label: "Move to top", onClick: () => { const p = store.settings.pins.filter((x) => !(x.path === path && x.view === view)); store.saveSettings({ pins: [{ path, view }, ...p] }); } } : { label: "Pin to Today", onClick: () => store.saveSettings({ pins: [...store.settings.pins, { path, view }] }) },
    ...(pinned ? [{ label: "Unpin", danger: true, onClick: () => unpin(path, view) }] : []),
  ] });
  const goalDone = stats.today >= stats.goal && stats.goal > 0;
  return (
    <div className="screen">
      <PullToSync enabled={store.syncConfigured()} onSync={() => store.sync()} />
      {sheet && <ActionSheet title={sheet.title} sub={sheet.sub} items={sheet.items} onClose={() => setSheet(null)} />}
      {recap && <Recap initial={new Date().getDate() <= 7 ? "last-month" : "month"} onClose={() => setRecap(false)} />}
      <div className="brand"><YuzuMark size={32} /><h1>Yuzu</h1><div className="grow" />
        {store.syncConfigured() && <span className={"chip" + (store.syncStatus.state === "error" ? "" : " yuzu")} data-hint={`Sync|${store.syncStatus.message || "Ready"}. Tap to sync now, or pull the page down.`} onClick={() => store.sync()}>{store.syncStatus.state === "syncing" ? "syncing…" : store.syncStatus.state === "error" ? "sync failed" : store.hasUnsynced() ? "unsynced" : "synced"}</span>}
      </div>
      {store.inbox.length > 0 && onInbox && <button className="card-box row" style={{ width: "100%", textAlign: "left", marginBottom: 10, borderColor: "var(--yuzu)" }} onClick={onInbox}><span className="grow"><b>{store.inbox.length} new pack{store.inbox.length === 1 ? "" : "s"} from Claude</b><div className="small muted">Review the cards before they join your collection</div></span><span className="chip yuzu">Review</span></button>}
      {store.cards.size === 0 ? (
        <div className="card-box"><div style={{ fontWeight: 700, marginBottom: 6 }}>Nothing to study yet</div><div className="muted small">Go to Settings and import your Anki collection. Review history comes with it, so nothing starts over.</div></div>
      ) : (
        <>
          <div className={"hero" + (goalDone ? " goal-done" : "")}>
            <span data-hint={`Goal yuzu|${stats.today} of today's ${stats.goal} reviews done; the segments fill toward the goal. The number in the middle: ${queue.length} cards ready now.`}><YuzuGoal value={stats.today} max={stats.goal} size={150} center={queue.length} sub="ready" /></span>
            <div>
              <div className="lead"><b data-hint="Ready|Everything this session would hold: due reviews, cards in learning steps and today's new cards.">{queue.length.toLocaleString()} cards</b> ready: <span data-hint="Due|Learned cards whose recall is predicted to have dropped to your target — review them today.">{tree.due.toLocaleString()} due</span>, <span data-hint="Learning|Cards in their first short steps (minutes) or relearning after a lapse.">{tree.learning} learning</span> and <span data-hint={`New|Cards you haven't seen; up to ${store.settings.newPerDay} a day (Settings → Studying).`}>{Math.min(tree.newCount, Math.max(0, store.settings.newPerDay - store.reviewedToday().newCards))} new</span> for today.</div>
              <div className="lead" style={{ marginTop: 6 }}>Goal <b>{stats.today} / {stats.goal}</b>{stats.today >= stats.goal ? ", done for today" : ""}.</div>
              <button className="btn primary" style={{ marginTop: 14 }} onClick={() => onStudy("")} disabled={queue.length === 0}><IconPlay /> Study</button>
            </div>
          </div>
          <div className="stat-grid">
            <div className="stat" data-hint={`Streak|Days in a row with at least one review. ${store.settings.restDays === 1 ? "1 rest day a week doesn't" : `${store.settings.restDays} rest days a week don't`} break it.`}><b>{stats.streak}</b><span>day streak</span></div>
            <div className="stat" data-hint="Reviews today|Every answer counts, including Again and repeats."><b>{stats.today}</b><span>reviews today</span></div>
            {store.mastery.log.length > 0 && <div className="stat" data-hint="Mastered|Cards retired because their next review was years away. Their details are in Progress → Mastered → Log."><b>{store.mastery.log.length.toLocaleString()}</b><span>mastered</span></div>}
            <div className="stat" data-hint="Learned|Cards in review: past their learning steps, with a real interval."><b>{counts.review.toLocaleString()}</b><span>cards learned</span></div>
          </div>
          {onSearch && <form className="field" style={{ margin: "12px 0 0" }} onSubmit={(e) => { e.preventDefault(); if (q.trim()) onSearch(q.trim()); }}><input placeholder="Search all cards and tags" value={q} onChange={(e) => setQ(e.target.value)} /></form>}
          <Countdowns onStudy={onStudy} />
          <Coach missed={missed} weakest={weakest} bossReady={bossReady} overdue={overdue} onStudy={onStudy} onBoss={onBoss} onFilter={onFilter} onRecap={() => setRecap(true)} onTab={onTab} />
          <h2>Next 7 days</h2>
          <p className="small muted" style={{ margin: "-4px 0 8px" }}>Reviews falling due each day, so you see heavy days coming.{overdue > 0 ? <> Plus <b style={{ color: "var(--orange)" }}>{overdue.toLocaleString()} overdue</b>: about <b>{Math.ceil(overdue / 7).toLocaleString()} extra a day</b> clears them in a week.</> : null}</p>
          <div className="card-box forecast" style={{ height: 108 }}>
            {forecast.map((n, i) => (
              <div key={i} className={i === 0 ? "today" : ""} data-hint={`${i === 0 ? "Today" : new Date(now + i * DAY).toLocaleDateString(undefined, { weekday: "long" })}|${n.toLocaleString()} review${n === 1 ? "" : "s"} fall due${i === 0 && overdue ? `, plus ${overdue.toLocaleString()} overdue` : ""}.`}>
                <span className="small muted num">{n.toLocaleString()}</span>
                <i style={{ height: Math.max(3, (n / maxF) * 44) }} />
                <span className="small muted">{i === 0 ? "today" : new Date(now + i * DAY).toLocaleDateString(undefined, { weekday: "short" })}</span>
              </div>
            ))}
          </div>
          {pins.length > 0 && (<><h2>Pinned</h2>
            <div ref={pinList}>
            {pins.map((p, i) => (
              <div key={p.view + p.path} data-drag-item className="row" style={{ gap: 0, alignItems: "stretch" }}>
                <HoldRow className="stack grow" style={{ "--spine": p.view === "systems" ? systemColor(p.name) : "var(--orange)", marginBottom: 8 } as any} onTap={() => onStudy(p.path, p.view)} onHold={() => deckSheet(p.name, p.path, p.view, p.due, p.fresh, true)}>
                  <span className="name">{p.name}<div className="meta">{p.due.toLocaleString()} due · {p.fresh.toLocaleString()} new</div></span>
                  <span className="muted"><IconPlay /></span>
                </HoldRow>
                {pins.length > 1 && <DragHandle {...handle(i, p.name, pins.length)} />}
              </div>
            ))}</div></>)}
          {top.length > 0 && (<><h2>By category</h2>
            {top.map((c) => (
              <HoldRow key={c.path} className="stack" style={{ "--spine": "var(--yuzu)" } as any} onTap={() => onStudy(c.path)} onHold={() => deckSheet(c.name, c.path, "decks", c.due + c.learning, c.newCount, store.settings.pins.some((x) => x.path === c.path && x.view === "decks"))}>
                <span className="name">{c.name}<div className="meta">{c.due.toLocaleString()} due · {c.learning} learning · {c.newCount.toLocaleString()} new</div></span>
                <span className="muted"><IconPlay /></span>
              </HoldRow>
            ))}</>)}
        </>
      )}
    </div>
  );
}

/**
 * Coach (from Orange 8.2.0): up to four soft suggestions that wait for a tap and can be dismissed for the day.
 * Nothing changes until you choose it; anything that moves cards can be undone.
 */
function Coach({ missed, weakest, bossReady, overdue, onStudy, onBoss, onFilter, onRecap, onTab }: { onTab?: (t: any) => void; missed: Card[]; weakest: { name: string; retention: number; n: number } | null; bossReady: { name: string; ready: number } | null; overdue: number; onStudy: OnStudy; onBoss?: (path: string, view: View, name: string) => void; onFilter?: (f: Filter) => void; onRecap: () => void }) {
  const today = new Date().toDateString();
  const [gone, setGone] = useState<string[]>(() => { try { const x = JSON.parse(localStorage.getItem("yuzu-coach") ?? "{}"); return x.day === today ? x.ids : []; } catch { return []; } });
  const dismiss = (id: string) => { const ids = [...gone, id]; setGone(ids); try { localStorage.setItem("yuzu-coach", JSON.stringify({ day: today, ids })); } catch { /* fine */ } };
  const over = store.overfilled().filter((id) => !store.improveFor(id)).length;
  const marked = store.improveList().length;
  const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).getTime(), thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const recapReady = new Date().getDate() <= 7 && store.reviews.some((r) => r.ts >= lastMonth && r.ts < thisMonth);
  let lastBackup = 0; try { lastBackup = Number(localStorage.getItem("yuzu-last-backup") ?? 0); } catch { /* fine */ }
  type Tip = { id: string; spine: string; title: string; meta: string; act: () => void; why: string };
  const tips: Tip[] = [];
  // The rota, from Google Calendar: a night shift tonight or tomorrow changes what's sensible today.
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const todayIso = iso(new Date()), tmrwIso = iso(tomorrow);
  const sh = store.shiftOn(todayIso), shT = store.shiftOn(tmrwIso);
  const tonight = sh?.kind === "night", tmrwNight = shT?.kind === "night";
  const citrus = store.planToday();
  if (citrus.length) tips.push({ id: "citrus-" + citrus[0].start, spine: "var(--yuzu)", title: `Citrus ${citrus[0].accepted ? "planned" : "suggests"} ${citrus[0].minutes ? `${citrus[0].minutes} min` : "a session"}${citrus[0].start ? ` at ${citrus[0].start}` : ""}`, meta: citrus.length > 1 ? `and ${citrus.length - 1} more block${citrus.length > 2 ? "s" : ""} today — start when it suits` : "From today's plan in Citrus Maxima — start when it suits", act: () => onStudy("", "decks", citrus[0].minutes ? { minutes: citrus[0].minutes } : undefined), why: "Citrus|Citrus Maxima, your scheduler, reads what every app needs and writes a plan for the day to Drive. Yuzu reads it back." });
  if (sh?.afterNight && sh.kind !== "night") tips.push({ id: "postnight", spine: "var(--night, #5b6cff)", title: "Off the night shift — a light day", meta: "Fewer cards land today; sleep first, then 10 minutes keeps the streak", act: () => onStudy("", "decks", { title: "After the night", minutes: 10 }), why: "Rota|From Citrus Maxima (or the schedule file on Drive)." });
  else if (tonight) tips.push({ id: "night", spine: "var(--night, #5b6cff)", title: "Night shift tonight — a short session now", meta: "Today and tomorrow are light days in the scheduler; 10 minutes keeps the streak", act: () => onStudy("", "decks", { title: "Before the shift", minutes: 10 }), why: "Rota|From Citrus Maxima (or the schedule file on Drive). Night shifts make the day and the morning after light, so fewer cards land there." });
  else if (tmrwNight) tips.push({ id: "tmrw", spine: "var(--night, #5b6cff)", title: "Night shift tomorrow — do the full session today", meta: `Tomorrow is a light day; ${overdue ? `clear the ${overdue.toLocaleString()} overdue ` : "get ahead "}now`, act: () => onStudy(""), why: "Rota|From Citrus Maxima (or the schedule file on Drive)." });
  if (store.googleStatus.state === "error" && /tap/i.test(store.googleStatus.message)) tips.push({ id: "google", spine: "var(--amber)", title: "Tap to reconnect Google", meta: "Google's sign-in lasts an hour; this tap renews it and syncs", act: () => { store.sync("manual").catch(() => {}); store.googleRefresh("manual").catch(() => {}); }, why: "Google|Phones only let Google's sign-in window open from a tap, so an hour after the last one Yuzu waits for you. No password: it renews straight away." });
  const next = store.settings.newPerDay > 0 ? store.learnNext() : null;
  if (next) tips.push({ id: "next-" + next.name, spine: systemColor(next.name), title: next.started ? `Next: finish ${next.name}` : `Next: start ${next.name}`, meta: next.started ? `${next.seen.toLocaleString()} of ${next.total.toLocaleString()} seen — finish a system before opening another` : `${next.total.toLocaleString()} cards, the biggest system you haven't started`, act: () => onStudy(next.name, "systems", { only: "new", title: `New: ${next.name}` }), why: "Learn next|A teacher's rule: one system at a time. Half-finished systems come first (closest to done first), then the biggest untouched one. New cards from it, today's limit still applies." });
  if (recapReady) tips.push({ id: "recap", spine: "var(--orange)", title: `Your ${new Date(lastMonth).toLocaleString(undefined, { month: "long" })} recap is ready`, meta: "Persona, best day, nemesis card — and a share card", act: onRecap, why: "Recap|A look back at last month from your real reviews." });
  if (overdue >= 50) tips.push({ id: "postpone", spine: "var(--clay)", title: `${overdue.toLocaleString()} cards overdue — spread them over a week`, meta: "The most fragile stay first; sturdy ones wait. Undo anytime.", act: async () => { const r = await store.postponeOverdue(7); if (r) snackbar(`${r.moved.toLocaleString()} cards spread over 7 days`, r.undo); }, why: "Postpone|A big backlog makes every day feel impossible. This moves overdue cards with long, stable memories later and keeps the fragile ones first (FSRS Helper's postpone, simplified)." });
  if (bossReady && onBoss) tips.push({ id: "boss", spine: "var(--yuzu)", title: `Boss fight: ${bossReady.name}`, meta: `${bossReady.ready} well-learned cards — 20 at random, no hints, 85% to pass`, act: () => onBoss(bossReady.name, "systems", bossReady.name), why: "Boss fight|Mixed, cumulative testing on cards you already know — it shows what really stuck." });
  if (missed.length >= 3) tips.push({ id: "missed", spine: "var(--clay)", title: "Redo today's misses", meta: `${missed.length} cards you got wrong today, once more while they're fresh`, act: () => onStudy("", "decks", { preset: missed, title: "Missed today" }), why: "Same-day retry|A missed card retried before the day ends is recalled clearly better later (Quantum Country's retry experiment)." });
  if (weakest) tips.push({ id: "weak", spine: systemColor(weakest.name), title: `${weakest.name} is slipping`, meta: `${Math.round(weakest.retention * 100)}% recalled this week over ${weakest.n} reviews — a focused session helps`, act: () => onStudy(weakest.name, "systems"), why: "Slipping|This system's recall this week is clearly below your target." });
  if (over >= 10 && onFilter) tips.push({ id: "over", spine: "var(--amber)", title: `${over.toLocaleString()} cards look overfilled`, meta: "Too much on one card — pick some and Claude splits them", act: () => onFilter("overfilled"), why: "Overfilled|Long answers or 6+ list items. One fact per card is recalled better (Wozniak's minimum-information rule)." });
  if (marked >= 5) tips.push({ id: "send", spine: "var(--sky)", title: `Send ${marked} cards to Claude`, meta: "Marked “needs improving” — get them back rewritten or split", act: async () => { const m = await sendImproveToClaude(); if (m) snackbar(m); }, why: "Improve|Claude rewrites them keeping your review history and pictures." });
  if (!store.syncConfigured() && Date.now() - lastBackup > 30 * DAY && store.cards.size > 100) tips.push({ id: "backup", spine: "var(--line)", title: "No backup in 30 days", meta: "Save one file with everything", act: () => { const blob = new Blob([JSON.stringify(store.backup())], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `yuzu-backup-${new Date().toLocaleDateString("en-GB").replace(/\//g, "-")}.json`; a.click(); try { localStorage.setItem("yuzu-last-backup", String(Date.now())); } catch { /* fine */ } }, why: "Backup|Without sync, this device holds your only copy." });
  const shown = tips.filter((t) => !gone.includes(t.id)).slice(0, 4);
  if (!shown.length) return null;
  return (<>
    <h2>Worth a few minutes</h2>
    {shown.map((t) => (
      <div key={t.id} className="row coach-row" style={{ gap: 0, alignItems: "stretch" }}>
        <button className="stack grow" style={{ "--spine": t.spine, marginBottom: 8 } as any} data-hint={t.why} onClick={t.act}><span className="name">{t.title}<div className="meta">{t.meta}</div></span><span className="muted"><IconPlay /></span></button>
        <button className="coach-x" aria-label={`Dismiss: ${t.title}`} onClick={() => dismiss(t.id)}>✕</button>
      </div>))}
  </>);
}

const dmy = (iso: string) => iso.split("-").reverse().join("/");
/** Exam countdowns: days left, what's introduced, the new cards a day it needs, and drills on what you'd forget. Plus the mixed-system drill. */
function Countdowns({ onStudy }: { onStudy: OnStudy }) {
  const today = store.isoToday(); const list = (store.settings.deadlines ?? []).filter((d) => d.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  const drill = useMemo(() => store.drillQueue(30), [store.cards.size, store.reviews.length, today]); const systems = store.drillSystems(drill);
  return (<>
    {list.map((d) => { const e = store.examStatus(d); const pct = Math.round(e.coverage * 100); return (
      <div key={d.id} className="card-box" style={{ marginTop: 10 }}>
        <div className="row"><b className="grow">{d.name}</b><span className={"chip" + (e.onTrack ? " yuzu" : " orange")}>{e.daysLeft === 0 ? "today" : e.daysLeft === 1 ? "tomorrow" : `${e.daysLeft} days`}</span></div>
        <div className="small muted" style={{ margin: "4px 0 6px" }}>{dmy(d.date)} · {e.total.toLocaleString()} cards in scope</div>
        <div className="bar" style={{ height: 8, background: "var(--line, #8883)", borderRadius: 4 }}><div style={{ width: pct + "%", height: "100%", background: "var(--yuzu, #f08a24)", borderRadius: 4 }} /></div>
        <p className="small" style={{ margin: "8px 0 4px" }}>{pct}% introduced{e.unseen ? ` · ${e.unseen.toLocaleString()} still new` : " · everything seen"}{e.predicted !== null ? ` · you'd recall about ${Math.round(e.predicted * 100)}% on the day if you stopped reviewing now` : ""}.</p>
        <p className="small" style={{ margin: "0 0 8px", color: e.onTrack ? undefined : "var(--again)" }}>{e.unseen === 0 ? "All new cards are in; the rest is review." : e.onTrack ? `${e.needPerDay} new a day finishes them with ${e.reviewDays} review-only days before the exam (your limit is ${store.settings.newPerDay}).` : `Needs ${e.needPerDay} new cards a day; your limit is ${store.settings.newPerDay}. At that pace the last new cards come in on ${dmy(e.finishOn!)}.`}</p>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button className="btn grow" onClick={() => onStudy(d.path, d.view)}>Study this</button>
          <button className="btn grow" disabled={!e.seen} onClick={() => onStudy(d.path, d.view, { preset: store.examWeakest(d), title: d.name + " · weakest" })}>Weakest 30</button>
          {!e.onTrack && store.settings.newPerDay < e.needPerDay && <button className="btn grow" onClick={async () => { await store.saveSettings({ newPerDay: e.needPerDay }); snackbar(`New cards a day: ${e.needPerDay}`); }}>Set {e.needPerDay} a day</button>}
        </div>
      </div>); })}
    {systems >= 2 && <button className="card-box row" style={{ width: "100%", textAlign: "left", marginTop: 10 }} onClick={() => onStudy("", "decks", { preset: drill, title: "Mixed drill" })}><span className="grow"><b>Mixed drill</b><br /><span className="small muted">{drill.length} cards from {systems} systems, taken in turns — due and shakiest first. Switching topics is harder and sticks better.</span></span><IconPlay /></button>}
  </>);
}
