// Yuzu Recap ("Wrapped"): a month or a year as story cards with a persona, shareable as a 9:16 or square pixel image
// or as text. Everything comes from real reviews (store.recap). Idea from Orange 8.2.0's recap.
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { store } from "../lib/store";
import { fmtDate } from "../lib/dates";
import { useBack } from "./useBack";
import { IconClose } from "./icons";
import { snackbar, tellSheet, useDialog } from "./kit";
import { ImproveSheet } from "./Improve";

type Period = "month" | "last-month" | "year";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** The period's bounds as study days: a month starts at the 1st's day rollover (04:00 by default), like every other day count. */
export function range(p: Period, now = new Date(), dayStart: (t: number) => number = (t) => store.dayStart(t)) {
  const at = (y: number, m: number, d: number) => dayStart(new Date(y, m, d, 12).getTime());
  if (p === "year") return { from: at(now.getFullYear(), 0, 1), to: at(now.getFullYear() + 1, 0, 1), label: String(now.getFullYear()) };
  const m = p === "month" ? now.getMonth() : now.getMonth() - 1; const d = new Date(now.getFullYear(), m, 1);
  return { from: at(d.getFullYear(), d.getMonth(), 1), to: at(d.getFullYear(), d.getMonth() + 1, 1), label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
}

export function Recap({ onClose, initial = "month" }: { onClose: () => void; initial?: Period }) {
  useBack(true, onClose); const dialog = useDialog();
  const [p, setP] = useState<Period>(initial); const [improve, setImprove] = useState<string | null>(null);
  const r = useMemo(() => { const g = range(p, new Date(store.dayStart())); return { ...store.recap(g.from, g.to), label: g.label }; }, [p]);
  const text = () => [`Yuzu Recap · ${r.label}`, `${r.persona} — ${r.personaWhy}`, `${r.reviews.toLocaleString()} reviews · ${r.minutes.toLocaleString()} min · ${r.daysStudied} days`, r.recall !== null ? `${Math.round(r.recall * 100)}% of learned cards recalled` : "", `${r.fresh.toLocaleString()} new cards · ${r.matured.toLocaleString()} matured · ${r.retired} retired as mastered`, `${r.masteredNow.toLocaleString()} cards mastered · I know about ${r.knowledge.toLocaleString()} cards right now.`].filter(Boolean).join("\n");
  async function share(shape: "story" | "square") {
    const blob = await drawCard(r, shape); const file = new File([blob], `yuzu-recap-${r.label.replace(/\s+/g, "-").toLowerCase()}.png`, { type: "image/png" });
    try { if ((navigator as any).canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `Yuzu Recap · ${r.label}` }); return; } } catch (e: any) { if (e?.name === "AbortError") return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  const empty = r.reviews === 0;
  return createPortal(
    <div ref={dialog} tabIndex={-1} className="recap" role="dialog" aria-modal="true" aria-label="Recap">
      <div className="row recap-top"><b className="grow px">Recap</b><button className="icon-btn" aria-label="Close recap" onClick={onClose}><IconClose /></button></div>
      <div className="seg" style={{ margin: "0 16px 10px" }}>
        {(["month", "last-month", "year"] as Period[]).map((k) => <button key={k} className={p === k ? "on" : ""} aria-pressed={p === k} onClick={() => setP(k)}>{k === "month" ? "This month" : k === "last-month" ? "Last month" : "This year"}</button>)}
      </div>
      <div className="recap-cards">
        <section className="recap-card hero-card"><span className="px small">{r.label}</span>
          {empty ? <><div className="recap-big">No reviews yet</div><p>Study a little and this fills itself.</p></> : <><div className="recap-persona">{r.persona}</div><p>{r.personaWhy}</p></>}
        </section>
        {!empty && <>
          <section className="recap-card"><div className="recap-big">{r.reviews.toLocaleString()}</div><p>reviews in <b>{r.minutes.toLocaleString()} min</b> over <b>{r.daysStudied}</b> of {r.spanDays} days{r.longestRun > 1 ? <> · longest run <b>{r.longestRun} days</b></> : null}</p></section>
          {r.recall !== null && <section className="recap-card"><div className="recap-big">{Math.round(r.recall * 100)}%</div><p>of learned cards recalled when they came back{r.recall >= 0.9 ? " — right on target." : r.recall >= 0.85 ? " — close to target." : " — below target: shorter, more frequent sessions help."}</p></section>}
          <section className="recap-card"><div className="recap-trio"><span><b>{r.fresh.toLocaleString()}</b>new cards</span><span><b>{r.matured.toLocaleString()}</b>matured (3+ weeks)</span><span><b>{r.retired.toLocaleString()}</b>retired</span></div></section>
          {r.topSys.length > 0 && <section className="recap-card"><span className="px small">Where your time went</span>{r.topSys.map((t, i) => <div key={t.name} className="recap-row"><b>{i + 1}</b><span className="grow">{t.name}</span><span className="muted">{t.n.toLocaleString()} answers{t.recall !== null ? ` · ${Math.round(t.recall * 100)}% recall` : ""}</span></div>)}<p className="small muted">Recall counts learned cards only, like the figure above.</p></section>}
          {r.bestDay && <section className="recap-card"><span className="px small">Biggest day</span><div className="recap-big">{r.bestDay.n.toLocaleString()}</div><p>reviews on {fmtDate(r.bestDay.day)}. Favourite hour: <b>{String(r.peakHour).padStart(2, "0")}:00</b>.</p></section>}
          {r.nemesis && <section className="recap-card"><span className="px small">Your nemesis</span><p className="recap-quote">“{r.nemesis.title}”</p><p className="muted">missed {r.nemesis.misses} times. Mark it “Needs improving” and Claude will rebuild it.</p>{store.notes.has(r.nemesis.nid) && <button className="btn" style={{ marginTop: 10 }} onClick={() => setImprove(r.nemesis!.nid)}>{store.improveFor(r.nemesis.nid) ? "Marked · change" : "Needs improving"}</button>}</section>}
          <section className="recap-card"><span className="px small">Right now</span><div className="recap-big">{r.knowledge.toLocaleString()}</div><p>cards you'd most likely recall today, by your own forgetting curves. <b>{r.masteredNow.toLocaleString()}</b> mastered.</p></section>
        </>}
      </div>
      {!empty && <div className="row recap-actions">
        <button className="btn primary grow" onClick={() => share("story")}>Share story</button>
        <button className="btn grow" onClick={() => share("square")}>Square</button>
        <button className="btn grow" onClick={async () => { try { await navigator.clipboard.writeText(text()); snackbar("Copied as text"); } catch { tellSheet("Couldn’t copy", "Your browser blocked the clipboard. Use Share story instead."); } }}>Text</button>
      </div>}
      {improve && <ImproveSheet nids={[improve]} onClose={() => setImprove(null)} />}
    </div>, document.body);
}

/** Draw the recap as a pixel-art image (1080×1920 story or 1080×1080 square) in the current theme's colours. */
async function drawCard(r: ReturnType<typeof store.recap> & { label: string }, shape: "story" | "square"): Promise<Blob> {
  try { await document.fonts.load('40px "Yuzu Pixel"'); } catch { /* falls back to monospace */ }
  const W = 1080, H = shape === "story" ? 1920 : 1080; const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d")!;
  const css = getComputedStyle(document.documentElement); const col = (v: string, d: string) => css.getPropertyValue(v).trim() || d;
  const ink = col("--ink", "#15120d"), ink2 = col("--ink-2", "#1f1a12"), line = col("--line", "#4a3f2b"), text = col("--text", "#f1e9d6"), muted = col("--muted", "#a99e86"), orange = col("--orange", "#ff7a1a"), yuzu = col("--yuzu", "#f2d34b");
  g.imageSmoothingEnabled = false; g.fillStyle = ink; g.fillRect(0, 0, W, H);
  // pixel border + corner notches
  g.fillStyle = line; g.fillRect(40, 40, W - 80, 8); g.fillRect(40, H - 48, W - 80, 8); g.fillRect(40, 40, 8, H - 80); g.fillRect(W - 48, 40, 8, H - 80);
  g.fillStyle = ink; for (const [x, y] of [[40, 40], [W - 48, 40], [40, H - 48], [W - 48, H - 48]]) g.fillRect(x, y, 8, 8);
  // a pixel yuzu
  const yz = (cx: number, cy: number, s: number) => { for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) { const d = Math.hypot(x, y); if (d > 7.2) continue; g.fillStyle = d > 6.2 ? "#3a2a07" : d > 5.2 ? yuzu : d < 1.2 ? "#fff3c2" : (Math.atan2(y, x) * 4 / Math.PI) % 1 > 0.85 ? "#fff3c2" : yuzu; g.fillRect(cx + x * s, cy + y * s, s, s); } };
  const px = (t: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "left") => { g.font = `${size}px "Yuzu Pixel", monospace`; g.fillStyle = color; g.textAlign = align; g.fillText(t, x, y); };
  const body = (t: string, x: number, y: number, size: number, color: string, maxW: number, align: CanvasTextAlign = "left") => { g.font = `600 ${size}px system-ui, sans-serif`; g.fillStyle = color; g.textAlign = align; const words = t.split(" "); let lineT = "", yy = y; for (const w of words) { const test = lineT ? lineT + " " + w : w; if (g.measureText(test).width > maxW && lineT) { g.fillText(lineT, x, yy); lineT = w; yy += size * 1.35; } else lineT = test; } if (lineT) g.fillText(lineT, x, yy); return yy + size * 1.35; };
  // Numbers in the pixel font: glyphs placed by their ink with one even gap, so "1,152" doesn't get a hole after the narrow "1".
  const pxNum = (t: string, cx: number, y: number, size: number, color: string) => { g.font = `${size}px "Yuzu Pixel", monospace`; g.fillStyle = color; g.textAlign = "left"; const gap = Math.round(size * 0.14); const m = [...t].map((ch) => { const k = g.measureText(ch); const ink = k.actualBoundingBoxRight + k.actualBoundingBoxLeft; return { ch, left: k.actualBoundingBoxLeft, w: ink > 0 ? ink : k.width * 0.5 }; }); let x = cx - (m.reduce((a, q) => a + q.w, 0) + gap * (m.length - 1)) / 2; for (const q of m) { g.fillText(q.ch, x + q.left, y); x += q.w + gap; } };
  const story = shape === "story"; let y = story ? 170 : 130;
  yz(W / 2, y, story ? 10 : 7); y += story ? 150 : 110;
  px("YUZU RECAP", W / 2, y, 40, orange, "center"); y += 60; px(r.label.toUpperCase(), W / 2, y, 30, muted, "center"); y += story ? 120 : 80;
  px(r.persona.toUpperCase(), W / 2, y, story ? 40 : 30, yuzu, "center"); y += 30; y = body(r.personaWhy, W / 2, y + 30, story ? 34 : 28, text, W - 220, "center") + (story ? 60 : 20);
  const tiles: [string, string][] = [[r.reviews.toLocaleString(), "reviews"], [`${r.minutes.toLocaleString()}`, "minutes"], [r.recall !== null ? `${Math.round(r.recall * 100)}%` : "–", "recalled"], [r.knowledge.toLocaleString(), "known now"]];
  const tw = (W - 240) / 2, th = story ? 190 : 150;
  tiles.forEach(([v, l], i) => { const x = 100 + (i % 2) * (tw + 40), yy = y + Math.floor(i / 2) * (th + 30); g.fillStyle = ink2; g.fillRect(x, yy, tw, th); g.fillStyle = line; g.fillRect(x, yy, tw, 6); g.fillRect(x, yy + th - 6, tw, 6); g.fillRect(x, yy, 6, th); g.fillRect(x + tw - 6, yy, 6, th); pxNum(v, x + tw / 2, yy + th / 2 + 10, story ? 40 : 30, text); body(l, x + tw / 2, yy + th - (story ? 40 : 28), story ? 30 : 24, muted, tw - 20, "center"); });
  y += 2 * (th + 30) + (story ? 40 : 10);
  if (story && r.topSys.length) { px("TOP SYSTEMS", 100, y, 20, orange); y += 50; for (const [i, t] of r.topSys.entries()) { body(`${i + 1}. ${t.name} — ${t.n.toLocaleString()} answers${t.recall !== null ? ` · ${Math.round(t.recall * 100)}% recall` : ""}`, 100, y, 32, text, W - 200); y += 52; } y += 30; }
  if (story) { // the lower third: mastered and the biggest day as tiles, then the nemesis (its gap shown as […], never the answer)
    const low: [string, string][] = [[r.masteredNow.toLocaleString(), "cards mastered"], r.bestDay ? [r.bestDay.n.toLocaleString(), `best day · ${fmtDate(r.bestDay.day)}`] : [String(r.longestRun), "longest run (days)"]];
    const lh = 160; low.forEach(([v, l], i) => { const x = 100 + i * (tw + 40); g.fillStyle = ink2; g.fillRect(x, y, tw, lh); g.fillStyle = line; g.fillRect(x, y, tw, 6); g.fillRect(x, y + lh - 6, tw, 6); g.fillRect(x, y, 6, lh); g.fillRect(x + tw - 6, y, 6, lh); pxNum(v, x + tw / 2, y + 78, 40, yuzu); body(l, x + tw / 2, y + lh - 36, 28, muted, tw - 20, "center"); });
    y += lh + 60;
    if (r.nemesis && y < H - 280) { px("NEMESIS", 100, y, 20, orange); y += 50; const q = r.nemesis.title.length > 110 ? r.nemesis.title.slice(0, 109).trimEnd() + "…" : r.nemesis.title; y = body(`“${q}”`, 100, y, 32, text, W - 200); body(`missed ${r.nemesis.misses} times`, 100, y, 28, muted, W - 200); }
  }
  px("yuzu · spaced repetition", W / 2, H - 90, 20, muted, "center");
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}
