// Google Drive as Yuzu's home: the media master copy (My Apps/Yuzu/media) and the card collection (My Apps/Yuzu/collection).
//
// Media: an index name → {id, size} is kept here and refreshed through the Drive changes feed, so 47,000 files are listed
// once and then only what changed is read. Collection: the same shards and manifest as the GitHub sync (notes/*.json,
// cards/*.json, reviews/<month>.json, settings.json …), one Drive file each. manifest.json carries a revision stamp;
// a push re-reads it just before writing and stops when another device moved it. A lock.json file keeps two devices
// from uploading at once (written, then read back: ours or not).
import { HUB_ROOT, DRIVE, GoogleError, ensureFolders, findFolders, listFiles, downloadBytes, putFile, deleteFile, gjson, type DriveFile } from "./google";
import { SyncError, gzip, gunzip, GZIP_ABOVE, sameDevice, pool, type Manifest, type SyncSnapshot, type Progress } from "./sync";

export const PATHS = { media: [HUB_ROOT, "Yuzu", "media"], collection: [HUB_ROOT, "Yuzu", "collection"], inbox: [HUB_ROOT, "Yuzu", "collection", "inbox"], hub: [HUB_ROOT, "hub", "yuzu"], plan: [HUB_ROOT, "hub", "scheduler"], planCitrus: [HUB_ROOT, "hub", "citrus"], rotas: [HUB_ROOT, "Rotas"], rotasOrange: ["Citrus Maxima", "Rotas"] };
export interface DriveIndex { media: string; files: Record<string, { id: string; s: number }>; changes: string; at: number; complete: boolean; nextPage?: string }

// ---------------------------------------------------------------- media
export class DriveMedia {
  constructor(private cache: Record<string, string>) {}
  async ensure(prev: DriveIndex | null): Promise<DriveIndex> {
    if (prev?.media) return prev;
    const media = await ensureFolders(PATHS.media, this.cache);
    const start = await gjson(`${DRIVE}/changes/startPageToken`);
    return { media, files: {}, changes: start?.startPageToken ?? "", at: 0, complete: false };
  }
  /** A fresh index lists the folder 1,000 files a page (bounded per run, cursor kept); a complete one reads the changes feed. */
  async refresh(idx: DriveIndex, budgetMs = 20000, progress?: (m: string) => void): Promise<DriveIndex> {
    const t0 = Date.now(); const out: DriveIndex = { ...idx, files: { ...idx.files } };
    if (!out.complete) {
      const qs = `'${out.media}' in parents and trashed = false`;
      do {
        const page = await gjson(`${DRIVE}/files?q=${encodeURIComponent(qs)}&fields=nextPageToken,files(id,name,size)&pageSize=1000&spaces=drive${out.nextPage ? `&pageToken=${encodeURIComponent(out.nextPage)}` : ""}`);
        for (const f of page?.files ?? []) out.files[f.name] = { id: f.id, s: Number(f.size) || 0 };
        out.nextPage = page?.nextPageToken || undefined; progress?.(`Reading Drive: ${Object.keys(out.files).length.toLocaleString()} files`);
        if (!out.nextPage) { out.complete = true; break; }
      } while (Date.now() - t0 < budgetMs);
      out.at = Date.now(); return out;
    }
    let token = out.changes;
    for (let i = 0; i < 50 && token; i++) {
      const page = await gjson(`${DRIVE}/changes?pageToken=${encodeURIComponent(token)}&fields=nextPageToken,newStartPageToken,changes(removed,file(id,name,size,parents,trashed))&pageSize=1000&spaces=drive`);
      for (const c of page?.changes ?? []) {
        const f = c.file; if (!f) continue; const ours = (f.parents ?? []).includes(out.media);
        if (c.removed || f.trashed || !ours) { for (const [n, v] of Object.entries(out.files)) if (v.id === f.id) delete out.files[n]; }
        else out.files[f.name] = { id: f.id, s: Number(f.size) || 0 };
      }
      token = page?.nextPageToken || ""; if (page?.newStartPageToken) out.changes = page.newStartPageToken;
    }
    out.at = Date.now(); return out;
  }
  /** Upload one file. The index is complete and authoritative, so a name it lacks is created without a lookup first. */
  async upload(idx: DriveIndex, name: string, blob: Blob): Promise<string> { const id = idx.files[name]?.id || null; return putFile({ parent: idx.media, name, body: blob, mime: blob.type || "application/octet-stream", id, isNew: !id && idx.complete }); }
  async download(id: string): Promise<Blob | null> { const b = await downloadBytes(id); return b ? new Blob([b as BlobPart]) : null; }
}

// ---------------------------------------------------------------- collection sync
type Listing = Map<string, DriveFile>; // name → file
const toText = (b: Uint8Array) => new TextDecoder().decode(b);
export class DriveSync {
  static LOCK_MS = 12 * 60000;
  private folder = ""; private listing: Listing | null = null; private seenRev: string | null | undefined = undefined; private holdsLock = false; private inboxId = "";
  constructor(private cache: Record<string, string>, private device: string) {}
  private async open() { if (!this.folder) this.folder = await ensureFolders(PATHS.collection, this.cache); return this.folder; }
  private dupes: DriveFile[] = [];
  /** The collection folder by name. Drive allows two files with one name (a create retried after its answer was lost): the newest wins, the rest are removed after the next good sync. */
  private async list(): Promise<Listing> {
    await this.open(); const m: Listing = new Map(); this.dupes = [];
    const all = (await listFiles({ parent: this.folder, all: true })).filter((f) => f.mimeType !== "application/vnd.google-apps.folder");
    all.sort((a, b) => ((a.modifiedTime ?? "") < (b.modifiedTime ?? "") ? 1 : -1));
    for (const f of all) { if (m.has(f.name)) this.dupes.push(f); else m.set(f.name, f); }
    this.listing = m; return m;
  }
  private async readText(name: string, stored?: Record<string, string>): Promise<string | null> {
    const real = stored?.[name] ?? name; const f = (this.listing ?? (await this.list())).get(real); if (!f) return null;
    const b = await downloadBytes(f); if (!b) return null; return real.endsWith(".gz") ? gunzip(b) : toText(b);
  }
  async check(): Promise<{ ok: boolean; message: string }> {
    try { const m = await this.pullManifest(); return { ok: true, message: m ? `Drive holds a Yuzu collection from ${m.device || "another device"} (${new Date(m.updatedAt).toLocaleString()})` : "Drive is ready — the first sync fills My Apps/Yuzu/collection." }; }
    catch (e: any) { return { ok: false, message: e.message }; }
  }
  async pullManifest(): Promise<Manifest | null> {
    await this.list(); const t = await this.readText("manifest.json"); if (!t) { this.seenRev = null; return null; }
    const m = JSON.parse(t) as Manifest & { rev?: string }; if (!m || typeof m !== "object" || !m.files) throw new SyncError("manifest.json on Drive is not a Yuzu manifest", "other");
    this.seenRev = m.rev ?? String(m.updatedAt); return m;
  }
  async acquireLock(device: string, id = ""): Promise<{ held: boolean; by?: string }> {
    const now = Date.now(); const cur = await this.readText("lock.json").then((t) => (t ? JSON.parse(t) : null), () => null);
    if (cur && cur.until > now && !sameDevice(cur, device, id)) return { held: false, by: cur.device };
    const mine = { device, id, until: now + DriveSync.LOCK_MS, n: Math.random().toString(36).slice(2) };
    const fileId = await putFile({ parent: await this.open(), name: "lock.json", body: JSON.stringify(mine), id: this.listing?.get("lock.json")?.id ?? null });
    this.listing?.set("lock.json", { id: fileId, name: "lock.json" });
    await new Promise((r) => setTimeout(r, 400)); // two devices writing at once: whoever's content is there after a moment holds it
    const back = await downloadBytes(fileId).then((b) => (b ? JSON.parse(toText(b)) : null), () => null);
    if (!back || back.n !== mine.n) return { held: false, by: back?.device ?? "another device" };
    this.holdsLock = true; return { held: true };
  }
  async releaseLock(): Promise<void> { if (!this.holdsLock) return; this.holdsLock = false; const f = this.listing?.get("lock.json"); if (f) { try { await putFile({ parent: this.folder, name: "lock.json", body: JSON.stringify({ device: this.device, until: 0 }), id: f.id }); } catch { /* it expires anyway */ } } }
  async pullChanged(manifest: Manifest, known: Record<string, string>, progress?: Progress): Promise<Partial<SyncSnapshot> & { files: Record<string, string> }> {
    const changed = Object.entries(manifest.files).filter(([p, h]) => known[p] !== h);
    const out: Partial<SyncSnapshot> & { files: Record<string, string> } = { files: {} }; const parsed: [string, any][] = []; let done = 0; const queue = [...changed];
    await pool(queue, 4, async ([p]) => { const t = await this.readText(p, manifest.stored); if (t != null) { try { parsed.push([p, JSON.parse(t)]); } catch { throw new SyncError(`${p} on Drive is corrupt; sync stopped without changing anything`, "other"); } } done++; progress?.(`Downloading ${done} of ${changed.length} changed files`); });
    for (const [p, data] of parsed) {
      out.files[p] = manifest.files[p];
      if (p === "notetypes.json") out.notetypes = data; else if (p === "settings.json") out.settings = data; else if (p === "tombstones.json") out.tombstones = data;
      else if (p === "media.json") out.media = data; else if (p === "hooks.json") out.hooks = data; else if (p === "mastery.json") out.mastery = data; else if (p === "improve.json") out.improve = data;
      else if (p.startsWith("notes/")) out.notes = (out.notes ?? []).concat(data); else if (p.startsWith("cards/")) out.cards = (out.cards ?? []).concat(data); else if (p.startsWith("reviews/")) out.reviews = (out.reviews ?? []).concat(data);
    }
    return out;
  }
  /** Upload the shards whose hash differs from the remote manifest, delete the ones gone, then the manifest. */
  async push(hashes: Record<string, string>, make: (path: string) => string, remote: Manifest | null, device: string, progress?: Progress, counts?: Manifest["counts"]): Promise<{ manifest: Manifest; commit: string | null; pushed: number; bytes: number }> {
    const listing = this.listing ?? (await this.list());
    const toWrite = Object.keys(hashes).filter((p) => !remote || remote.files[p] !== hashes[p]);
    const stored: Record<string, string> = { ...(remote?.stored ?? {}) }; for (const p of Object.keys(stored)) if (!(p in hashes)) delete stored[p];
    const toDelete = remote ? Object.keys(remote.files).filter((p) => !(p in hashes)).map((p) => remote.stored?.[p] ?? p) : [];
    const rev = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
    const manifest: Manifest & { rev: string } = { version: 1, files: hashes, updatedAt: Date.now(), device, stored, counts, commits: 0, rev };
    if (!toWrite.length && !toDelete.length) return { manifest: remote ?? manifest, commit: null, pushed: 0, bytes: 0 };
    // Another device synced since our pull? Its manifest carries a different revision.
    const cur = await this.readText("manifest.json").then((t) => (t ? (JSON.parse(t) as any).rev ?? String((JSON.parse(t) as any).updatedAt) : null), () => null);
    if (this.seenRev !== undefined && cur !== this.seenRev) throw new SyncError("Another device synced in the meantime", "conflict");
    // Each file carries its content fingerprint (appProperties.h). A sync that was cut off (a dropped connection, the app
    // sent to the background) left its finished files on Drive: the next one skips those and carries on from there.
    let n = 0, bytes = 0, kept = 0; const total = toWrite.length; const queue = [...toWrite];
    const one = async (p: string) => {
      const json = make(p); const base = p.replace(/\//g, "__"); const real = json.length > GZIP_ABOVE ? base + ".gz" : base;
      const prevReal = stored[p] ?? base; const have = listing.get(real);
      if (have?.props?.h === hashes[p]) kept++;
      else {
        let body: BodyInit = json; if (real.endsWith(".gz")) { const gz = await gzip(json); body = new Blob([gz as BlobPart]); bytes += gz.length; } else bytes += json.length;
        const id = await putFile({ parent: this.folder, name: real, body, mime: real.endsWith(".gz") ? "application/gzip" : "application/json", id: have?.id ?? null, isNew: !have, props: { h: hashes[p] } });
        listing.set(real, { id, name: real, props: { h: hashes[p] } });
      }
      if (prevReal !== real) { const old = listing.get(prevReal); if (old) { try { await deleteFile(old.id); } catch { /* fine */ } listing.delete(prevReal); } }
      stored[p] = real; n++; progress?.(total >= 20 ? `Uploading ${n} of ${total} files${kept ? ` (${kept} already on Drive from an earlier try)` : " (the first Drive sync sends everything once)"}` : `Uploading ${n} of ${total} changed files`);
    };
    await pool(queue, 4, one);
    for (const real of toDelete) { const f = listing.get(real); if (f) { try { await deleteFile(f.id); } catch { /* fine */ } listing.delete(real); } }
    manifest.stored = stored;
    const mid = await putFile({ parent: this.folder, name: "manifest.json", body: JSON.stringify(manifest), id: listing.get("manifest.json")?.id ?? null });
    listing.set("manifest.json", { id: mid, name: "manifest.json" }); this.seenRev = rev;
    for (const d of this.dupes.splice(0)) { try { await deleteFile(d.id); } catch { /* next time */ } }
    await this.releaseLock();
    return { manifest, commit: rev, pushed: toWrite.length - kept, bytes };
  }
  async compact(): Promise<boolean> { return false; }
  async repoSizeMB(): Promise<number | null> { return null; }
  // Inbox: packs from Claude dropped into My Apps/Yuzu/collection/inbox
  private async inbox() { if (!this.inboxId) this.inboxId = await ensureFolders(PATHS.inbox, this.cache); return this.inboxId; }
  async listInbox(): Promise<{ name: string; sha: string; size: number }[]> { const id = await this.inbox(); return (await listFiles({ parent: id })).filter((f) => /\.json$/i.test(f.name)).map((f) => ({ name: f.name, sha: f.id, size: f.size ?? 0 })); }
  async readInbox(name: string): Promise<string | null> { const id = await this.inbox(); const f = (await listFiles({ parent: id, name }))[0]; if (!f) return null; const b = await downloadBytes(f); return b ? toText(b) : null; }
  async deleteInbox(_name: string, id: string): Promise<void> { await deleteFile(id); }
  async readBinary(): Promise<Uint8Array | null> { return null; } // media goes through DriveMedia, not the collection
}

// ---------------------------------------------------------------- the hub: status.json, plan.json, Rotas/
export interface HubStatus { app: "yuzu"; title: string; icon: string; color: string; url: string; version: string; device: string; updatedAt: string; summary: string; estimatedMinutes: number; due: number; streak: number; nextDue: string; today: { date: string; done: boolean; items: { title: string; minutes: number | null; cards: number }[] }; week: { start: string; end: string; done: number; target: number; need: number; days: { date: string; shift: string; studied: boolean; planned: boolean; slot: string }[] } | null; next: { title: string; minutes: number } | null; asks: { date: string | null; title: string; minutes: number; slot: string }[]; pending: string[]; extra: Record<string, unknown> }
export function statusFingerprint(status: HubStatus): string { const { updatedAt, ...rest } = status; const s = JSON.stringify(rest); let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16); }
export async function writeStatus(status: HubStatus, cache: Record<string, string>): Promise<string> {
  const parent = await ensureFolders(PATHS.hub, cache); const id = await putFile({ parent, name: "status.json", body: JSON.stringify(status, null, 1), id: cache.statusId || null }); cache.statusId = id; return id;
}
/** Citrus Maxima's plan.json (its publishPlan): 10 days of shifts and blocks per app. */
export interface CitrusBlock { app?: string; title?: string; date: string; start?: string; end?: string; minutes?: number; status?: string; goalId?: string }
export interface CitrusPlan { app?: string; updatedAt?: string; from?: string; days?: Record<string, { shift: { code?: string; label?: string; site?: string; start?: string; end?: string; overnight?: boolean } | null; blocks?: CitrusBlock[] }>; blocks?: CitrusBlock[] }
/** Citrus's plan: My Apps/hub/citrus/plan.json (where Citrus writes it; hub/scheduler/plan.json as the older name). null when there is none yet. */
export async function readPlan(cache: Record<string, string>): Promise<CitrusPlan | null> {
  for (const path of [PATHS.planCitrus, PATHS.plan]) {
    const parent = await findFolders(path, cache); if (!parent) continue;
    const f = (await listFiles({ parent, name: "plan.json" }))[0]; if (!f) continue;
    const b = await downloadBytes(f); if (!b) continue; try { return JSON.parse(toText(b)); } catch { /* try the other */ }
  }
  return null;
}
const isSheet = (f: DriveFile) => f.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || f.mimeType === "application/vnd.google-apps.spreadsheet" || /\.xlsx$/i.test(f.name);
/** Schedule files this device hasn't read (seen: id → modifiedTime), from My Apps/Rotas (Citrus) and Citrus Maxima/Rotas (Orange). */
export async function newRotaFiles(seen: Record<string, string>, cache: Record<string, string>): Promise<{ files: DriveFile[]; seen: Record<string, string> }> {
  const files: DriveFile[] = [];
  for (const [i, path] of [PATHS.rotas, PATHS.rotasOrange].entries()) {
    const parent = i === 0 ? await ensureFolders(path, cache) : await findFolders(path, cache); if (!parent) continue;
    files.push(...(await listFiles({ parent })).filter(isSheet));
  }
  // newest first, and the same file name in both folders counts once (whichever is newer)
  files.sort((a, b) => ((a.modifiedTime ?? "") < (b.modifiedTime ?? "") ? 1 : -1));
  const byName = new Map<string, DriveFile>(); for (const f of files) if (!byName.has(f.name)) byName.set(f.name, f);
  const list = [...byName.values()].slice(0, 12);
  const next: Record<string, string> = {}; for (const f of list) next[f.id] = f.modifiedTime ?? "";
  return { files: list.filter((f) => seen[f.id] !== (f.modifiedTime ?? "")), seen: next };
}
/** One-time cleanup: the hourly scheduling backup an early bridge build wrote to My Apps/hub/yuzu/state.json (stale; the collection lives in My Apps/Yuzu). */
export async function trashStale(cache: Record<string, string>): Promise<void> {
  const parent = await findFolders(PATHS.hub, cache); if (!parent) return;
  for (const f of await listFiles({ parent, name: "state.json" })) await gjson(`${DRIVE}/files/${encodeURIComponent(f.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
}
export { GoogleError };
