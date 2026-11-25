// Record yourself and compare (1.10.0, after AnkiDroid's "check pronunciation"): on the back of a language card, say the
// line, then hear yourself and the model one after the other. The recording lives in memory only and is gone on the next
// card; nothing is saved or sent anywhere.
import { useEffect, useRef, useState } from "react";
import { IconSound } from "./icons";

export const canRecord = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof (globalThis as any).MediaRecorder === "function";

export function SayIt({ model }: { /** plays the model (the card's own recording, else the device voice); resolves when done */ model: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "rec" | "ready" | "error">("idle"); const [msg, setMsg] = useState("");
  const rec = useRef<MediaRecorder | null>(null); const stream = useRef<MediaStream | null>(null);
  const release = () => { try { stream.current?.getTracks?.().forEach((t) => t.stop()); } catch { /* fine */ } stream.current = null; }; const url = useRef<string | null>(null); const timer = useRef<ReturnType<typeof setTimeout>>(undefined); const audio = useRef<HTMLAudioElement | null>(null);
  // leaving the card (or the session) never throws: the microphone is let go, the recording forgotten
  useEffect(() => () => { try { if (rec.current?.state === "recording") rec.current.stop(); } catch { /* fine */ } release(); try { if (url.current) URL.revokeObjectURL(url.current); audio.current?.pause(); } catch { /* fine */ } clearTimeout(timer.current); }, []);
  async function start() {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = st; const chunks: Blob[] = [];
      const r = new MediaRecorder(st); rec.current = r;
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = () => { release(); if (url.current) URL.revokeObjectURL(url.current); url.current = URL.createObjectURL(new Blob(chunks, { type: r.mimeType || "audio/webm" })); setState("ready"); clearTimeout(timer.current); };
      r.start(); setState("rec"); setMsg(""); timer.current = setTimeout(() => stop(), 15000); // a line, not a speech
    } catch (e: any) { setState("error"); setMsg(/denied|NotAllowed/i.test(String(e?.name ?? e)) ? "The microphone isn't allowed — allow it for this site in the browser" : "No microphone here"); }
  }
  function stop() { try { if (rec.current?.state === "recording") rec.current.stop(); } catch { /* fine */ } }
  const playMine = () => new Promise<void>((res) => { if (!url.current) return res(); audio.current?.pause(); const a = new Audio(url.current); audio.current = a; a.onended = () => res(); a.onerror = () => res(); a.play().catch(() => res()); });
  async function compare() { await playMine(); await new Promise((r) => setTimeout(r, 350)); await model(); }
  return (
    <div className="say-it" onClick={(e) => e.stopPropagation()} data-testid="say-it">
      {state !== "rec" ? <button className="btn" onClick={start} title="Say the line, then compare it with the model">🎙 {state === "ready" ? "Again" : "Say it"}</button>
        : <button className="btn primary rec" onClick={stop}>■ Stop</button>}
      {state === "ready" && <><button className="btn" onClick={() => void playMine()}>Mine</button><button className="btn" onClick={() => void compare()} data-testid="say-compare"><IconSound size={16} /> Mine, then model</button></>}
      {msg && <span className="small muted">{msg}</span>}
    </div>
  );
}
