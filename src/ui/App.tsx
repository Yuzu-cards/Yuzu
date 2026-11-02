import { Component, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { store, type View } from "../lib/store";
import { Today } from "./Today";
import { Library } from "./Library";
import { Settings } from "./Settings";
import { Study, loadSession, type StudyScope } from "./Study";
import { IconToday, IconLibrary, IconProgress, IconSettings, YuzuMark } from "./icons";
import { Progress } from "./Progress";
import { Boss } from "./Boss";
import { Inbox } from "./Inbox";
import { ConfirmHost, HintLayer, SnackbarHost, confirmSheet, tellSheet } from "./kit";

type Tab = "today" | "library" | "progress" | "settings";
const TAB_HINTS: Record<Tab, string> = {
  today: "Today|What's ready to study, your goal, the week ahead and suggestions.",
  library: "Library|Every card by deck, system, specialty, exam or tag. Filters, search, preview, edit.",
  progress: "Progress|Streak, retention, mastery by system, mastered cards, recaps and how well the scheduler knows you.",
  settings: "Settings|Studying, look and sound, media, sync, backups.",
};

/** Wipe caches and the service worker, then reload: fixes a broken update without touching the data. */
export async function repairApp() {
  try { const regs = await navigator.serviceWorker?.getRegistrations?.() ?? []; await Promise.all(regs.map((r) => r.unregister())); } catch { /* ignore */ }
  try { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } catch { /* ignore */ }
  location.reload();
}

function downloadBackup() {
  try {
    const blob = new Blob([JSON.stringify(store.backup())], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `yuzu-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  } catch (e) { tellSheet("Backup failed", (e as any)?.message); }
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { import("../lib/db").then((db) => db.setMeta("lastError", { at: Date.now(), where: "render", message: error.message, stack: error.stack }).catch(() => {})); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="screen">
        <h1>Something went wrong</h1>
        <div className="card-box">
          <p className="small">Yuzu hit an error while drawing the screen. Your cards and reviews are safe in the database; this only affects the display.</p>
          <pre className="small muted" style={{ whiteSpace: "pre-wrap", userSelect: "text" }}>{this.state.error.message}</pre>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary grow" onClick={() => location.reload()}>Reload</button>
            {store.loaded && <button className="btn grow" onClick={downloadBackup}>Download backup</button>}
          </div>
          <button className="btn block" style={{ marginTop: 10 }} onClick={repairApp}>Repair app (clear cached version and reload)</button>
        </div>
      </div>
    );
  }
}

function Recovery({ error }: { error: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="screen">
      <h1>Yuzu couldn't start</h1>
      <div className="card-box">
        <p className="small">The database on this device could not be opened.</p>
        <pre className="small muted" style={{ whiteSpace: "pre-wrap", userSelect: "text" }}>{error}</pre>
        <p className="small muted">Usual causes: another Yuzu tab is open with an older version (close it), the browser is in a private window, or storage is full.</p>
        <button className="btn primary block" disabled={busy} onClick={() => location.reload()}>Try again</button>
        <button className="btn block" style={{ marginTop: 10 }} onClick={repairApp}>Repair app (clear cached version and reload)</button>
        <button className="btn danger block" style={{ marginTop: 10 }} disabled={busy} onClick={async () => { if (await confirmSheet({ title: "Reset this device?", sub: "The database here is deleted and the app starts empty. You can then restore a backup or sync from your repository.", yes: "Delete and start empty" })) { setBusy(true); try { await indexedDB.deleteDatabase("yuzu"); } finally { location.reload(); } } }}>Reset this device</button>
      </div>
    </div>
  );
}

export function App() { return <ErrorBoundary><AppInner /><HintLayer /><SnackbarHost /><ConfirmHost /></ErrorBoundary>; }

function AppInner() {
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const [tab, setTab] = useState<Tab>("today");
  // A session interrupted by a reload comes back where it was.
  const [study, setStudy] = useState<(StudyScope & { boss?: string }) | null>(() => { const r = loadSession(); return r ? { ...r.scope, path: r.scope.path, resume: r } : null; });
  const startStudy = (path: string, view: View = "decks", extra: Partial<StudyScope> = {}) => setStudy({ path, view, ...extra });
  const startBoss = (path: string, view: View, name: string) => setStudy({ path, view, boss: name });
  const [update, setUpdate] = useState<(() => void) | null>(null);
  const [inbox, setInbox] = useState(false);
  const [libraryTarget, setLibraryTarget] = useState<{ view: View; path: string; query?: string; only?: "flagged" | "improve" | "suspended" | "leech" | "overfilled"; n: number } | null>(null);
  const browse = (view: View, path: string, query?: string, only?: "flagged" | "improve" | "suspended" | "leech" | "overfilled") => { setStudy(null); setInbox(false); setTab("library"); setLibraryTarget({ view, path, query, only, n: Date.now() }); };
  const browseTag = (tag: string) => {
    if (tag.startsWith("auto::System::")) browse("systems", tag.slice(14));
    else if (tag.startsWith("auto::Specialty::")) browse("specialties", tag.slice(17));
    else if (tag.startsWith("auto::Exam::")) browse("exams", tag.slice(12));
    else browse("tags", tag);
  };

  useEffect(() => {
    const onUpdate = (e: Event) => setUpdate(() => (e as CustomEvent).detail as () => void);
    window.addEventListener("yuzu:update", onUpdate);
    return () => window.removeEventListener("yuzu:update", onUpdate);
  }, []);

  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(t); }, []);
  if (store.loadError) return <Recovery error={store.loadError} />;
  if (!store.loaded) {
    return <div className="screen" style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", justifyContent: "center", minHeight: "80dvh" }}><YuzuMark size={64} /><div className="px muted" style={{ fontSize: 10, lineHeight: "10px" }}>loading…</div>{slow && <div className="small muted" style={{ textAlign: "center" }}>Still loading… a large collection can take a few seconds.<br /><button className="btn" style={{ marginTop: 10 }} onClick={repairApp}>Repair app</button></div>}</div>;
  }
  if (study !== null && study.boss !== undefined) return <Boss path={study.path} view={study.view ?? "decks"} name={study.boss} onExit={() => setStudy(null)} />;
  if (study !== null) return <Study {...study} onExit={() => setStudy(null)} onBrowseTag={browseTag} onSearch={(q) => browse("decks", "", q)} />;

  return (
    <div className="app">
      {inbox ? <Inbox onClose={() => setInbox(false)} /> : <>
      {tab === "today" && <Today onStudy={startStudy} onInbox={() => setInbox(true)} onSearch={(q) => browse("decks", "", q)} onBoss={startBoss} onFilter={(f) => browse("decks", "", undefined, f)} onTab={setTab} />}
      {tab === "library" && <Library onStudy={startStudy} onBoss={startBoss} initial={libraryTarget} />}
      {tab === "progress" && <Progress onBoss={startBoss} />}
      {tab === "settings" && <Settings onInbox={() => setInbox(true)} />}
      </>}
      {store.saveError && <div className="toast row" style={{ borderColor: "var(--again)" }}>Changes are not being saved ({store.saveError}). <button className="btn" style={{ minHeight: 32, padding: "4px 12px" }} onClick={downloadBackup}>Back up now</button></div>}
      {update && <div className="toast row">New version ready <button className="btn primary" style={{ minHeight: 32, padding: "4px 12px" }} onClick={update}>Update</button></div>}
      <nav className="tabs">
        {([["today", "Today", <IconToday />], ["library", "Library", <IconLibrary />], ["progress", "Progress", <IconProgress />], ["settings", "Settings", <IconSettings />]] as const).map(([k, label, icon]) => (
          <button key={k} className={"tab" + (tab === k ? " active" : "")} data-hint={TAB_HINTS[k]} onClick={() => { if (tab !== k) window.scrollTo(0, 0); setTab(k); setInbox(false); }}>{icon}{label}</button>
        ))}
      </nav>
    </div>
  );
}
