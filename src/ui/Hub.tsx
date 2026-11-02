import { useEffect, useState } from "react";
import { connect, disconnect, hubState, hubSync, onHubChange, HUB } from "../lib/citrus";

/** Settings › Citrus Maxima: sign in once with the shared Google client, then Yuzu reports to the hub and shows what Citrus planned. */
export function HubSection() {
  const [, tick] = useState(0);
  useEffect(() => onHubChange(() => tick((n) => n + 1)), []);
  const s = hubState();
  const [cid, setCid] = useState(s.clientId);
  const [msg, setMsg] = useState("");
  async function signIn() {
    setMsg("Opening Google…");
    try { await connect({ clientId: cid }); setMsg(""); await hubSync(true); }
    catch (e: any) { setMsg(e.message); }
  }
  const fmt = (iso: string | number) => { try { const d = new Date(iso); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; } catch { return ""; } };
  return (
    <div className="card-box">
      <p className="small muted" style={{ marginTop: 0 }}>Yuzu writes one small file to your Google Drive — <b>My Apps › hub › yuzu › status.json</b> (cards due, streak, minutes needed) — so Citrus Maxima can plan your reviews around your shifts, plus an hourly scheduling backup. Same client ID as Citrus, Orange and Mephisto.</p>
      {!s.connected ? (<>
        <label className="small muted">Google client ID</label>
        <input value={cid} onChange={(e) => setCid(e.target.value)} placeholder="…apps.googleusercontent.com" style={{ width: "100%", margin: "4px 0 8px" }} />
        <button className="btn primary block" onClick={signIn} disabled={!cid.trim()}>Sign in with Google</button>
      </>) : (<>
        <div className="row small" style={{ gap: 8 }}><span className="grow">{s.email}{s.last ? ` · shared ${fmt(s.last)}` : ""}</span><button className="btn" onClick={() => hubSync(true)}>Share now</button><button className="btn" onClick={() => disconnect()}>Sign out</button></div>
        {s.err && <p className="small" style={{ color: "#ff5f6d", margin: "6px 0 0" }}>{s.err}</p>}
        {s.plan.length ? (<div style={{ marginTop: 10 }}>
          <div className="small muted">Planned by Citrus{s.planAt ? ` (${fmt(s.planAt)})` : ""}</div>
          <ul className="small" style={{ listStyle: "none", padding: 0, margin: "4px 0 0" }}>
            {s.plan.map((b, i) => <li key={i}>{b.date.slice(8, 10)}/{b.date.slice(5, 7)} {b.start}{b.end ? `–${b.end}` : ""} · {b.title} · {b.minutes} min{b.status === "accepted" ? " ✓" : ""}</li>)}
          </ul>
        </div>) : <p className="small muted" style={{ margin: "6px 0 0" }}>No Citrus plan yet — open Citrus Maxima › Plan.</p>}
      </>)}
      {msg && <p className="small muted" style={{ marginBottom: 0 }}>{msg}</p>}
      <p className="small muted" style={{ margin: "8px 0 0" }}>Add <code>{typeof location !== "undefined" ? location.origin : HUB.url}</code> to the client's authorized JavaScript origins once.</p>
    </div>
  );
}
