// Boss fight: a short, mixed, no-hints quiz over well-learned cards of one area. Graded pass/fail;
// each answer is a real review, so it also schedules. Interleaving and cumulative testing in one feature.
import { useEffect, useMemo, useRef, useState } from "react";
import { store, type View } from "../lib/store";
import type { Card } from "../lib/model";
import { renderCard } from "../lib/render";
import { IconClose, YuzuMark } from "./icons";
import { Paper } from "./Study";
import { useBack } from "./useBack";
import { sfx } from "./sfx";

export const BOSS_SIZE = 20, BOSS_PASS = 0.85, BOSS_MIN_STABILITY = 7;

export function bossPool(path: string, view: View): Card[] {
  return store.cardsIn(path, view).filter((c) => !c.suspended && c.state === "review" && c.stability >= BOSS_MIN_STABILITY);
}

export function Boss({ path, view, name, onExit }: { path: string; view: View; name: string; onExit: () => void }) {
  const key = `${view}:${path}`;
  const cards = useMemo(() => { const pool = bossPool(path, view); for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; } return pool.slice(0, BOSS_SIZE); }, []);
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(false);
  const [hits, setHits] = useState(0);
  const ghost = useRef(store.settings.bosses[key]?.best ?? null); // your own best on this boss, raced card by card
  useBack(true, onExit);
  const shownAt = useRef(Date.now());
  const card = cards[idx];
  const note = card && store.noteFor(card); const nt = note && store.notetypeFor(note);
  const rendered = useMemo(() => (card && note && nt ? renderCard({ note, notetype: nt, ord: card.ord, deck: card.source, resolveMedia: store.mediaUrl }) : null), [card?.id]);
  useEffect(() => { shownAt.current = Date.now(); setShow(false); }, [card?.id]);
  const done = idx >= cards.length;
  const score = cards.length ? hits / cards.length : 0;
  useEffect(() => { if (done && cards.length) { store.recordBoss(key, score, score >= BOSS_PASS); score >= BOSS_PASS ? sfx.win() : sfx.lose(); } }, [done]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (done) return; if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!show) setShow(true); } if (show && e.key === "1") grade(false); if (show && (e.key === "3" || e.key === "2" || e.key === "4")) grade(true); if (e.key === "Escape") onExit(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
  const busy = useRef(false);
  async function grade(ok: boolean) {
    if (!card || busy.current) return;
    busy.current = true;
    sfx.answer(ok ? 3 : 1);
    try { await store.answer(card.id, ok ? 3 : 1, Date.now() - shownAt.current); } finally { busy.current = false; }
    if (ok) setHits((h) => h + 1);
    setIdx((i) => i + 1);
  }
  if (cards.length < 10) {
    return (
      <div className="study"><div className="study-top"><button className="icon-btn" onClick={onExit} aria-label="Close"><IconClose /></button><div className="grow" /></div>
        <div className="study-body"><div className="done"><YuzuMark size={48} /><div style={{ marginTop: 12 }}>Not ready for a boss fight yet</div><p className="muted small">A boss fight needs at least 10 well-learned cards in {name} (stability a week or more). You have {cards.length}.</p><button className="btn primary" onClick={onExit}>Back</button></div></div></div>
    );
  }
  if (done) {
    const passed = score >= BOSS_PASS;
    return (
      <div className="study"><div className="study-top"><button className="icon-btn" onClick={onExit} aria-label="Close"><IconClose /></button><div className="grow" /></div>
        <div className="study-body"><div className="done">
          <YuzuMark size={56} />
          <div className="boss-score">{Math.round(score * 100)}%</div>
          <div className="px" style={{ fontSize: 20, lineHeight: "20px", color: passed ? "var(--yuzu)" : "var(--clay)" }}>{passed ? "★ Boss defeated ★" : "Not this time"}</div>
          {ghost.current !== null && <div className="small" style={{ marginTop: 8, color: score > ghost.current ? "var(--yuzu)" : "var(--muted)" }}>{score > ghost.current ? `New record — your ghost had ${Math.round(ghost.current * 100)}%` : score === ghost.current ? `Tied with your ghost (${Math.round(ghost.current * 100)}%)` : `Your ghost still leads: ${Math.round(ghost.current * 100)}%`}</div>}<div className="small muted" style={{ marginTop: 6 }}>{name}</div>
          <p className="muted small">{hits} of {cards.length} recalled without hints. {passed ? "This counts toward the system level." : `You need ${Math.round(BOSS_PASS * 100)}%. The misses are scheduled sooner; try again in a few days.`}</p>
          <button className="btn primary" onClick={onExit}>Done</button>
        </div></div></div>
    );
  }
  return (
    <div className="study">
      <div className="study-top">
        <button className="icon-btn" onClick={onExit} aria-label="Close"><IconClose /></button>
        <div className="progress"><i style={{ width: `${(idx / cards.length) * 100}%`, background: "var(--yuzu)" }} /></div>
        <span className="small muted" style={{ minWidth: 56, textAlign: "right" }}>{idx}/{cards.length}</span>
      </div>
      <div className="row small muted" style={{ padding: "0 14px 6px" }}><span className="chip yuzu">boss fight · {name}</span><span className="grow" />
        {ghost.current !== null && idx > 0 && (() => { const pace = ghost.current * idx; const diff = hits - pace; return <span className={"chip" + (diff >= 0 ? " yuzu" : "")} data-hint={`Ghost|Your best on this boss was ${Math.round(ghost.current * 100)}%. The ghost's pace after ${idx} cards: ${pace.toFixed(1)} right.`}>{diff >= 0 ? "▲ ahead of" : "▼ behind"} ghost</span>; })()}
        <span>{hits} right</span></div>
      <div className="study-body" onClick={() => !show && setShow(true)}>
        {rendered && <Paper card={card} html={show ? rendered.back : rendered.front} side={show ? "back" : "front"} css={rendered.css} dark={store.settings.nightCards} />}
      </div>
      {!show ? <div className="show-bar"><button className="btn primary block" onClick={() => setShow(true)}>Show answer</button></div>
        : <div className="answer-bar"><button className="again" onClick={() => grade(false)}>Missed</button><button className="good" onClick={() => grade(true)}>Got it</button></div>}
    </div>
  );
}
