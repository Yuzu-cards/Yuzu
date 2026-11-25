// GitHub sync. Data lives in a private repo as sharded JSON files written with the Git Data API
// (one commit per sync). Merge rules: notes → per field and per tag, the later change wins (whole note by `modified` when unstamped);
// cards → scheduling, suspend/flag and deck each go to their later change (whole card by `mod` when unstamped);
// reviews → union by id; settings → later wins; tombstones → union (an edit after a deletion brings the note and its cards back).
//
// Robustness rules:
// - Every request retries on network errors and 5xx (3 tries, backoff). 4xx errors surface GitHub's message.
// - A brand-new repository (no commits) is bootstrapped with a first commit through the Contents API,
//   because the Git Data API refuses to create blobs or trees in an empty repository.
// - A push that loses a race with another device (non-fast-forward) is retried after re-pulling.
// - Only shards whose fingerprint changed are re-serialized and hashed; unchanged shards reuse cached hashes.
import type { Card, Note, Notetype, PartStamp, Review } from "./model";
import { fmtDateTime } from "./dates";

export interface SyncConfig { owner: string; repo: string; token: string; branch?: string }
export interface Manifest {
  version: 1; files: Record<string, string>; updatedAt: number; device?: string;
  /** logical path → stored path, for gzip-compressed files */
  stored?: Record<string, string>;
  /** record counts at the time of writing, so a device can verify it holds the same collection */
  counts?: { notes: number; cards: number; reviews: number };
  /** commits since the history was last compacted */
  commits?: number;
}

export interface SyncSnapshot {
  notetypes: Notetype[]; notes: Note[]; cards: Card[]; reviews: Review[]; settings: Record<string, unknown>;
  /** Deleted records: "n:<noteId>" / "c:<cardId>" → time of deletion. A tombstone beats any record modified before it. */
  tombstones?: Record<string, number>;
  /** Small pack images as data URLs (name → data URL). */
  media?: Record<string, string>;
  /** Personal hooks ("my way of remembering this"): note id → { t: text, m: modified }. Written as hooks.json. */
  hooks?: Record<string, { t: string; m: number }>;
  /** Shared deck images: file name → stored path in the repo and size. Written as media/index.json. */
  mediaIndex?: Record<string, { p: string; s: number }>;
  /** Per device: the media files its cards use that it doesn't have yet (so a PC with Anki's folder can send them). Written as wants/<id>.json. */
  mediaWants?: Record<string, MediaWant>;
  /** Retired cards: the log of what was mastered, and cards the user chose to keep. Written as mastery.json. */
  mastery?: { log: MasteredEntry[]; kept: Record<string, number> };
  /** Cards marked "needs improving": note id → reasons, the user's own words, time. Empty reasons = cleared. Written as improve.json. */
  improve?: Record<string, ImproveMark>;
}
export interface ImproveMark { r: string[]; t: string; m: number }
export interface MasteredEntry { id: string; nid: string; deck: string; front: string; back: string; tags: string[]; reps: number; lapses: number; firstReview: number; lastReview: number; intervalDays: number; at: number; by: "auto" | "you" }
export interface MediaWant { id?: string; device: string; at: number; total: number; missing: string[] }
export const wantPath = (device: string) => { let h = 0x811c9dc5; for (let i = 0; i < device.length; i++) h = Math.imul(h ^ device.charCodeAt(i), 16777619); return `wants/${(h >>> 0).toString(16).padStart(8, "0")}.json`; };
export type MediaIndex = NonNullable<SyncSnapshot["mediaIndex"]>;
/** Per sync, at most this many bytes of shared images go up or come down, so a sync never takes minutes. */
export const MEDIA_BATCH_BYTES = 15 * 1048576;
export type Progress = (message: string) => void;

export const NOTE_SHARDS = 128, CARD_SHARDS = 256;
/** Files above this size are stored gzip-compressed (".gz" suffix) so one review uploads kilobytes, not megabytes. */
export const GZIP_ABOVE = 32 * 1024;
const shardMemo = new Map<string, number>(); // id → hash (ids never change; saves hashing 250k ids on every sync)
const shardOf = (id: string, n: number) => { let h = shardMemo.get(id); if (h === undefined) { h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; if (shardMemo.size < 2_000_000) shardMemo.set(id, h); } return h % n; };
const enc = new TextEncoder();

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export async function gzip(s: string): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip"); const stream = new Blob([enc.encode(s) as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function gunzip(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream("gzip"); const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new Response(stream).text();
}
function utf8ToBase64(s: string): string {
  const bytes = enc.encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class SyncError extends Error {
  constructor(message: string, public kind: "auth" | "notfound" | "conflict" | "network" | "ratelimit" | "busy" | "server" | "other" = "other", public resumeAt?: number) { super(message); }
}

/** Cache of shard fingerprints: path → { fp (fingerprint of the records), hash of the JSON }. The JSON itself is not kept. */
export type ShardCache = Map<string, { fp: string; hash: string }>;

/**
 * Run `fn` over `items`, `n` at a time. After the first failure no new item starts, the ones in flight finish, and then
 * the error is thrown — so nothing keeps uploading in the background after a sync has given up (and released its lock).
 */
export async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  const q = items.slice(); let failed = false; let err: unknown;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, q.length)) }, async () => {
    while (q.length && !failed) { const x = q.shift()!; try { await fn(x); } catch (e) { if (!failed) { failed = true; err = e; } } }
  }));
  if (failed) throw err;
}

/** A lock is ours when it carries this install's id, or (older locks, no id) the same device name in any case. */
export function sameDevice(info: { device?: string; id?: string }, device: string, id = ""): boolean {
  if (id && info.id) return info.id === id;
  return (info.device ?? "").trim().toLowerCase() === device.trim().toLowerCase();
}

export class GitHubSync {
  fetchImpl: typeof fetch = (...a) => fetch(...a);
  constructor(private cfg: SyncConfig) {}
  private get base() { return `https://api.github.com/repos/${this.cfg.owner}/${this.cfg.repo}`; }
  private get branch() { return this.cfg.branch ?? "main"; }
  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.cfg.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...extra };
  }

  /** fetch with retries on network failures and 5xx. */
  private async request(url: string, init: RequestInit): Promise<Response> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      try {
        const res = await this.fetchImpl(url, init);
        if (res.status >= 500) { lastErr = new SyncError(`GitHub is having trouble (${res.status}); will retry`, "network"); continue; }
        // Rate limit: short waits are slept through, long ones are reported with the time sync resumes.
        if ((res.status === 403 || res.status === 429) && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.get("retry-after"))) {
          const retry = Number(res.headers.get("retry-after") ?? 0) * 1000; const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
          const resumeAt = retry ? Date.now() + retry : reset || Date.now() + 60000;
          const wait = resumeAt - Date.now();
          if (wait <= 20000 && attempt < 2) { await new Promise((r) => setTimeout(r, Math.max(1000, wait))); continue; }
          const d = new Date(resumeAt); const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
          throw new SyncError(`GitHub's hourly request limit is used up; sync resumes by itself at ${hhmm}.`, "ratelimit", resumeAt);
        }
        return res;
      } catch (e: any) { if (e instanceof SyncError) throw e; lastErr = new SyncError(`Network error: ${e?.message ?? e}`, "network"); }
    }
    throw lastErr;
  }

  private async explain(res: Response, what: string): Promise<SyncError> {
    let msg = ""; try { msg = (await res.json())?.message ?? ""; } catch { /* no body */ }
    if (res.status === 401) return new SyncError("Token rejected (401). Create a new fine-grained token with Contents: read and write for this repository.", "auth");
    if (res.status === 403 && /rate limit/i.test(msg)) return new SyncError("GitHub rate limit reached; try again in a few minutes.", "ratelimit");
    if (res.status === 403) return new SyncError(`No permission to ${what} (403). The token needs Contents: read and write on ${this.cfg.owner}/${this.cfg.repo}.`, "auth");
    if (res.status === 404) return new SyncError(`Repository ${this.cfg.owner}/${this.cfg.repo} not found, or the token cannot see it.`, "notfound");
    // GitHub's own trouble (a repository that was just moved or is being repacked answers "GitRPC::BadObjectState"):
    // not another device, nothing to merge — say so plainly and come back later.
    if (/GitRPC|BadObjectState|object.*state|server error/i.test(msg)) return new SyncError("GitHub is still settling this repository (it happens for a while after a move). Nothing was changed; Yuzu tries again in 10 minutes.", "server");
    if (res.status === 409 || res.status === 422) return new SyncError(`Conflict while trying to ${what}: ${msg || res.status}`, "conflict");
    return new SyncError(`GitHub ${res.status} while trying to ${what}: ${msg}`.trim(), "other");
  }

  /** JSON API call. GET returning 404/409 (missing path, empty repository) → null. Everything else that fails throws a SyncError. */
  private async api(path: string, init: RequestInit = {}, what = `${init.method ?? "GET"} ${path}`): Promise<any> {
    const res = await this.request(this.base + path, { ...init, headers: this.headers({ ...(init.headers as any), ...(init.body ? { "Content-Type": "application/json" } : {}) }) });
    if (!init.method && (res.status === 404 || res.status === 409)) return null;
    if (!res.ok) throw await this.explain(res, what);
    if (res.status === 204) return null;
    return res.json();
  }

  async check(): Promise<{ ok: boolean; message: string }> {
    try {
      const repo = await this.api("");
      if (!repo) return { ok: false, message: `Repository ${this.cfg.owner}/${this.cfg.repo} not found. Check the name and that the token can access it.` };
      if (!repo.permissions?.push) return { ok: false, message: "Token has no write access to this repository (needs Contents: read and write)." };
      const m = await this.pullManifest();
      const state = m ? `holds a Yuzu sync from ${m.device || "another device"} (${fmtDateTime(m.updatedAt)})` : "is empty — the first sync will fill it";
      return { ok: true, message: `Connected to ${repo.full_name}${repo.private ? "" : " (PUBLIC — your cards are visible to anyone)"}; it ${state}.` };
    } catch (e: any) { return { ok: false, message: e.message }; }
  }

  /** Reads go by the exact commit once we know it: the Contents API caches by branch name and can serve a stale copy right after a push. */
  private get readRef() { return this.seenHead || this.branch; }
  private async readFile(path: string, stored?: Record<string, string>): Promise<string | null> {
    const real = stored?.[path] ?? path;
    const res = await this.request(`${this.base}/contents/${real}?ref=${this.readRef}`, { headers: this.headers({ Accept: "application/vnd.github.raw+json" }) });
    if (res.status === 404 || res.status === 409) return null;
    if (!res.ok) throw await this.explain(res, `read ${path}`);
    if (real.endsWith(".gz")) return gunzip(new Uint8Array(await res.arrayBuffer()));
    return res.text();
  }

  /** Sync lock: one device uploads at a time. Implemented as a git ref (refs/yuzu/lock) pointing at a tiny commit
   *  whose message holds {device, until}: creating a ref is atomic and the Git Data API is never served from a stale cache. */
  static LOCK_MS = 12 * 60000;
  private holdsLock = false;
  private blobCache = new Map<string, string>();
  async acquireLock(device: string, id = ""): Promise<{ held: boolean; by?: string }> {
    const cur = await this.api(`/git/ref/yuzu/lock`);
    if (!cur && !(await this.api(`/git/ref/heads/${this.branch}`))) return { held: true }; // empty repository: nothing to contend for yet
    if (cur?.object?.sha) {
      let info: { device?: string; id?: string; until?: number } = {};
      try { const c = await this.api(`/git/commits/${cur.object.sha}`); info = JSON.parse(c?.message ?? "{}"); } catch { /* unreadable: treat as expired */ }
      if ((info.until ?? 0) > Date.now() && !sameDevice(info, device, id)) return { held: false, by: info.device || "another device" };
      // ours already, or expired: point the ref at a fresh lock commit
      // GitHub can refuse to move a ref outside heads/tags ("Reference does not exist"), and the other device may
      // have just released it — so on any failure clear the stale lock and take it fresh below.
      const sha = await this.lockCommit(device, id);
      try { await this.api(`/git/refs/yuzu/lock`, { method: "PATCH", body: JSON.stringify({ sha, force: true }) }, "refresh the sync lock"); this.holdsLock = true; return { held: true, }; }
      catch { try { await this.api(`/git/refs/yuzu/lock`, { method: "DELETE" }, "clear an old sync lock"); } catch { /* already gone */ } }
    }
    const sha = await this.lockCommit(device, id);
    try { await this.api("/git/refs", { method: "POST", body: JSON.stringify({ ref: "refs/yuzu/lock", sha }) }, "take the sync lock"); }
    catch (e) { if (e instanceof SyncError && e.kind === "conflict") return { held: false, by: "another device" }; throw e; } // created by someone else a moment ago
    this.holdsLock = true; return { held: true };
  }
  private async lockCommit(device: string, id = ""): Promise<string> {
    const tree = await this.api("/git/trees", { method: "POST", body: JSON.stringify({ tree: [{ path: "lock", mode: "100644", type: "blob", content: device }] }) }, "take the sync lock");
    const c = await this.api("/git/commits", { method: "POST", body: JSON.stringify({ message: JSON.stringify({ device, id, until: Date.now() + GitHubSync.LOCK_MS }), tree: tree.sha, parents: [] }) }, "take the sync lock");
    return c.sha as string;
  }
  async releaseLock(): Promise<void> {
    if (!this.holdsLock) return;
    this.holdsLock = false;
    try { await this.api(`/git/refs/yuzu/lock`, { method: "DELETE" }, "release the sync lock"); } catch { /* expires anyway */ }
  }

  /** Files waiting in inbox/ (packs dropped there by Claude or by hand). */
  async listInbox(): Promise<{ name: string; sha: string; size: number }[]> {
    const list = await this.api(`/contents/inbox?ref=${this.readRef}`);
    return Array.isArray(list) ? list.filter((f: any) => f.type === "file" && /\.json$/i.test(f.name)).map((f: any) => ({ name: f.name, sha: f.sha, size: f.size })) : [];
  }
  async readInbox(name: string): Promise<string | null> { return this.readFile(`inbox/${encodeURIComponent(name)}`); }
  async deleteInbox(name: string, sha: string): Promise<void> {
    await this.api(`/contents/inbox/${encodeURIComponent(name)}`, { method: "DELETE", body: JSON.stringify({ message: `Yuzu: inbox ${name} handled`, sha, branch: this.branch }) }, `remove inbox/${name}`);
  }

  /** Head commit seen by the last pullManifest(); push() refuses to build on a different one (another device synced in between). */
  private seenHead: string | null | undefined = undefined;

  /** Download a binary file stored in the repository (shared images). */
  async readBinary(path: string): Promise<Uint8Array | null> {
    const res = await this.request(`${this.base}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${this.readRef}`, { headers: this.headers({ Accept: "application/vnd.github.raw+json" }) });
    if (res.status === 404) return null;
    if (!res.ok) throw await this.explain(res, `download ${path}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async pullManifest(): Promise<Manifest | null> {
    const ref = await this.api(`/git/ref/heads/${this.branch}`);
    this.seenHead = ref?.object?.sha ?? null;
    const t = await this.readFile("manifest.json");
    if (!t) return null;
    const m = JSON.parse(t) as Manifest;
    if (!m || typeof m !== "object" || !m.files) throw new SyncError("manifest.json in the repository is not a Yuzu manifest", "other");
    return m;
  }

  /** Hash every shard of a snapshot. Unchanged shards (same fingerprint) reuse the cached hash and are not serialized;
   *  `make(path)` serializes one shard on demand (only the changed ones get uploaded). */
  static async shard(snap: SyncSnapshot, cache: ShardCache = new Map()): Promise<{ hashes: Record<string, string>; make: (path: string) => string }> {
    const hashes: Record<string, string> = {}; const makers = new Map<string, () => string>();
    const emit = async (path: string, fp: string, make: () => string) => {
      makers.set(path, make);
      const c = cache.get(path);
      if (c && c.fp === fp) { hashes[path] = c.hash; return; }
      const hash = await sha256(make());
      cache.set(path, { fp, hash }); hashes[path] = hash;
    };
    await emit("notetypes.json", "v" + snap.notetypes.length + ":" + snap.notetypes.map((n) => n.id).join(","), () => JSON.stringify(snap.notetypes));
    await emit("settings.json", JSON.stringify(snap.settings), () => JSON.stringify(snap.settings));
    const media = snap.media ?? {};
    if (Object.keys(media).length) await emit("media.json", "m" + Object.keys(media).sort().join(","), () => JSON.stringify(media));
    if (snap.mastery && (snap.mastery.log.length || Object.keys(snap.mastery.kept).length)) await emit("mastery.json", `m${snap.mastery.log.length}:${Object.keys(snap.mastery.kept).length}:${snap.mastery.log.reduce((a, b) => a + b.at, 0)}`, () => JSON.stringify(snap.mastery));
    if (snap.improve && Object.keys(snap.improve).length) await emit("improve.json", `i${Object.keys(snap.improve).length}:${Object.values(snap.improve).reduce((a, b) => a + b.m, 0)}`, () => JSON.stringify(snap.improve));
    if (snap.hooks && Object.keys(snap.hooks).length) await emit("hooks.json", "h" + Object.keys(snap.hooks).length + ":" + Object.values(snap.hooks).reduce((a, b) => a + b.m, 0), () => JSON.stringify(snap.hooks));
    if (snap.mediaIndex && Object.keys(snap.mediaIndex).length) await emit("media/index.json", "i" + Object.keys(snap.mediaIndex).length + ":" + Object.values(snap.mediaIndex).reduce((a, b) => a + b.s, 0), () => JSON.stringify(snap.mediaIndex));
    for (const w of Object.values(snap.mediaWants ?? {})) await emit(wantPath(w.id ?? w.device), `w${w.at}:${w.total}:${w.missing.length}`, () => JSON.stringify(w));
    const tombs = snap.tombstones ?? {};
    if (Object.keys(tombs).length) await emit("tombstones.json", "t" + Object.keys(tombs).length + ":" + Object.values(tombs).reduce((a, b) => a + b, 0), () => JSON.stringify(tombs));
    const notes: Note[][] = Array.from({ length: NOTE_SHARDS }, () => []);
    for (const n of snap.notes) notes[shardOf(n.id, NOTE_SHARDS)].push(n);
    for (let i = 0; i < NOTE_SHARDS; i++) {
      const list = notes[i]; if (!list.length) continue;
      let sum = 0, ids = 0; for (const n of list) { sum += n.modified + (n.pm ? noteStampSum(n) : 0); ids = (ids + shardOf(n.id, 1 << 30)) >>> 0; }
      await emit(`notes/${i}.json`, `${list.length}:${sum}:${ids}`, () => JSON.stringify(list.sort((a, b) => a.id < b.id ? -1 : 1)));
    }
    const cards: Card[][] = Array.from({ length: CARD_SHARDS }, () => []);
    for (const c of snap.cards) cards[shardOf(c.id, CARD_SHARDS)].push(c);
    for (let i = 0; i < CARD_SHARDS; i++) {
      const list = cards[i]; if (!list.length) continue;
      let sum = 0, ids = 0; for (const c of list) { sum += (c.mod ?? c.lastReview) + c.due + c.reps + (c.suspended ? 1 : 0) + c.flag + (c.pm ? cardStampSum(c) : 0); ids = (ids + shardOf(c.id, 1 << 30)) >>> 0; }
      await emit(`cards/${i}.json`, `${list.length}:${sum}:${ids}`, () => JSON.stringify(list.sort((a, b) => a.id < b.id ? -1 : 1)));
    }
    const byMonth = new Map<string, Review[]>();
    for (const r of snap.reviews) { const k = new Date(r.ts).toISOString().slice(0, 7); (byMonth.get(k) ?? byMonth.set(k, []).get(k)!).push(r); }
    for (const [k, list] of byMonth) await emit(`reviews/${k}.json`, `${list.length}:${list.reduce((a, r) => a + r.ts, 0)}`, () => JSON.stringify(list.sort((a, b) => a.ts - b.ts)));
    return { hashes, make: (path) => makers.get(path)!() };
  }

  /** Download every remote file whose hash differs from `known` and return the parsed remote snapshot parts. */
  async pullChanged(manifest: Manifest, known: Record<string, string>, progress?: Progress): Promise<Partial<SyncSnapshot> & { files: Record<string, string> }> {
    const changed = Object.entries(manifest.files).filter(([p, h]) => known[p] !== h);
    const out: Partial<SyncSnapshot> & { files: Record<string, string> } = { files: {} };
    let doneCount = 0;
    const parsed: [string, any][] = [];
    // Limit concurrency so a phone on a slow link does not open 100 connections at once; parse as files arrive so the raw text is not held.
    await pool(changed, 4, async ([p]) => {
        const t = await this.readFile(p, manifest.stored);
        if (t != null) { try { parsed.push([p, JSON.parse(t)]); } catch { throw new SyncError(`${p} in the repository is corrupt; sync stopped without changing anything`, "other"); } }
        doneCount++; progress?.(`Downloading ${doneCount} of ${changed.length} changed files`);
      });
    for (const [p, data] of parsed) {
      out.files[p] = manifest.files[p];
      if (p === "notetypes.json") out.notetypes = data;
      else if (p === "settings.json") out.settings = data;
      else if (p === "tombstones.json") out.tombstones = data;
      else if (p === "media.json") out.media = data;
      else if (p === "media/index.json") out.mediaIndex = data;
      else if (p === "hooks.json") out.hooks = data;
      else if (p === "mastery.json") out.mastery = data;
      else if (p === "improve.json") out.improve = data;
      else if (p.startsWith("wants/") && data?.device) out.mediaWants = { ...(out.mediaWants ?? {}), [data.id ?? data.device]: data };
      else if (p.startsWith("notes/")) out.notes = (out.notes ?? []).concat(data);
      else if (p.startsWith("cards/")) out.cards = (out.cards ?? []).concat(data);
      else if (p.startsWith("reviews/")) out.reviews = (out.reviews ?? []).concat(data);
    }
    return out;
  }

  /** Current head commit sha, bootstrapping an empty repository with a first commit if needed. */
  private async head(): Promise<string | null> {
    const ref = await this.api(`/git/ref/heads/${this.branch}`);
    if (ref?.object?.sha) return ref.object.sha;
    const repo = await this.api("");
    if (!repo) throw new SyncError(`Repository ${this.cfg.owner}/${this.cfg.repo} not found, or the token cannot see it.`, "notfound");
    if (repo.default_branch && repo.default_branch !== this.branch) {
      const other = await this.api(`/git/ref/heads/${repo.default_branch}`);
      if (other?.object?.sha) throw new SyncError(`The repository's branch is "${repo.default_branch}" but Yuzu syncs to "${this.branch}". Create an empty repository named yuzu-data, or rename its branch to main.`, "other");
    }
    // Empty repository: create the first commit with the Contents API.
    await this.api(`/contents/.yuzu`, { method: "PUT", body: JSON.stringify({ message: "Yuzu sync data", content: utf8ToBase64("Yuzu sync data. Do not edit by hand.\n"), branch: this.branch }) }, "create the first commit");
    const again = await this.api(`/git/ref/heads/${this.branch}`);
    if (!again?.object?.sha) throw new SyncError("Could not create the first commit in the repository", "other");
    return again.object.sha;
  }

  /** Commit the given files (only those whose hash differs from the remote manifest). Returns the new manifest. */
  async push(hashes: Record<string, string>, make: (path: string) => string, remote: Manifest | null, device: string, progress?: Progress, counts?: Manifest["counts"], blobs: { path: string; bytes: Uint8Array }[] = []): Promise<{ manifest: Manifest; commit: string | null; pushed: number; bytes: number }> {
    const toWrite = Object.keys(hashes).filter((p) => !remote || remote.files[p] !== hashes[p]);
    const stored: Record<string, string> = { ...(remote?.stored ?? {}) };
    for (const p of Object.keys(stored)) if (!(p in hashes)) delete stored[p];
    const realOf = (p: string) => stored[p] ?? p;
    const toDelete = remote ? Object.keys(remote.files).filter((p) => !(p in hashes)).map((p) => remote.stored?.[p] ?? p) : [];
    const manifest: Manifest = { version: 1, files: hashes, updatedAt: Date.now(), device, stored, counts, commits: (remote?.commits ?? 0) + 1 };
    if (!toWrite.length && !toDelete.length && !blobs.length) return { manifest: remote ?? manifest, commit: null, pushed: 0, bytes: 0 };
    const baseCommit = await this.head();
    if (this.seenHead !== undefined && this.seenHead !== null && baseCommit !== this.seenHead) throw new SyncError("Another device synced in the meantime", "conflict");
    const baseTree = baseCommit ? (await this.api(`/git/commits/${baseCommit}`, {}, "read the last commit"))?.tree?.sha ?? null : null;
    const tree: any[] = [];
    let n = 0, bytes = 0;
    const total = toWrite.length;
    const label = (k: number) => (total >= 20 ? `Uploading ${k} of ${total} changed files (first sync in a new layout sends everything once)` : `Uploading ${k} of ${total} changed files`);
    if (total >= 20) {
      // Bulk mode: many files → send them inline in a few large tree requests instead of one blob request per file.
      let baseTreeSha = baseTree; const CHUNK = 4 * 1048576; let chunk: any[] = []; let size = 0;
      const flush = async () => { if (!chunk.length) return; const t = await this.api("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: baseTreeSha ?? undefined, tree: chunk }) }, "upload a batch of files"); baseTreeSha = t.sha; chunk = []; size = 0; };
      for (const p of toWrite) {
        const json = make(p); bytes += json.length;
        const prevReal = realOf(p); if (prevReal !== p) { chunk.push({ path: prevReal, mode: "100644", type: "blob", sha: null }); delete stored[p]; }
        chunk.push({ path: p, mode: "100644", type: "blob", content: json }); size += json.length; n++;
        if (size >= CHUNK) { await flush(); progress?.(label(n)); }
      }
      await flush(); progress?.(label(n));
      // the remaining entries (deletions, images, manifest) go on top of the last batch tree
      (this as any)._bulkBase = baseTreeSha;
    } else {
      // Upload blobs four at a time; order in the tree does not matter. Blobs already uploaded in this session (retry after a conflict) are reused.
      const queue = [...toWrite];
      const uploadOne = async (p: string) => {
        const json = make(p);
        let content: string; let real = p;
        if (json.length > GZIP_ABOVE) { const gz = await gzip(json); content = bytesToBase64(gz); real = p + ".gz"; bytes += gz.length; } else { content = utf8ToBase64(json); bytes += json.length; }
        const prevReal = realOf(p);
        const key = hashes[p] + (real.endsWith(".gz") ? ".gz" : "");
        let sha = this.blobCache.get(key);
        if (!sha) { const blob = await this.api("/git/blobs", { method: "POST", body: JSON.stringify({ content, encoding: "base64" }) }, `upload ${p}`); sha = blob.sha as string; this.blobCache.set(key, sha); }
        if (prevReal !== real) tree.push({ path: prevReal, mode: "100644", type: "blob", sha: null }); // compression state changed: drop the old file
        if (real !== p) stored[p] = real; else delete stored[p];
        tree.push({ path: real, mode: "100644", type: "blob", sha });
        progress?.(label(++n));
      };
      await pool(queue, 4, uploadOne);
    }
    const bq = [...blobs]; let bn = 0;
    await pool(bq, 4, async (b) => { const r = await this.api("/git/blobs", { method: "POST", body: JSON.stringify({ content: bytesToBase64(b.bytes), encoding: "base64" }) }, `upload ${b.path}`); tree.push({ path: b.path, mode: "100644", type: "blob", sha: r.sha }); bytes += b.bytes.length; progress?.(`Uploading images ${++bn} of ${blobs.length}`); });
    for (const p of toDelete) tree.push({ path: p, mode: "100644", type: "blob", sha: null });
    manifest.stored = stored;
    const mblob = await this.api("/git/blobs", { method: "POST", body: JSON.stringify({ content: utf8ToBase64(JSON.stringify(manifest)), encoding: "base64" }) }, "upload the manifest");
    tree.push({ path: "manifest.json", mode: "100644", type: "blob", sha: mblob.sha });
    const newTree = await this.api("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: ((this as any)._bulkBase ?? baseTree) ?? undefined, tree }) }, "build the commit");
    (this as any)._bulkBase = undefined;
    const commit = await this.api("/git/commits", { method: "POST", body: JSON.stringify({ message: `Yuzu sync from ${device || "device"} (${toWrite.length} files)`, tree: newTree.sha, parents: baseCommit ? [baseCommit] : [] }) }, "create the commit");
    if (baseCommit) await this.api(`/git/refs/heads/${this.branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) }, "advance the branch");
    else await this.api("/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${this.branch}`, sha: commit.sha }) }, "create the branch");
    this.seenHead = commit.sha;
    await this.releaseLock();
    return { manifest, commit: commit.sha, pushed: toWrite.length + blobs.length, bytes };
  }

  /** Fold the whole history into one commit holding the current tree. Old objects become unreachable and GitHub
   *  reclaims them, so the repository stays the size of the collection instead of growing with every sync. */
  async compact(device: string): Promise<boolean> {
    const headSha = await this.api(`/git/ref/heads/${this.branch}`).then((r: any) => r?.object?.sha ?? null);
    if (!headSha || (this.seenHead && headSha !== this.seenHead)) return false; // someone else is syncing; try another time
    const treeSha = (await this.api(`/git/commits/${headSha}`, {}, "read the last commit"))?.tree?.sha; if (!treeSha) return false;
    const manifestText = await this.readFile("manifest.json"); if (!manifestText) return false;
    const m = JSON.parse(manifestText) as Manifest; m.commits = 0; m.updatedAt = Date.now();
    const mblob = await this.api("/git/blobs", { method: "POST", body: JSON.stringify({ content: utf8ToBase64(JSON.stringify(m)), encoding: "base64" }) }, "upload the manifest");
    const newTree = await this.api("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: treeSha, tree: [{ path: "manifest.json", mode: "100644", type: "blob", sha: mblob.sha }] }) }, "build the commit");
    const commit = await this.api("/git/commits", { method: "POST", body: JSON.stringify({ message: `Yuzu: history compacted from ${device || "device"}`, tree: newTree.sha, parents: [] }) }, "create the commit");
    await this.api(`/git/refs/heads/${this.branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: true }) }, "rewrite the branch");
    this.seenHead = commit.sha;
    return true;
  }

  /** Repository size in MB as GitHub reports it (includes unreachable objects until GitHub's next cleanup). */
  async repoSizeMB(): Promise<number | null> { const r = await this.api(""); return r?.size != null ? r.size / 1024 : null; }
}

/** How many commits a repository accumulates before Yuzu folds its history into a single commit. */
export const COMPACT_EVERY = 300;

/** Union of tombstones (later deletion time wins). */
export function mergeTombstones(local: Record<string, number>, remote: Record<string, number>): Record<string, number> {
  const out = { ...local }; for (const [k, t] of Object.entries(remote)) if ((out[k] ?? -1) < t) out[k] = t; return out;
}
/** FNV-1a in base 36: the short fingerprint a part stamp keeps of the value it stamped. */
export function h32(s: string): string { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); }
const schedKey = (c: Card) => `${c.state}|${c.due}|${c.stability}|${c.difficulty}|${c.reps}|${c.lapses}|${c.lastReview}|${c.step}`;
const userKey = (c: Card) => `${c.suspended ? 1 : 0}|${c.flag}`;
export const cardMod = (c: Card) => c.mod ?? c.lastReview;

/**
 * When each part of a card last changed: s = scheduling, u = suspended/flag, d = deck (source).
 * - u, d: their stamp while the value is still the one stamped; changed since by code that doesn't stamp (an older Yuzu, an import) → `mod`;
 *   never stamped → 0 (then the scheduling winner decides, which is the old whole-card rule).
 * - s: its stamp while nothing bumped `mod` after the last suspend/flag/deck change (a review, an undo, a reschedule all bump `mod`), else `mod`.
 */
export function cardParts(c: Card): { s: number; u: number; d: number } {
  const m = cardMod(c), pm = c.pm;
  if (!pm) return { s: m, u: 0, d: 0 };
  const u = pm.u ? (pm.u[1] === h32(userKey(c)) ? pm.u[0] : m) : 0;
  const d = pm.d ? (pm.d[1] === h32(c.source) ? pm.d[0] : m) : 0;
  const s = pm.s && pm.s[1] === h32(schedKey(c)) && m === Math.max(pm.u?.[0] ?? -1, pm.d?.[0] ?? -1) ? pm.s[0] : m;
  return { s, u, d };
}
/** `next` is `c` with a suspend/flag change ("u") and/or a deck change ("d") made at `now`: stamp those parts and keep the scheduling's own time,
 *  so a review of the same card on another device keeps this change, and this change keeps that review. */
export function stampCard(c: Card, next: Card, now: number, parts: ("u" | "d")[]): Card {
  const p = cardParts(c); const pm: NonNullable<Card["pm"]> = { s: [p.s, h32(schedKey(next))] };
  if (parts.includes("u")) pm.u = [now, h32(userKey(next))]; else if (p.u) pm.u = [p.u, h32(userKey(next))];
  if (parts.includes("d")) pm.d = [now, h32(next.source)]; else if (p.d) pm.d = [p.d, h32(next.source)];
  return { ...next, mod: now, pm };
}
/** `next` is `c` rescheduled by hand at `now` (Set due date, Reset): the scheduling part is stamped now, the others keep theirs. */
export function stampSchedule(c: Card, next: Card, now: number): Card {
  const p = cardParts(c); const pm: NonNullable<Card["pm"]> = { s: [now, h32(schedKey(next))] };
  if (p.u) pm.u = [p.u, h32(userKey(next))]; if (p.d) pm.d = [p.d, h32(next.source)];
  return { ...next, mod: now, pm };
}
/** One card known on two devices. Each part goes to the side that changed it last (ties: the later `mod`, then a fixed order),
 *  so merge(a, b) and merge(b, a) agree and both devices end up with the same card. */
export function mergeCard(l: Card, r: Card): Card {
  const ml = cardMod(l), mr = cardMod(r);
  if (!l.pm && !r.pm) return mr > ml ? r : l;
  if (ml === mr && JSON.stringify(l) === JSON.stringify(r)) return l; // same copy on both
  const pl = cardParts(l), pr = cardParts(r);
  const leftWins = (a: number, b: number, ka: string, kb: string) => (a !== b ? a > b : ml !== mr ? ml > mr : ka >= kb);
  const sL = leftWins(pl.s, pr.s, schedKey(l), schedKey(r)), uL = leftWins(pl.u, pr.u, userKey(l), userKey(r)), dL = leftWins(pl.d, pr.d, l.source, r.source);
  const base = sL ? l : r, U = uL ? l : r, D = dL ? l : r;
  if (U === base && D === base) return base;
  const m = Math.max(ml, mr), S = sL ? pl.s : pr.s, Ut = uL ? pl.u : pr.u, Dt = dL ? pl.d : pr.d;
  const out: Card = { ...base, suspended: U.suspended, flag: U.flag, source: D.source, mod: m };
  const pm: NonNullable<Card["pm"]> = {};
  if (S !== m) pm.s = [S, h32(schedKey(out))];
  if (Ut) pm.u = [Ut, h32(userKey(out))];
  if (Dt) pm.d = [Dt, h32(out.source)];
  out.pm = pm;
  const j = JSON.stringify(out); return j === JSON.stringify(base) ? base : j === JSON.stringify(base === l ? r : l) ? (base === l ? r : l) : out;
}

/** An edit that lost to a newer edit of the same field on another device, kept so nothing is silently lost (Settings → Sync → Replaced edits). */
export interface NoteConflict { nid: string; field: number; kept: string; lost: string; lostOn: string; keptOn: string; at: number; seen: number }
const fieldStamp = (n: Note, i: number): { t: number; real: boolean } => { const st = n.pm?.f?.[i]; return st && st[1] === h32(n.fields[i] ?? "") ? { t: st[0], real: true } : { t: n.modified, real: false }; };
const tagStamp = (n: Note, tag: string): number => { const st = n.pm?.t?.[tag]; if (st === undefined) return 0; return (st > 0) === n.tags.includes(tag) ? Math.abs(st) : n.modified; };
/** `next` is `prev` edited by the user at `now`: stamp the fields and tags that changed (the others keep their time), so another
 *  device's edit of a different field or tag is kept on sync instead of the whole note going to whichever edit was later. */
export function stampNote(prev: Note, next: Note, now: number): Note {
  const f: PartStamp[] = next.fields.map((v, i) => [i < prev.fields.length && v === prev.fields[i] ? fieldStamp(prev, i).t : now, h32(v)]);
  const t: Record<string, number> = {}; const was = new Set(prev.tags), is = new Set(next.tags);
  for (const k of Object.keys(prev.pm?.t ?? {})) { const e = tagStamp(prev, k); t[k] = is.has(k) ? e : -e; }
  for (const k of is) if (!was.has(k)) t[k] = now;
  for (const k of was) if (!is.has(k)) t[k] = -now;
  return { ...next, modified: now, pm: { f, t } };
}
/**
 * One note known on two devices. Fields: each goes to the side that edited it last; tags: each added or removed tag goes to the side that
 * changed it last (so tags added on both devices are both kept). Notes without stamps, or whose fields no longer line up (note type changed),
 * merge whole by `modified` as before. `track`: report a field edit made since the last sync that lost to another device's.
 */
export function mergeNote(l: Note, r: Note, track?: { since: number; from: string; out: NoteConflict[] }): Note {
  let lw: boolean; if (l.modified !== r.modified) lw = l.modified > r.modified; else { const jl = JSON.stringify(l), jr = JSON.stringify(r); if (jl === jr) return l; lw = jl > jr; } // (same copy on both: nothing to do)
  const base = lw ? l : r, other = lw ? r : l;
  if ((!l.pm && !r.pm) || l.ntid !== r.ntid || l.fields.length !== r.fields.length) return base;
  const fields: string[] = [], f: PartStamp[] = [];
  for (let i = 0; i < l.fields.length; i++) {
    const a = fieldStamp(l, i), b = fieldStamp(r, i);
    if (l.fields[i] === r.fields[i]) { fields.push(l.fields[i]); f.push([Math.max(a.t, b.t), h32(l.fields[i])]); continue; }
    const left = a.t !== b.t ? a.t > b.t : lw; const w = left ? a : b, lo = left ? b : a;
    fields.push((left ? l : r).fields[i]); f.push([w.t, h32((left ? l : r).fields[i])]);
    if (track && lo.real && lo.t > track.since) track.out.push({ nid: l.id, field: i, kept: (left ? l : r).fields[i], lost: (left ? r : l).fields[i], lostOn: left ? track.from : "this device", keptOn: left ? "this device" : track.from, at: lo.t, seen: Date.now() });
  }
  const t: Record<string, number> = {}; const tags: string[] = [];
  const all = new Set([...base.tags, ...other.tags, ...Object.keys(l.pm?.t ?? {}), ...Object.keys(r.pm?.t ?? {})]);
  for (const k of all) {
    const pl = l.tags.includes(k), pr = r.tags.includes(k), sl = tagStamp(l, k), sr = tagStamp(r, k);
    const on = pl === pr ? pl : sl !== sr ? (sl > sr ? pl : pr) : (lw ? pl : pr);
    if (on) tags.push(k);
    if (l.pm?.t?.[k] !== undefined || r.pm?.t?.[k] !== undefined) { const st = Math.max(sl, sr); t[k] = on ? st : -st; }
  }
  const out: Note = { ...base, fields, tags, modified: Math.max(l.modified, r.modified), pm: { f, t } };
  const ed = Math.max(l.edited ?? 0, r.edited ?? 0); if (ed) out.edited = ed;
  const j = JSON.stringify(out); return j === JSON.stringify(base) ? base : j === JSON.stringify(other) ? other : out;
}
/** Sum of a record's part stamps, for shard fingerprints (0 without stamps, so older fingerprints stay the same). */
export function noteStampSum(n: Note): number { let s = 0; for (const x of n.pm?.f ?? []) s += x[0]; for (const v of Object.values(n.pm?.t ?? {})) s += Math.abs(v); return s; }
export function cardStampSum(c: Card): number { const p = c.pm; return p ? (p.s?.[0] ?? 0) + (p.u?.[0] ?? 0) + (p.d?.[0] ?? 0) : 0; }

/**
 * Merge remote notes into the local map. Returns how many changed locally. A tombstone beats a copy modified at or before it; a copy
 * edited after the deletion brings the note back (`revived` lists those that were not here, so their cards can be brought back too).
 */
export function mergeNotes(local: Map<string, Note>, remote: Note[], tombs: Record<string, number> = {}, opts: { changed?: Note[]; revived?: string[]; since?: number; from?: string; conflicts?: NoteConflict[] } = {}): number {
  let n = 0; const track = opts.conflicts ? { since: opts.since ?? 0, from: opts.from ?? "another device", out: opts.conflicts } : undefined;
  for (const r of remote) {
    const tomb = tombs["n:" + r.id] ?? -1; if (tomb >= r.modified) continue;
    const l = local.get(r.id); const m = l ? mergeNote(l, r, track) : r;
    if (m !== l) { local.set(r.id, m); n++; opts.changed?.push(m); if (!l && tomb >= 0) opts.revived?.push(r.id); }
  }
  return n;
}
/**
 * Merge remote cards into the local map. A card tombstone beats a copy changed at or before it. Without `notes`, so does the note's
 * tombstone. With `notes` (the local notes, already merged) a card is taken exactly when its note is here: a note edited after it was
 * deleted elsewhere came back and its cards come with it, and a card reviewed elsewhere after its note was deleted here doesn't linger.
 */
export function mergeCards(local: Map<string, Card>, remote: Card[], tombs: Record<string, number> = {}, opts: { notes?: Map<string, Note>; changed?: Card[] } = {}): number {
  let n = 0;
  for (const r of remote) {
    const t = cardMod(r);
    if ((tombs["c:" + r.id] ?? -1) >= t) continue;
    if (opts.notes ? !opts.notes.has(r.nid) : (tombs["n:" + r.nid] ?? -1) >= t) continue; // (notes merge first: a card whose note isn't here is an orphan)
    const l = local.get(r.id); const m = l ? mergeCard(l, r) : r;
    if (m !== l) { local.set(r.id, m); n++; opts.changed?.push(m); }
  }
  return n;
}
export function mergeReviews(local: Review[], remote: Review[], tombs: Record<string, number> = {}): { list: Review[]; added: number } {
  const ids = new Set(local.map((r) => r.id));
  const add = remote.filter((r) => !ids.has(r.id) && !("r:" + r.id in tombs));
  return { list: add.length ? local.concat(add).sort((a, b) => a.ts - b.ts) : local, added: add.length };
}
