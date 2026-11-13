// Quick capture: a thought or a photo saved in a few seconds. It waits in Drive's outbox for Claude to turn into cards.
import { useState } from "react";
import { store } from "../lib/store";
import { IconClose } from "./icons";
import { shrinkImage } from "./Occlusion";
import { FileButton, Sheet, snackbar } from "./kit";

export function CaptureSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState(""); const [image, setImage] = useState(""); const [busy, setBusy] = useState(false);
  store.getVersion(); const waiting = store.captures.filter((c) => !c.sent).length;
  return (
    <Sheet title="Capture" closeLabel="Close capture" onClose={onClose} dirty={!!text.trim() || !!image} discard="Discard this capture?" style={{ maxHeight: "92vh", overflow: "auto" }}>
      <p className="small muted" style={{ marginTop: 4 }}>Something you want as a card but can't make one for now. Write it or take a photo; it's left in Drive for Claude, who turns it into cards and sends them back to your Inbox.</p>
      <textarea className="typeans" rows={3} aria-label="Capture text" placeholder="What did you just learn or get wrong?" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <FileButton label={image ? "Change photo" : "Add photo"} inputLabel="Photo" accept="image/*" capture="environment" onFile={async (f) => { setBusy(true); try { setImage(await shrinkImage(f, 1400)); } catch { snackbar("That file couldn't be read as a picture"); } finally { setBusy(false); } }} />
        {image && <img src={image} alt="" style={{ height: 48, borderRadius: 6 }} />}
        <span className="grow" />
        <button className="btn primary" disabled={busy || (!text.trim() && !image)} onClick={async () => { await store.addCapture({ text, image: image || undefined }); setText(""); setImage(""); snackbar(store.syncBackend() === "drive" ? "Captured — on its way to Claude" : "Captured"); }}>Save</button>
      </div>
      {store.captures.length > 0 && <>
        <h2 style={{ marginTop: 14 }}>Captured</h2>
        {store.captures.slice(0, 8).map((c) => <div key={c.id} className="row small" style={{ gap: 8, margin: "6px 0", alignItems: "center" }}>
          {c.image && <img src={c.image} alt="" style={{ height: 32, borderRadius: 4 }} />}
          <span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.text || "(photo)"}{c.source !== "yuzu" ? ` · from ${c.source}` : ""}</span>
          <span className="chip">{c.sent ? "with Claude" : "waiting"}</span>
          <button className="icon-btn" aria-label="Remove capture" onClick={() => store.removeCapture(c.id)}><IconClose /></button>
        </div>)}
        {waiting > 0 && <p className="small muted" style={{ marginBottom: 0 }}>{waiting} waiting for Google to be connected.</p>}
      </>}
    </Sheet>
  );
}
