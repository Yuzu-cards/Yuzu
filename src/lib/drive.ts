// Google Drive as Yuzu's home: the media master copy (My Apps/Yuzu/media) and the card collection (My Apps/Yuzu/collection).
//
// Media: an index name → {id, size, offset} is kept here and refreshed through the Drive changes feed, so the folder is
// listed once and then only what changed is read; files travel in bundles (below). Collection: the same shards and manifest as the GitHub sync (notes/*.json,
// cards/*.json, reviews/<month>.json, settings.json …), one Drive file each. manifest.json carries a revision stamp;
// a push re-reads it just before writing and stops when another device moved it. A lock.json file keeps two devices
// from uploading at once (written, then read back: ours or not).
import { HUB_ROOT, DRIVE, GoogleError, ensureFolders, findFolders, listFiles, downloadBytes, putFile, deleteFile, copyFile, gjson, fileMeta, rangeSupported, type DriveFile } from "./google";
import { mimeFor } from "../import/media";
import { SyncError, gzip, gunzip, GZIP_ABOVE, sameDevice, pool, type Manifest, type SyncSnapshot, type Progress } from "./sync";

export const PATHS = { media: [HUB_ROOT, "Yuzu", "media"], collection: [HUB_ROOT, "Yuzu", "collection"], inbox: [HUB_ROOT, "Yuzu", "collection", "inbox"], hub: [HUB_ROOT, "hub", "yuzu"], plan: [HUB_ROOT, "hub", "scheduler"], planCitrus: [HUB_ROOT, "hub", "citrus"], rotas: [HUB_ROOT, "Rotas"], rotasOrange: ["Citrus Maxima", "Rotas"], backups: [HUB_ROOT, "Yuzu", "backups"] };
export interface DriveEntry { id: string; s: number; o?: number; m?: string } // o: offset inside a bundle (absent for a loose file), m: type
export interface DriveIndex { media: string; files: Record<string, DriveEntry>; changes: string; at: number; complete: boolean; nextPage?: string; bundles?: Record<string, { n: string; t: number; s: number; read: boolean }>; tocs?: Record<string, string> }

// ---------------------------------------------------------------- media
// Media goes up and down in bundles: a few hundred files packed into one ~6 MB Drive file, so 47,000 images are ~300
// requests instead of 47,000 (Drive allows only a few new files a second per account, which is what made one-by-one
// uploads take hours). A bundle is immutable and describes itself: "YZB1", the header length (uint32, little-endian), a JSON
// header {v:1, f:[[name, offset, size, type]]}, then the files' bytes; appProperties {yzb:"1", t:<bytes before the data>}
// let a device read just the header with one ranged request. Loose files (dragged into the folder from a PC, or larger
// than a bundle) keep working as before. One file is fetched on its own with a ranged request.
export const BUNDLE_BYTES = 6 * 1048576, BUNDLE_FILES = 500, LOOSE_ABOVE = 3 * 1048576;
const MAGIC = new TextEncoder().encode("YZB1");
export function makeBundle(items: { name: string; blob: Blob }[]): { blob: Blob; head: number; entries: [string, DriveEntry][] } {
  let off = 0; const f: [string, number, number, string][] = [];
  for (const it of items) { f.push([it.name, off, it.blob.size, it.blob.type || ""]); off += it.blob.size; }
  const header = new TextEncoder().encode(JSON.stringify({ v: 1, f })); const head = 8 + header.length;
  const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, header.length, true);
  const blob = new Blob([MAGIC as BlobPart, len as BlobPart, header as BlobPart, ...items.map((i) => i.blob)], { type: "application/octet-stream" });
  return { blob, head, entries: f.map(([n, o, sz, m]) => [n, { id: "", s: sz, o: head + o, ...(m ? { m } : {}) }]) };
}
export function parseBundleHeader(b: Uint8Array): { head: number; entries: [string, Omit<DriveEntry, "id">][] } | null {
  if (b.length < 8 || MAGIC.some((x, i) => b[i] !== x)) return null;
  const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, true); if (b.length < 8 + n) return null;
  const j = JSON.parse(new TextDecoder().decode(b.subarray(8, 8 + n))); const head = 8 + n;
  return { head, entries: (j.f ?? []).map(([name, o, s, m]: [string, number, number, string]) => [name, { s, o: head + o, ...(m ? { m } : {}) }]) };
}
const isBundle = (props?: Record<string, string>) => props?.yzb === "1";
const isToc = (props?: Record<string, string>) => props?.yzt === "1";
function addListed(idx: DriveIndex, f: { id: string; name: string; size?: number | string; props?: Record<string, string> }) {
  if (isToc(f.props)) { idx.tocs ??= {}; idx.tocs[f.name] = f.id; return; } // a bundle's table of contents: small, readable without partial downloads
  if (isBundle(f.props)) { idx.bundles ??= {}; if (!idx.bundles[f.id]) idx.bundles[f.id] = { n: f.name, t: Number(f.props!.t) || 0, s: Number(f.size) || 0, read: false }; }
  else { const cur = idx.files[f.name]; if (!cur || cur.o === undefined) idx.files[f.name] = { id: f.id, s: Number(f.size) || 0 }; } // a loose copy never displaces a bundled one already known
}
/** Apply rows of the Drive changes feed to the index (files and bundles added, moved out or removed). Returns whether it changed. */
export function applyMediaChanges(idx: DriveIndex, changes: { id: string; removed: boolean; name?: string; parents?: string[]; trashed?: boolean; size?: number; props?: Record<string, string> }[]): boolean {
  let byId: Map<string, string[]> | null = null; let changed = false;
  const drop = (id: string) => {
    if (idx.bundles?.[id]) { delete idx.bundles[id]; changed = true; }
    if (idx.tocs) for (const [n, t] of Object.entries(idx.tocs)) if (t === id) { delete idx.tocs[n]; changed = true; }
    byId ??= (() => { const m = new Map<string, string[]>(); for (const [n, v] of Object.entries(idx.files)) { const a = m.get(v.id); if (a) a.push(n); else m.set(v.id, [n]); } return m; })();
    for (const n of byId.get(id) ?? []) { delete idx.files[n]; changed = true; } byId.delete(id);
  };
  for (const c of changes) {
    const ours = !c.removed && !c.trashed && (c.parents ?? []).includes(idx.media);
    if (!ours) { drop(c.id); continue; }
    if (isToc(c.props)) { if (c.name && idx.tocs?.[c.name] !== c.id) { idx.tocs ??= {}; idx.tocs[c.name] = c.id; changed = true; } }
    else if (isBundle(c.props)) { if (!idx.bundles?.[c.id]) { addListed(idx, { id: c.id, name: c.name ?? "", size: c.size, props: c.props }); changed = true; } }
    else if (c.name) { const cur = idx.files[c.name]; if (!cur || cur.id !== c.id) { if (!cur || cur.o === undefined) { idx.files[c.name] = { id: c.id, s: c.size ?? 0 }; changed = true; } } }
  }
  return changed;
}
export class DriveMedia {
  constructor(private cache: Record<string, string>) {}
  async ensure(prev: DriveIndex | null): Promise<DriveIndex> {
    if (prev?.media) return prev;
    const media = await ensureFolders(PATHS.media, this.cache);
    return { media, files: {}, changes: "", at: 0, complete: false, bundles: {} };
  }
  /** A fresh index lists the folder 1,000 files a page (bounded per run, cursor kept); later changes arrive through the changes feed. */
  async list(idx: DriveIndex, budgetMs = 20000, progress?: (m: string) => void): Promise<DriveIndex> {
    const t0 = Date.now(); const out: DriveIndex = { ...idx, files: { ...idx.files }, bundles: { ...(idx.bundles ?? {}) } };
    const qs = `'${out.media}' in parents and trashed = false`;
    do {
      const page = await gjson(`${DRIVE}/files?q=${encodeURIComponent(qs)}&fields=${encodeURIComponent("nextPageToken,files(id,name,size,appProperties)")}&pageSize=1000&spaces=drive${out.nextPage ? `&pageToken=${encodeURIComponent(out.nextPage)}` : ""}`);
      for (const f of page?.files ?? []) addListed(out, { id: f.id, name: f.name, size: f.size, props: f.appProperties });
      out.nextPage = page?.nextPageToken || undefined; progress?.(`Reading Drive: ${Object.keys(out.files).length.toLocaleString()} files`);
      if (!out.nextPage) { out.complete = true; break; }
    } while (Date.now() - t0 < budgetMs);
    out.at = Date.now(); return out;
  }
  /** Bundles whose header hasn't been read yet (another device's): one small ranged request each, six at a time. Returns how many are left. */
  async readHeaders(idx: DriveIndex, budgetMs = 20000): Promise<number> {
    const t0 = Date.now(); const todo = Object.entries(idx.bundles ?? {}).filter(([, b]) => !b.read);
    await pool(todo, 6, async ([id, b]) => {
      if (Date.now() - t0 > budgetMs) return;
      const tocId = idx.tocs?.[b.n + ".toc"];
      if (tocId) { // the table of contents beside the bundle: one small plain read
        const t = await downloadBytes(tocId); const j = t ? JSON.parse(new TextDecoder().decode(t)) : null;
        if (j?.f) { for (const [name, o, s, m] of j.f) idx.files[name] = { id, s, o, ...(m ? { m } : {}) }; b.read = true; return; }
      }
      const bytes = await downloadBytes(id, [0, Math.max(8, b.t) - 1]); if (!bytes) { delete idx.bundles![id]; return; } // (a bundle without one: its own header)
      const h = parseBundleHeader(bytes); if (!h) { b.read = true; return; }
      for (const [name, e] of h.entries) idx.files[name] = { id, ...e };
      b.read = true;
    });
    return Object.values(idx.bundles ?? {}).filter((b) => !b.read).length;
  }
  /** Send one bundle (or one loose file when it's alone and large); the index learns where each file is. */
  async uploadBundle(idx: DriveIndex, items: { name: string; blob: Blob }[]): Promise<void> {
    if (items.length === 1 && items[0].blob.size > LOOSE_ABOVE) { const it = items[0]; const id = await this.upload(idx, it.name, it.blob); idx.files[it.name] = { id, s: it.blob.size }; return; }
    const { blob, head, entries } = makeBundle(items);
    const name = `bundle-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 10)}.yzb`;
    const id = await putFile({ parent: idx.media, name, body: blob, mime: "application/octet-stream", isNew: true, props: { yzb: "1", t: String(head), n: String(items.length) } });
    idx.bundles ??= {}; idx.bundles[id] = { n: name, t: head, s: blob.size, read: true };
    for (const [n, e] of entries) idx.files[n] = { ...e, id };
    // Its table of contents next to it ([name, offset, size, type]): another device reads this instead of a partial download.
    const toc = JSON.stringify({ v: 1, f: entries.map(([n, e]) => [n, e.o, e.s, e.m ?? ""]) });
    try { const tid = await putFile({ parent: idx.media, name: name + ".toc", body: toc, mime: "application/json", isNew: true, props: { yzt: "1" } }); idx.tocs ??= {}; idx.tocs[name + ".toc"] = tid; } catch { /* the bundle's own header still serves */ }
  }
  /** Upload one loose file. The index is complete and authoritative, so a name it lacks is created without a lookup first. */
  async upload(idx: DriveIndex, name: string, blob: Blob): Promise<string> { const cur = idx.files[name]; const id = cur && cur.o === undefined ? cur.id : null; return putFile({ parent: idx.media, name, body: blob, mime: blob.type || "application/octet-stream", id, isNew: !id && idx.complete }); }
  /** One file: a ranged read from its bundle, or the whole loose file. */
  private lastBundle: { id: string; bytes: Uint8Array } | null = null;
  async fetchOne(e: DriveEntry, name = ""): Promise<Blob | null> {
    let b: Uint8Array | null;
    if (e.o === undefined) b = await downloadBytes(e.id);
    else if (rangeSupported()) b = await downloadBytes(e.id, [e.o, e.o + e.s - 1]);
    else { // partial downloads refused: the whole bundle (the last one is kept, so the next picture from it costs nothing)
      if (this.lastBundle?.id !== e.id) { const all = await downloadBytes(e.id); this.lastBundle = all ? { id: e.id, bytes: all } : null; }
      b = this.lastBundle ? this.lastBundle.bytes.slice(e.o, e.o + e.s) : null;
    }
    const type = e.m || (name ? mimeFor(name) : "");
    return b ? new Blob([b as BlobPart], type ? { type } : {}) : null;
  }
  /**
   * Many files: grouped by bundle; a bundle most of whose files are wanted comes down whole (one request), otherwise each
   * file is a ranged read. `got` is called for each file as it arrives; `stop` ends early (time or bytes spent).
   */
  async fetchMany(want: [string, DriveEntry][], got: (name: string, blob: Blob) => Promise<void> | void, stop: () => boolean, n = 4): Promise<void> {
    const groups = new Map<string, [string, DriveEntry][]>(); for (const w of want) { const k = w[1].o !== undefined ? w[1].id : "loose:" + w[0]; const g = groups.get(k); if (g) g.push(w); else groups.set(k, [w]); }
    await pool([...groups.values()], n, async (g) => {
      if (stop()) return;
      if (g.length === 1) { const b = await this.fetchOne(g[0][1], g[0][0]); if (b) await got(g[0][0], b); return; }
      const lo = Math.min(...g.map(([, e]) => e.o!)), hi = Math.max(...g.map(([, e]) => e.o! + e.s)); const wanted = g.reduce((a, [, e]) => a + e.s, 0);
      if (wanted >= (hi - lo) * 0.3 || !rangeSupported()) { // one request for the span that holds them (the whole bundle when partial reads are refused)
        const bytes = await downloadBytes(g[0][1].id, [lo, hi - 1]); if (!bytes) return;
        for (const [name, e] of g) await got(name, new Blob([bytes.slice(e.o! - lo, e.o! - lo + e.s) as BlobPart], e.m ? { type: e.m } : {}));
      } else for (const [name, e] of g) { if (stop()) return; const b = await this.fetchOne(e, name); if (b) await got(name, b); }
    });
  }
  async download(id: string): Promise<Blob | null> { const b = await downloadBytes(id); return b ? new Blob([b as BlobPart]) : null; }
}

// ---------------------------------------------------------------- collection sync
type Listing = Map<string, DriveFile>; // name → file
const toText = (b: Uint8Array) => new TextDecoder().decode(b);
export class DriveSync {
  static LOCK_MS = 12 * 60000;
  private folder = ""; private listing: Listing | null = null; private seenRev: string | null | undefined = undefined; private holdsLock = false; private inboxId = "";
  /** memo: the last manifest this device read or wrote, kept by the caller across syncs (no download when Drive still has it). */
  constructor(private cache: Record<string, string>, private device: string, private memo: { rev?: string; m?: Manifest } = {}, private path: string[] = PATHS.collection) {}
  private async open() { if (!this.folder) this.folder = await ensureFolders(this.path, this.cache); return this.folder; }
  private dupes: DriveFile[] = [];
  /** The collection folder by name. Drive allows two files with one name (a create retried after its answer was lost): the newest wins, the rest are removed after the next good sync. */
  private async list(): Promise<Listing> {
    await this.open(); const m: Listing = new Map(); this.dupes = [];
    const all = (await listFiles({ parent: this.folder, all: true })).filter((f) => f.mimeType !== "application/vnd.google-apps.folder");
    all.sort((a, b) => ((a.modifiedTime ?? "") < (b.modifiedTime ?? "") ? 1 : -1));
    for (const f of all) { if (m.has(f.name)) this.dupes.push(f); else m.set(f.name, f); }
    this.listing = m; return m;
  }
  private memoFor(f?: DriveFile): Manifest | null { const r = f?.props?.rev; return r && this.memo.rev === r && this.memo.m ? this.memo.m : null; }
  private async readText(name: string, stored?: Record<string, string>): Promise<string | null> {
    const real = stored?.[name] ?? name; const f = (this.listing ?? (await this.list())).get(real); if (!f) return null;
    const b = await downloadBytes(f); if (!b) return null; return real.endsWith(".gz") ? gunzip(b) : toText(b);
  }
  async check(): Promise<{ ok: boolean; message: string }> {
    try { const m = await this.pullManifest(); return { ok: true, message: m ? `Drive holds a Yuzu collection from ${m.device || "another device"} (${new Date(m.updatedAt).toLocaleString()})` : "Drive is ready — the first sync fills My Apps/Yuzu/collection." }; }
    catch (e: any) { return { ok: false, message: e.message }; }
  }
  private seenMt: string | undefined; private lastManifest: { m: Manifest; mt?: string } | null = null;
  /** The revision of the manifest last read or written by this sync (what the changes feed is compared with). */
  rev(): string | null | undefined { return this.seenRev; }
  /**
   * The manifest. `fresh: false` (right after taking the lock, with the folder listed moments ago): one metadata read tells
   * whether the manifest moved since the listing; if not, the listing still stands and the manifest read before is reused.
   */
  async pullManifest({ fresh = true }: { fresh?: boolean } = {}): Promise<Manifest | null> {
    if (!fresh && this.listing) {
      const f = this.listing.get("manifest.json");
      if (f?.modifiedTime) {
        const meta = await fileMeta(f.id, "id,modifiedTime,trashed").catch((e) => { if (e instanceof GoogleError && (e.auth || e.retryable)) throw e; return null; });
        if (meta && !meta.trashed && meta.modifiedTime === f.modifiedTime) {
          if (this.lastManifest && this.lastManifest.mt === f.modifiedTime) return this.adopt(this.lastManifest.m, f.modifiedTime);
          const mm = this.memoFor(f); if (mm) return this.adopt(mm, f.modifiedTime);
          const t = await this.readText("manifest.json"); if (t) return this.adopt(this.parse(t), f.modifiedTime);
        }
      }
    }
    await this.list(); const lf = this.listing?.get("manifest.json"); const mm = this.memoFor(lf); if (mm) return this.adopt(mm, lf?.modifiedTime);
    const t = await this.readText("manifest.json"); if (!t) { this.seenRev = null; this.seenMt = undefined; return null; }
    return this.adopt(this.parse(t), this.listing?.get("manifest.json")?.modifiedTime);
  }
  private parse(t: string): Manifest { const m = JSON.parse(t) as Manifest; if (!m || typeof m !== "object" || !m.files) throw new SyncError("manifest.json on Drive is not a Yuzu manifest", "other"); return m; }
  private adopt(m: Manifest & { rev?: string }, mt?: string): Manifest { this.seenRev = m.rev ?? String(m.updatedAt); this.seenMt = mt; this.lastManifest = { m, mt }; if (m.rev) { this.memo.rev = m.rev; this.memo.m = m; } return m; }
  async acquireLock(device: string, id = ""): Promise<{ held: boolean; by?: string }> {
    const now = Date.now(); const cur = await this.readText("lock.json").then((t) => (t ? JSON.parse(t) : null), () => null);
    if (cur && cur.until > now && !sameDevice(cur, device, id)) return { held: false, by: cur.device };
    const mine = { device, id, until: now + DriveSync.LOCK_MS, n: Math.random().toString(36).slice(2) };
    const fileId = await putFile({ parent: await this.open(), name: "lock.json", body: JSON.stringify(mine), id: this.listing?.get("lock.json")?.id ?? null });
    this.listing?.set("lock.json", { id: fileId, name: "lock.json" });
    await new Promise((r) => setTimeout(r, 300)); // two devices writing at once: whoever's content is there after a moment holds it
    const back = await downloadBytes(fileId).then((b) => (b ? JSON.parse(toText(b)) : null), () => null);
    if (!back || back.n !== mine.n) return { held: false, by: back?.device ?? "another device" };
    this.holdsLock = true; return { held: true };
  }
  private after: Promise<void> | null = null;
  async releaseLock(): Promise<void> { if (this.after) { const a = this.after; this.after = null; await a; } return this.unlock(); }
  private async unlock(): Promise<void> { if (!this.holdsLock) return; this.holdsLock = false; const f = this.listing?.get("lock.json"); if (f) { try { await putFile({ parent: this.folder, name: "lock.json", body: JSON.stringify({ device: this.device, until: 0 }), id: f.id }); } catch { /* it expires anyway */ } } }
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
    // (one metadata read: the manifest's modified time is what was seen at the pull, else its revision is re-read)
    const mf = listing.get("manifest.json");
    const meta = mf && this.seenMt ? await fileMeta(mf.id, "id,modifiedTime,trashed").catch(() => null) : null;
    if (!(meta && !meta.trashed && meta.modifiedTime === this.seenMt)) {
      const cur = await this.readText("manifest.json").then((t) => (t ? (JSON.parse(t) as any).rev ?? String((JSON.parse(t) as any).updatedAt) : null), () => null);
      if (this.seenRev !== undefined && cur !== this.seenRev) throw new SyncError("Another device synced in the meantime", "conflict");
    }
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
    // The revision rides along as an appProperty, so other devices tell "changed" from the changes feed without a download.
    const mid = await putFile({ parent: this.folder, name: "manifest.json", body: JSON.stringify(manifest), id: listing.get("manifest.json")?.id ?? null, props: { rev } });
    listing.set("manifest.json", { id: mid, name: "manifest.json", props: { rev } }); this.seenRev = rev; this.lastManifest = null; this.seenMt = undefined; this.memo.rev = rev; this.memo.m = manifest;
    const tidy = async () => { for (const d of this.dupes.splice(0)) { try { await deleteFile(d.id); } catch { /* next time */ } } await this.unlock(); };
    this.after = tidy().catch(() => {}); // the lock is released and duplicates removed after the answer, not before it
    return { manifest, commit: rev, pushed: toWrite.length - kept, bytes };
  }
  /** Copy every file of the current manifest into a backup folder (Drive copies server-side: nothing is uploaded). The manifest goes last, so a folder holding one is complete. */
  async snapshot(name: string, progress?: Progress): Promise<{ files: number; rev: string | null } | null> {
    const m = await this.pullManifest({ fresh: true }); if (!m) return null; const listing = this.listing!;
    const dest = await ensureFolders([...PATHS.backups, name], this.cache); for (const f of await listFiles({ parent: dest })) await deleteFile(f.id); // a half-finished earlier try
    const real = Object.keys(m.files).map((p) => m.stored?.[p] ?? p.replace(/\//g, "__")); let n = 0;
    await pool([...real], 4, async (r) => { const f = listing.get(r); if (!f) throw new SyncError(`${r} is missing on Drive, backup stopped`, "other"); await copyFile(f.id, dest, r, f.props); n++; progress?.(`Backing up ${n} of ${real.length} files`); });
    const mf = listing.get("manifest.json")!; await copyFile(mf.id, dest, "manifest.json", mf.props);
    return { files: real.length, rev: (m as any).rev ?? null };
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

// ---------------------------------------------------------------- Rolling backups: My Apps/Yuzu/backups/<YYYY-MM-DD>/
export interface BackupInfo { name: string; id: string; rev: string | null; at: number; counts?: Manifest["counts"] }
/** Which backup folders to keep: the newest `days`, then the newest of each week for `weeks` more weeks. */
export function backupsToKeep(names: string[], days = 7, weeks = 4): Set<string> {
  const sorted = [...names].sort().reverse(); const keep = new Set(sorted.slice(0, days)); const seenWeek = new Set<number>();
  for (const n of sorted.slice(days)) { const t = Date.parse(n.slice(0, 10)); if (!Number.isFinite(t)) continue; const wk = Math.floor(t / (7 * 86400000)); if (seenWeek.size < weeks && !seenWeek.has(wk)) { seenWeek.add(wk); keep.add(n); } }
  return keep;
}
async function backupRoot(cache: Record<string, string>, create = false) { return findFolders(PATHS.backups, cache, create); }
export async function listBackups(cache: Record<string, string>): Promise<BackupInfo[]> {
  const root = await backupRoot(cache); if (!root) return []; const out: BackupInfo[] = [];
  for (const f of await listFiles({ parent: root, folders: true, all: true })) {
    const mf = (await listFiles({ parent: f.id, name: "manifest.json" }))[0]; if (!mf) continue; // still being written
    out.push({ name: f.name, id: f.id, rev: mf.props?.rev ?? null, at: Date.parse(mf.modifiedTime ?? "") || 0 });
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1));
}
export async function pruneBackups(cache: Record<string, string>, days = 7, weeks = 4): Promise<number> {
  const root = await backupRoot(cache); if (!root) return 0; const all = await listFiles({ parent: root, folders: true, all: true });
  const keep = backupsToKeep(all.map((f) => f.name), days, weeks); let n = 0;
  for (const f of all) if (!keep.has(f.name) && /^\d{4}-\d{2}-\d{2}/.test(f.name)) { try { await deleteFile(f.id); n++; } catch { /* next time */ } }
  return n;
}
/** Read a whole backup as a snapshot (the same shape a sync pull returns). */
export async function readBackup(cache: Record<string, string>, name: string, progress?: Progress) {
  const r = new DriveSync(cache, "restore", {}, [...PATHS.backups, name]); const m = await r.pullManifest(); if (!m) throw new SyncError("That backup has no manifest", "other");
  return { manifest: m, snap: await r.pullChanged(m, {}, progress) };
}
export function todayName(d = new Date()): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
