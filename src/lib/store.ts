// In-memory collection + persistence + derived views (category tree, study queue, stats).
import type { Card, CardState, Note, Notetype, Rating, Review } from "./model";
import * as db from "./db";
import { rate, replay, retrievability, DEFAULT_CONFIG, type SchedulerConfig, DAY, toFsrs6, setActiveWeights } from "../scheduler/fsrs";
import { fit as fitWeights, calibration as calib } from "../scheduler/optimize";
import type { ImportResult } from "../import/anki";
import { parsePack, describePack } from "../import/pack";
import { noteTitle } from "./render";
import { stamp, observe } from "./clock";
import { SIMILAR_TAG, mergeInto, similarPairs } from "./dupes";
import { importMedia, mediaRefs, IMG, AUDIO, YUZU_MEDIA_MARK, shrinkImage, mimeFor, forgiving, type MediaEnv, type FolderHandles } from "../import/media";
import { writeZip, streamZip, ZipParts } from "./zipwrite";
import { GitHubSync, SyncError, COMPACT_EVERY, MEDIA_BATCH_BYTES, type MediaIndex, type MediaWant, type MasteredEntry, type ImproveMark, wantPath, mergeCards, mergeNotes, mergeReviews, mergeTombstones, type ShardCache, type SyncConfig } from "./sync";

export interface Settings {
  newPerDay: number;
  dailyGoal: number;      // reviews per day
  /** 0 = no limit. With a backlog, caps the due cards offered per day so sessions stay sane. */
  maxReviewsPerDay: number;
  /** Order of due cards: by due date, most-forgotten first (lowest recall probability), or shuffled within the day. */
  dueOrder: "due" | "forgotten" | "shuffle" | "rescue";
  rollover: number;       // hour of day when a new day starts
  scheduler: SchedulerConfig;
  deviceName: string;
  nightCards: boolean;
  swipe: boolean;
  burySiblings: boolean;
  restDays: number;       // streak-protected days per week
  /** Load per weekday (0 = Sunday … 6 = Saturday): 1 normal, 0.5 light, 0 off. The load balancer steers reviews away from light days. */
  easyDays: number[];
  /** A break (e.g. a night-shift week or travel): reviews are kept off these dates where the scheduler's spread allows. dd/mm via ISO yyyy-mm-dd strings. */
  breakFrom: string; breakTo: string;
  pins: { view: View; path: string }[];
  /** Scheduler fit: when it last ran, on how many predictions, and the log-loss before/after. */
  fit: { at: number; n: number; before: number; after: number } | null;
  /** Mastery thresholds in days of stability. */
  mastery: { developing: number; mastered: number; durable: number };
  leechThreshold: number;
  /** Mastered: offer cards whose next review is more than this many years away; retire automatically past `retireAutoYears` (0 = never). */
  retireAskYears: number; retireAutoYears: number;
  /** Boss fight results per node key (view:path). */
  bosses: Record<string, { at: number; score: number; best: number; passed: boolean }>;
  typeAnswers: boolean;
  /** Share deck images through the sync repository (synced setting). */
  mediaSync: boolean;
  /** Fetch shared images onto this device (per device). */
  mediaDownload: boolean;
  /** Palette (per device). */
  theme: "yuzu" | "orange" | "gameboy" | "night";
  /** Square-wave sound effects (per device). */
  sfx: boolean;
  /** Play card sounds automatically when a side appears (per device). */
  autoplay: boolean;
  /** "yuzu" lays one reading style over every deck's CSS; "deck" shows each deck's own look (per device). */
  cardStyle: "yuzu" | "deck";
  /** Note fields never shown and whose media is never kept (synced), e.g. AnKing's Sketchy fields. */
  hiddenFields: string[];
  /** Anki deck path → Yuzu category, learned from curation files; applied to new cards on every later Anki import (synced). */
  deckMap: Record<string, string>;
  smart: SmartDeck[];
  sync: { owner: string; repo: string; token: string; auto: boolean };
}
export const DEFAULT_SETTINGS: Settings = {
  newPerDay: 20, dailyGoal: 60, maxReviewsPerDay: 0, dueOrder: "forgotten", rollover: 4, scheduler: DEFAULT_CONFIG, deviceName: "", nightCards: true, swipe: true, burySiblings: true, restDays: 1,
  sync: { owner: "", repo: "yuzu-data", token: "", auto: true }, pins: [], smart: [],
  fit: null, mastery: { developing: 7, mastered: 30, durable: 90 }, leechThreshold: 8, easyDays: [1, 1, 1, 1, 1, 1, 1], breakFrom: "", breakTo: "", retireAskYears: 5, retireAutoYears: 20, bosses: {}, typeAnswers: true, mediaSync: false, mediaDownload: true, theme: "yuzu", sfx: true, autoplay: true, cardStyle: "yuzu", hiddenFields: ["Sketchy", "Sketchy 2", "Sketchy Extra"], deckMap: {},
};
export interface SmartDeck { id: string; name: string; systems: string[]; specialties: string[]; decks: string[]; tags: string[]; states: CardState[] }
export interface SyncStatus { state: "idle" | "syncing" | "ok" | "error" | "off"; message: string; at: number; pending?: boolean }
export interface SyncLogEntry { at: number; ok: boolean; message: string; ms: number }

export type View = "decks" | "systems" | "specialties" | "exams" | "tags" | "smart";
export const VIEWS: { id: View; label: string }[] = [
  { id: "decks", label: "Decks" }, { id: "systems", label: "Systems" }, { id: "specialties", label: "Specialties" }, { id: "exams", label: "Exams" }, { id: "tags", label: "Tags" },
];

export interface TreeNode {
  name: string; path: string; children: TreeNode[];
  total: number; due: number; newCount: number; learning: number; suspended: number; reviewed: number;
}

export interface Stats { today: number; goal: number; streak: number }

type Listener = () => void;

/** Spread cards so neighbours rarely share a group (system / deck): interleaving helps discrimination. Keeps the overall order roughly intact. */
function hashName(s: string): string { let h1 = 0x811c9dc5, h2 = 0x01000193; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); } return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0"); }

export function interleaveBySystem<T>(list: T[], groupOf: (x: T) => string): T[] {
  if (list.length < 3) return list;
  const out: T[] = []; const pending = [...list];
  let last = "";
  while (pending.length) {
    let idx = pending.findIndex((x, i) => i < 6 && groupOf(x) !== last);
    if (idx < 0) idx = 0;
    const x = pending.splice(idx, 1)[0]; out.push(x); last = groupOf(x);
  }
  return out;
}

/** Category for an Anki deck path: exact match, else the longest mapped parent with the rest of the path kept. */
export function mapDeck(source: string, map: Record<string, string>): string | null {
  if (!map || !source) return null;
  if (map[source]) return map[source] === source ? null : map[source];
  let p = source;
  while (p.includes("::")) { p = p.slice(0, p.lastIndexOf("::")); const to = map[p]; if (to) return to + source.slice(p.length); }
  return null;
}

export class Store {
  notetypes = new Map<string, Notetype>();
  notes = new Map<string, Note>();
  cards = new Map<string, Card>();
  tombstones: Record<string, number> = {};
  reviews: Review[] = [];
  media = new Map<string, Blob>();
  private mediaUrls = new Map<string, string>();
  settings: Settings = { ...DEFAULT_SETTINGS };
  loaded = false;
  syncStatus: SyncStatus = { state: "off", message: "Not set up", at: 0 };
  private dirty = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private syncAgain = false;
  private shardCache: ShardCache = new Map();
  syncLog: SyncLogEntry[] = [];
  private mediaCapWarned = false;
  // ---- Anki's media folder (PC): linked once, then new media goes to the other devices on every sync ----
  private ankiDir: any = undefined; // FileSystemDirectoryHandle | null once loaded
  ankiDirAccess: "none" | "granted" | "prompt" = "none";
  ankiDirName = "";
  mediaWants: Record<string, MediaWant> = {};
  sendNote = ""; // last word from the sender (e.g. "phone needs 47,000 files — use the phone media file once")
  private ankiList: ((n: string) => string | undefined) | null = null;
  private lastWantsKey = "";
  private listeners = new Set<Listener>();
  private version = 0;
  private treeCache = new Map<View, { v: number; tree: TreeNode }>();

  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getVersion = () => this.version;
  private bump() { this.version++; this.treeCache.clear(); for (const l of this.listeners) l(); }
  private edits = 0; // bumps on every local change, so a sync can tell whether something happened while it uploaded
  private touch() { this.edits++; if (!this.dirty) { this.dirty = true; db.setMeta("syncDirty", true).catch(() => {}); } this.scheduleSync(); }

  // ---- sync ---------------------------------------------------------------
  hasUnsynced(): boolean { return this.dirty; }
  syncConfigured(): boolean { const s = this.settings.sync; return !!(s.owner && s.repo && s.token); }
  scheduleSync(delay = 8000) {
    if (!this.syncConfigured() || !this.settings.sync.auto) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => { this.syncTimer = null; this.sync("auto").catch(() => {}); }, delay);
  }
  private setSync(state: SyncStatus["state"], message: string) { this.syncStatus = { state, message, at: Date.now() }; this.bump(); }

  private pausedUntil = 0;
  /** One sync at a time even with several tabs open (Web Locks), then the real work. */
  async sync(reason = "manual"): Promise<void> {
    if (reason !== "manual" && Date.now() < this.pausedUntil) return; // waiting out a rate limit
    const locks = (typeof navigator !== "undefined" ? (navigator as any).locks : null) as LockManager | null;
    if (!locks) return this.syncNow(reason);
    await locks.request("yuzu-sync", { ifAvailable: true }, async (lock) => { if (!lock) { this.syncAgain = true; return; } await this.syncNow(reason); });
  }
  private async syncNow(reason: string): Promise<void> {
    if (!this.syncConfigured()) { this.setSync("off", "Not set up"); return; }
    if (this.syncStatus.state === "syncing") { this.syncAgain = true; return; }
    if (typeof navigator !== "undefined" && !navigator.onLine) { this.setSync("error", "Offline — will sync when back online"); return; }
    const cfg: SyncConfig = { owner: this.settings.sync.owner, repo: this.settings.sync.repo, token: this.settings.sync.token };
    const gh = new GitHubSync(cfg);
    const t0 = Date.now();
    this.setSync("syncing", "Syncing…");
    let lastBump = 0;
    const progress = (m: string) => { if (this.syncStatus.state !== "syncing") return; this.syncStatus = { ...this.syncStatus, message: m }; const t = Date.now(); if (t - lastBump > 250) { lastBump = t; this.bump(); } };
    try {
      let summary = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        const known = await db.getMeta<Record<string, string>>("syncKnown", {});
        // Fast path: nothing changed here and the repository is exactly what we last saw → a couple of requests, no lock.
        const lastSeen = await db.getMeta<number>("syncSeenAt", 0);
        if (!this.dirty && attempt === 0) {
          if (!this.shardCache.size) { const saved = await db.getMeta<[string, { fp: string; hash: string }][]>("shardCache", []); for (const [k, v] of saved) this.shardCache.set(k, v); }
          const peek = await gh.pullManifest();
          if (peek && peek.updatedAt === lastSeen && this.shardCache.size) { await this.checkInbox(gh); summary = "Up to date"; break; }
        }
        // One device at a time: take the lock first; if another device holds it, come back in a minute instead of colliding.
        const lock = await gh.acquireLock(this.settings.deviceName || "device");
        if (!lock.held) { this.scheduleSync(60000); throw new SyncError(`${lock.by} is syncing right now; this device will retry in a minute.`, "busy"); }
        const remote = await gh.pullManifest();
        let pulledN = 0, pulledC = 0, pulledR = 0; let got: Awaited<ReturnType<GitHubSync["pullChanged"]>> | null = null;
        if (remote) {
          got = await gh.pullChanged(remote, known, progress);
          progress("Merging");
          // Keep our clock ahead of everything the other devices stamped.
          let maxT = 0; for (const n of got.notes ?? []) if (n.modified > maxT) maxT = n.modified; for (const c of got.cards ?? []) if ((c.mod ?? 0) > maxT) maxT = c.mod ?? 0; for (const r of got.reviews ?? []) if (r.ts > maxT) maxT = r.ts;
          observe(maxT); observe((got.settings as any)?.updatedAt);
          if (got.notetypes) { for (const nt of got.notetypes) this.notetypes.set(nt.id, nt); await db.putMany("notetypes", got.notetypes); }
          if (got.tombstones) {
            this.tombstones = mergeTombstones(this.tombstones, got.tombstones); await db.setMeta("tombstones", this.tombstones);
            const dn: string[] = [], dc: string[] = []; let byNote: Map<string, Card[]> | null = null;
            for (const [k, t] of Object.entries(got.tombstones)) {
              if (k.startsWith("n:")) { const id = k.slice(2); const n = this.notes.get(id); if (n && n.modified <= t) { byNote ??= this.cardsByNote(); this.notes.delete(id); dn.push(id); for (const c of byNote.get(id) ?? []) { this.cards.delete(c.id); dc.push(c.id); } } }
              else if (k.startsWith("c:")) { const id = k.slice(2); const c = this.cards.get(id); if (c && (c.mod ?? c.lastReview) <= t) { this.cards.delete(id); dc.push(id); } }
            }
            const rids = new Set(this.reviews.map((r) => r.id));
            const dr = Object.keys(got.tombstones).filter((k) => k.startsWith("r:")).map((k) => k.slice(2)).filter((id) => rids.has(id));
            if (dr.length) { const set = new Set(dr); this.reviews = this.reviews.filter((r) => !set.has(r.id)); await db.deleteMany("reviews", dr); }
            if (dn.length) await db.deleteMany("notes", dn); if (dc.length) { await db.deleteMany("cards", dc); this.dropUndo(new Set(dc)); }
          }
          if (got.notes) { const before = new Map(this.notes); pulledN = mergeNotes(this.notes, got.notes, this.tombstones); const changed = got.notes.filter((n) => this.notes.get(n.id) === n && before.get(n.id) !== n); await db.putMany("notes", changed); }
          if (got.cards) { const changed: Card[] = []; for (const c of got.cards) { const l = this.cards.get(c.id); if ((this.tombstones["c:" + c.id] ?? -1) >= (c.mod ?? c.lastReview) || (this.tombstones["n:" + c.nid] ?? -1) >= (c.mod ?? c.lastReview)) continue; if (!l || (c.mod ?? c.lastReview) > (l.mod ?? l.lastReview)) changed.push(c); } pulledC = mergeCards(this.cards, got.cards, this.tombstones); await db.putMany("cards", changed); }
          if (got.reviews) { const m = mergeReviews(this.reviews, got.reviews, this.tombstones); pulledR = m.added; if (m.added) { const ids = new Set(this.reviews.map((r) => r.id)); await db.putMany("reviews", got.reviews.filter((r) => !ids.has(r.id))); this.reviews = m.list; } }
          if (got.settings && (got.settings as any).updatedAt > ((this.settings as any).updatedAt ?? 0)) {
            const { sync: _s, deviceName: _d, nightCards: _n, swipe: _w, typeAnswers: _t, mediaDownload: _m, theme: _th, sfx: _sf, autoplay: _ap, cardStyle: _cs, ...rest } = got.settings as any; // per-device fields stay local
            const oldW = (this.settings.scheduler.w?.length ?? 0) < 21 || ((rest as any).scheduler?.w?.length ?? 21) < 21;
            this.settings = { ...this.settings, ...rest }; this.settings.scheduler = { ...this.settings.scheduler, w: toFsrs6(this.settings.scheduler.w) }; if (oldW) this.settings.fit = null; setActiveWeights(this.settings.scheduler.w); await db.setMeta("settings", this.settings);
          }
          if (got.mastery) {
            const ids = new Set(this.mastery.log.map((e) => e.id)); const log = [...this.mastery.log, ...got.mastery.log.filter((e) => !ids.has(e.id))];
            const kept = { ...this.mastery.kept }; for (const [k, v] of Object.entries(got.mastery.kept ?? {})) kept[k] = Math.max(kept[k] ?? 0, v);
            this.mastery = { log, kept }; await db.setMeta("mastery", this.mastery);
          }
          if (got.improve) { let changed = false; const merged = { ...this.improve }; for (const [k, v] of Object.entries(got.improve)) if ((merged[k]?.m ?? -1) < v.m) { merged[k] = v; changed = true; } if (changed) { this.improve = merged; await db.setMeta("improve", merged); } }
          if (got.hooks) { let changed = false; const merged = { ...this.hooks }; for (const [k, v] of Object.entries(got.hooks as typeof this.hooks)) if ((merged[k]?.m ?? -1) < v.m) { merged[k] = v; changed = true; } if (changed) { this.hooks = merged; await db.setMeta("hooks", merged); } }
          if (got.media) { const blobs: { name: string; blob: Blob }[] = []; for (const [name, url] of Object.entries(got.media as Record<string, string>)) { if (this.media.has(name)) continue; const blob = await (await fetch(url)).blob(); this.media.set(name, blob); blobs.push({ name, blob }); } if (blobs.length) { await db.putMany("media", blobs); this.mediaUrls.clear(); } }
          if (pulledN + pulledC + pulledR) { this.treeCache.clear(); this.dueByDay = null; }
        }
        await this.checkInbox(gh);
        // Shared images: merge the repository's index, pick what to upload from here (bounded per sync).
        let mediaIndex: MediaIndex = { ...(await db.getMeta<MediaIndex>("mediaIndex", {})), ...(got?.mediaIndex ?? {}) };
        const mediaBlobs: { path: string; bytes: Uint8Array }[] = [];
        if (this.settings.mediaSync) {
          let budget = MEDIA_BATCH_BYTES; let total = Object.values(mediaIndex).reduce((a, v) => a + v.s, 0);
          for (const [name, blob] of this.media) {
            if (budget <= 0) break;
            if (name.startsWith("pack-") || mediaIndex[name] || !/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name) || blob.size > 4 * 1048576) continue;
            if (total + blob.size > 900 * 1048576) { if (!this.mediaCapWarned) { this.mediaCapWarned = true; this.log(false, "Shared images reached 900 MB; further images stay on this device only", 0); } break; }
            total += blob.size;
            const ext = name.split(".").pop()!.toLowerCase(); const path = `media/${hashName(name)}.${blob.type === "image/webp" ? "webp" : ext}`;
            mediaBlobs.push({ path, bytes: new Uint8Array(await blob.arrayBuffer()) }); mediaIndex = { ...mediaIndex, [name]: { p: path, s: blob.size } }; budget -= blob.size;
          }
        }
        // Media wants: each device says which files its cards use that it lacks; a PC with Anki's folder linked sends them.
        const me = await this.deviceId(); const myName = this.settings.deviceName || "Another device";
        // Other devices' lists are kept only while their file is in the repository: when a device stops wanting media it
        // removes its own file, and nobody else puts it back (no ping-pong between devices).
        const inRepo = new Set(Object.keys(remote?.files ?? {}));
        const wants: Record<string, MediaWant> = { ...(await db.getMeta<Record<string, MediaWant>>("mediaWants", {})), ...(got?.mediaWants ?? {}) };
        for (const [k, w] of Object.entries(wants)) if (!w.id || (k !== me && !inRepo.has(wantPath(k)))) delete wants[k]; // (lists from the first version had no id)
        const dir = await this.ankiFolder();
        const wantsKey = this.settings.mediaDownload && !dir ? `${this.refsKey()}|${this.media.size}|${Object.keys(mediaIndex).length}|${myName}` : "";
        if (this.settings.mediaDownload && !dir && wants[me] && wantsKey === this.lastWantsKey) { /* nothing changed: keep the list as it is */ }
        else if (this.settings.mediaDownload && !dir) {
          this.lastWantsKey = wantsKey;
          const miss: string[] = []; let total = 0;
          for (const r of this.mediaRefs()) if (!this.media.has(r) && !mediaIndex[r] && !/\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(r)) { total++; if (miss.length < 20000) miss.push(r); }
          const prev = wants[me]; if (!prev || prev.total !== total || prev.device !== myName) wants[me] = { id: me, device: myName, at: Date.now(), total, missing: miss };
        } else delete wants[me];
        // Senders: Anki's folder (PC, linked) or this device's own library (the phone as the master copy).
        if (dir || this.media.size) { const more = await this.sendWanted(dir, wants, me, mediaIndex, mediaBlobs, progress); mediaIndex = more.index; if (more.left) this.scheduleSync(4000); }
        this.mediaWants = wants;
        progress("Preparing upload"); const editsAtSnapshot = this.edits;
        if (!this.shardCache.size) { const saved = await db.getMeta<[string, { fp: string; hash: string }][]>("shardCache", []); for (const [k, v] of saved) this.shardCache.set(k, v); }
        const { hashes, make } = await GitHubSync.shard({
          notetypes: [...this.notetypes.values()], notes: [...this.notes.values()], cards: [...this.cards.values()], reviews: this.reviews, tombstones: this.tombstones, media: await this.packMedia(), mediaIndex, mediaWants: wants, mastery: this.mastery, improve: this.improve, hooks: this.hooks,
          settings: { ...this.settings, sync: undefined, updatedAt: (this.settings as any).updatedAt ?? 0 },
        }, this.shardCache);
        try {
          const counts = { notes: this.notes.size, cards: this.cards.size, reviews: this.reviews.length };
          // Safety stop: never replace a repository with a much smaller collection (a half-finished pull, a fresh browser).
          const rc0 = remote?.counts;
          if (rc0 && rc0.cards > 1000 && counts.cards < rc0.cards * 0.5) {
            await db.setMeta("syncKnown", {}); await gh.releaseLock();
            throw new SyncError(`This device has ${counts.cards.toLocaleString()} cards but the repository has ${rc0.cards.toLocaleString()}; nothing was uploaded. The next sync downloads everything first.`, "other");
          }
          const res = await gh.push(hashes, make, remote, this.settings.deviceName, progress, counts, mediaBlobs);
          if (!res.commit) await gh.releaseLock(); // nothing to push: the push did not make a commit, so remove the lock separately
          await db.setMeta("syncKnown", res.manifest.files); await db.setMeta("syncSeenAt", res.manifest.updatedAt); await db.setMeta("mediaIndex", mediaIndex); await db.setMeta("mediaWants", wants);
          // Shared images missing here: fetch a batch now; the rest on the next sync.
          if (this.settings.mediaDownload) {
            const waiting = Object.entries(mediaIndex).filter(([name, v]) => v.p && !this.media.has(name)); const used = waiting.length ? this.mediaRefs() : null; const missing = waiting.filter(([name]) => used!.has(name)); let budget = MEDIA_BATCH_BYTES, done = 0; const got2: { name: string; blob: Blob }[] = [];
            const q = missing.filter(([, v]) => { if (budget - v.s < 0) return false; budget -= v.s; return true; });
            await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) { const [name, v] = q.shift()!; try { const bytes = await gh.readBinary(v.p); if (bytes) { const blob = new Blob([bytes as BlobPart], { type: v.p.endsWith(".webp") ? "image/webp" : mimeFor(name) }); this.media.set(name, blob); got2.push({ name, blob }); } } catch { /* next time */ } progress(`Downloading images ${++done}/${q.length + done}`); } }));
            if (got2.length) { await db.putMany("media", got2); this.mediaUrls.clear(); }
            if (missing.length > got2.length) this.scheduleSync(4000); // keep going in the background
            if (got2.length) this.log(true, `${got2.length} shared images and sounds downloaded`, 0);
          }
          await db.setMeta("shardCache", [...this.shardCache.entries()]);
          if (this.edits === editsAtSnapshot) { this.dirty = false; await db.setMeta("syncDirty", false); } else this.scheduleSync(3000); // changed during the upload: go again
          // Accuracy check: after a sync both sides must describe the same collection.
          const rc = res.manifest.counts;
          if (rc && !res.pushed && (rc.notes !== counts.notes || rc.cards !== counts.cards || rc.reviews !== counts.reviews)) {
            await db.setMeta("syncKnown", {}); this.dirty = true; await db.setMeta("syncDirty", true);
            throw new SyncError(`This device differs from the repository (${counts.cards.toLocaleString()} vs ${rc.cards.toLocaleString()} cards); the next sync re-checks every file.`, "other");
          }
          // Keep the repository from growing forever: every COMPACT_EVERY commits, fold the history into one commit.
          if ((res.manifest.commits ?? 0) >= COMPACT_EVERY) { progress("Compacting history"); try { if (await gh.compact(this.settings.deviceName)) this.log(true, "History compacted", 0); } catch { /* next time */ } }
          const parts = [];
          if (pulledN + pulledC + pulledR) parts.push(`pulled ${pulledC.toLocaleString()} cards, ${pulledR.toLocaleString()} reviews`);
          if (res.pushed) parts.push(`pushed ${res.pushed} files (${res.bytes > 1048576 ? (res.bytes / 1048576).toFixed(1) + " MB" : Math.round(res.bytes / 1024) + " KB"})`);
          summary = parts.length ? parts.join(", ") : "Up to date";
          break;
        } catch (e) {
          // Another device pushed in between: pull again and retry (already-uploaded files are reused).
          if (e instanceof SyncError && e.kind === "conflict" && attempt < 2) { progress("Another device synced at the same time — retrying"); continue; }
          await gh.releaseLock();
          throw e;
        }
      }
      this.log(true, summary, Date.now() - t0);
      this.setSync("ok", summary);
      this.autoMaster().catch(() => {});
      this.bump();
    } catch (e: any) {
      if (e instanceof SyncError && e.kind === "ratelimit" && e.resumeAt) { this.pausedUntil = e.resumeAt; this.scheduleSync(Math.max(60000, e.resumeAt - Date.now() + 5000)); }
      const msg = e?.message ?? String(e);
      this.log(e instanceof SyncError && e.kind === "busy", msg, Date.now() - t0);
      this.setSync(e instanceof SyncError && e.kind === "busy" ? "idle" : "error", msg);
    } finally {
      if (this.syncAgain) { this.syncAgain = false; this.scheduleSync(1000); }
    }
  }
  /** Forget the known remote hashes and the shard cache so the next sync compares everything again. */
  async resetSyncState() { await db.setMeta("syncKnown", {}); await db.setMeta("syncSeenAt", 0); await db.setMeta("shardCache", []); this.shardCache.clear(); this.dirty = true; await db.setMeta("syncDirty", true); }
  /** Compact the repository's history now (Settings). */
  async compactNow(): Promise<string> {
    if (!this.syncConfigured()) return "Sync is not set up";
    const gh = new GitHubSync({ owner: this.settings.sync.owner, repo: this.settings.sync.repo, token: this.settings.sync.token });
    await gh.pullManifest();
    const before = await gh.repoSizeMB();
    const ok = await gh.compact(this.settings.deviceName);
    return ok ? `History compacted${before != null ? ` (repository was ${before.toFixed(0)} MB; GitHub reclaims the rest within a few days)` : ""}.` : "Another device was syncing; try again in a minute.";
  }
  private log(ok: boolean, message: string, ms: number) {
    this.syncLog = [{ at: Date.now(), ok, message, ms }, ...this.syncLog].slice(0, 20);
    db.setMeta("syncLog", this.syncLog).catch(() => {});
  }


  /** Paths a card belongs to in a given view (a card can sit in several categories). */
  paths(c: Card, view: View): string[] {
    if (view === "decks" || view === "smart") return [c.source];
    const n = this.notes.get(c.nid);
    if (!n) return [];
    if (view === "systems") {
      const p = n.tags.filter((t) => t.startsWith("auto::System::")).map((t) => t.slice(14));
      return p.length ? p : ["Unclassified"];
    }
    if (view === "specialties") {
      const p = n.tags.filter((t) => t.startsWith("auto::Specialty::")).map((t) => t.slice(17));
      return p.length ? p : ["Other"];
    }
    if (view === "exams") {
      const p = n.tags.filter((t) => t.startsWith("auto::Exam::") || t.startsWith("auto::Level::")).map((t) => t.startsWith("auto::Exam::") ? t.slice(12) : "German level::" + t.slice(13));
      return p.length ? p : ["No exam"];
    }
    const p = n.tags.filter((t) => !t.startsWith("auto::") && !t.startsWith("manual::"));
    return p.length ? p : ["Untagged"];
  }

  loadError: string | null = null;
  saveError: string | null = null;
  /** Problems found while loading (orphan cards dropped, bad values fixed). Shown in Settings → Diagnostics. */
  loadNotes: string[] = [];

  /** One-off data fixes, each run once per device (flag in meta). */
  private async migrations() {
    const done = await db.getMeta<string[]>("migrations", []);
    if (!done.includes("exam-not-specialty")) {
      // "USMLE Step 1" used to be assigned as a specialty; it is an exam (Exams view) and belongs nowhere else.
      const out: Note[] = []; const now = stamp();
      for (const n of this.notes.values()) if (n.tags.includes("auto::Specialty::USMLE Step 1")) { const m = { ...n, tags: n.tags.filter((t) => t !== "auto::Specialty::USMLE Step 1"), modified: now }; this.notes.set(n.id, m); out.push(m); }
      if (out.length) { await db.putMany("notes", out); this.dirty = true; }
      await db.setMeta("migrations", [...done, "exam-not-specialty"]);
    }
  }

  /** Run a persistence write; a failure is remembered and shown instead of silently losing data. */
  protected async persist<T>(what: string, p: Promise<T>): Promise<T | undefined> {
    try { const r = await p; if (this.saveError) { this.saveError = null; this.bump(); } return r; }
    catch (e: any) {
      this.saveError = `${what}: ${e?.message ?? e}`; console.error("save failed", what, e); this.bump();
      db.setMeta("lastError", { at: Date.now(), where: what, message: String(e?.message ?? e) }).catch(() => {});
      return undefined;
    }
  }

  async load() {
    try { await this.loadInner(); }
    catch (e: any) { this.loadError = e?.message ?? String(e); console.error("load failed", e); this.bump(); throw e; }
  }
  private async loadInner() {
    const snap = await db.loadSnapshot();
    this.notetypes = new Map(snap.notetypes.map((n) => [n.id, n]));
    this.notes = new Map(snap.notes.map((n) => [n.id, n]));
    // Validate: drop cards whose note is gone, repair impossible numbers so the scheduler can never choke on them.
    const cards = new Map<string, Card>(); let orphans = 0, repaired = 0;
    for (const c of snap.cards) {
      if (!this.notes.has(c.nid)) { orphans++; continue; }
      let x = c;
      if (!Number.isFinite(x.due) || !Number.isFinite(x.stability) || !Number.isFinite(x.difficulty) || !Number.isFinite(x.mod ?? 0)) { x = { ...x, due: Number.isFinite(x.due) ? x.due : Date.now(), stability: Number.isFinite(x.stability) ? x.stability : 0, difficulty: Number.isFinite(x.difficulty) ? x.difficulty : 5, mod: Number.isFinite(x.mod ?? 0) ? x.mod : x.lastReview }; repaired++; }
      cards.set(x.id, x);
    }
    this.cards = cards;
    if (orphans) this.loadNotes.push(`${orphans} cards without a note were ignored`);
    if (repaired) this.loadNotes.push(`${repaired} cards had invalid scheduling values and were repaired`);
    this.reviews = snap.reviews.filter((r) => Number.isFinite(r.ts)).sort((a, b) => a.ts - b.ts);
    for (const m of await db.getAll<{ name: string; blob: Blob }>("media")) this.media.set(m.name, m.blob);
    const saved = await db.getMeta<Partial<Settings>>("settings", {});
    this.tombstones = await db.getMeta<Record<string, number>>("tombstones", {});
    this.dirty = await db.getMeta<boolean>("syncDirty", false);
    this.syncLog = await db.getMeta<SyncLogEntry[]>("syncLog", []);
    this.dismissedPairs = new Set(await db.getMeta<string[]>("dismissedPairs", []));
    this.inbox = await db.getMeta<typeof this.inbox>("inbox", []);
    this.undoStack = await db.getMeta<typeof this.undoStack>("undoStack", []);
    this.hooks = await db.getMeta<typeof this.hooks>("hooks", {});
    this.improve = await db.getMeta<typeof this.improve>("improve", {});
    this.mastery = await db.getMeta<typeof this.mastery>("mastery", { log: [], kept: {} });
    this.packLog = await db.getMeta<typeof this.packLog>("packLog", []);
    this.mergeLog = await db.getMeta<typeof this.mergeLog>("mergeLog2", []);
    this.settings = { ...DEFAULT_SETTINGS, ...saved, sync: { ...DEFAULT_SETTINGS.sync, ...(saved.sync ?? {}) }, scheduler: { ...DEFAULT_CONFIG, ...(saved.scheduler ?? {}) } };
    // FSRS-6 (28/10/2026): 19 saved weights → 21; re-tune on the user's history under FSRS-6 shortly after start.
    if ((this.settings.scheduler.w?.length ?? 0) < 21) { this.settings = { ...this.settings, scheduler: { ...this.settings.scheduler, w: toFsrs6(this.settings.scheduler.w) }, fit: null }; await db.setMeta("settings", this.settings); }
    setActiveWeights(this.settings.scheduler.w);
    await this.migrations();
    this.loaded = true;
    if (this.syncConfigured()) this.syncStatus = { state: "idle", message: "Ready", at: 0 };
    this.bump();
    if (typeof window !== "undefined") {
      // Ask the browser not to evict our data under storage pressure (silently ignored where unsupported).
      navigator.storage?.persist?.().catch(() => {});
      // Re-fit the scheduler in the background once enough new reviews have accumulated.
      const since = this.settings.fit ? this.reviews.filter((r) => r.ts > this.settings.fit!.at).length : this.reviews.length;
      if (since >= 1000) setTimeout(() => { this.optimizeScheduler().catch(() => {}); }, 15000);
      this.scheduleSync(1500);
      window.addEventListener("online", () => this.scheduleSync(2000));
      // While the app is open, look for changes from other devices every 5 minutes (one or two requests when nothing changed).
      setInterval(() => { if (document.visibilityState === "visible" && this.syncConfigured() && this.settings.sync.auto && this.syncStatus.state !== "syncing") this.sync("poll").catch(() => {}); }, 5 * 60000);
      // Leaving the app: push unsynced changes right away (the 8 s debounce would otherwise lose the last reviews
      // if the phone kills the tab). Coming back: pull what other devices did.
      setTimeout(() => { this.autoMaster().catch(() => {}); }, 3000); // retire cards past 20 years (after start-up settles)
      db.getMeta<{ key: string; names: string[] } | null>("mediaRefs", null).then((r) => { if (r && !this.savedRefs) this.savedRefs = r; }).catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") { if (this.dirty && this.syncConfigured()) { if (this.syncTimer) clearTimeout(this.syncTimer); this.syncTimer = null; this.sync("hidden").catch(() => {}); } }
        else this.scheduleSync(this.dirty ? 500 : 2000);
      });
    }
  }

  async saveSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch, updatedAt: stamp() } as Settings;
    if (patch.scheduler) setActiveWeights(this.settings.scheduler.w);
    this.bump();
    await this.persist("saving settings", db.setMeta("settings", this.settings));
    this.touch();
  }

  /** Merge an import. Existing cards keep their Yuzu review state unless they had none. */
  async applyImport(res: ImportResult, onProgress?: (msg: string, frac: number) => void) {
    this.dueByDay = null; // due dates are about to change wholesale
    for (const nt of res.notetypes) this.notetypes.set(nt.id, nt);
    let newNotes = 0, newCards = 0, updated = 0, organized = 0;
    const notesOut: Note[] = []; const cardsOut: Card[] = [];
    const lastAt = (await db.getMeta<{ at: number } | null>("lastImport", null))?.at ?? 0;
    const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);
    for (const n of res.notes) {
      if (this.tombstones["n:" + n.id] !== undefined && !this.notes.has(n.id)) continue; // merged or removed in Yuzu: stays gone even when Anki edits it later (unless restored)
      const existing = this.notes.get(n.id);
      if (!existing) { newNotes++; const m = { ...n, ankiMod: n.modified }; this.notes.set(n.id, m); notesOut.push(m); continue; }
      // Did Anki change the note since the version Yuzu has? Compare with Anki's own time, not Yuzu's
      // (organizing or tagging in Yuzu must not block content fixes from the deck's author).
      const base = existing.ankiMod ?? (lastAt || existing.modified);
      if (n.modified <= base) continue;
      // Keep tags added in Yuzu (auto::…, needs-review, pack tags) when Anki's version of the note is newer.
      const keepTags = existing.tags.filter((t) => t.startsWith("auto::") || t.startsWith("needs-review::") || t.startsWith("manual::") || t.startsWith("leech") || t.startsWith("anki::") || t === "ask-claude");
      const importTags = existing.tags.includes("manual::classified") ? n.tags.filter((t) => !t.startsWith("auto::")) : n.tags;
      const userEdited = (existing.edited ?? 0) > base;
      const fields = userEdited ? existing.fields : n.fields;
      const tags = [...new Set([...importTags, ...keepTags, ...(userEdited && n.fields.join("\x1f") !== existing.fields.join("\x1f") ? ["needs-review::anki-changed"] : [])])];
      const changed = fields.join("\x1f") !== existing.fields.join("\x1f") || !sameTags(tags, existing.tags) || n.ntid !== existing.ntid;
      // stamp(): the update must win the sync against older copies on other devices.
      const merged = { ...existing, ntid: n.ntid, fields, tags, ankiMod: n.modified, modified: changed ? stamp() : existing.modified };
      if (changed) updated++;
      this.notes.set(n.id, merged); notesOut.push(merged);
    }
    const knownReviewIds = new Set(this.reviews.map((r) => r.id));
    for (const c of res.cards) {
      if ((this.tombstones["c:" + c.id] !== undefined && !this.cards.has(c.id)) || !this.notes.has(c.nid)) continue;
      const existing = this.cards.get(c.id);
      if (!existing) { const to = mapDeck(c.source, this.settings.deckMap); const m = to ? { ...c, source: to } : c; this.cards.set(c.id, m); cardsOut.push(m); newCards++; if (to) organized++; continue; }
      // Whichever side has the more recent review keeps its scheduling state. Yuzu owns the category (source) once imported.
      if (c.lastReview > existing.lastReview) { const m = { ...c, flag: existing.flag, source: existing.source }; this.cards.set(c.id, m); cardsOut.push(m); }
    }
    const addedReviews = res.reviews.filter((r) => !knownReviewIds.has(r.id));
    this.reviews = this.reviews.concat(addedReviews).sort((a, b) => a.ts - b.ts);
    onProgress?.("Saving note types", 0.05);
    await db.putMany("notetypes", res.notetypes);
    onProgress?.("Saving notes", 0.1);
    await db.putMany("notes", notesOut, 1000, (f) => onProgress?.("Saving notes", 0.1 + f * 0.4));
    onProgress?.("Saving cards", 0.5);
    await db.putMany("cards", cardsOut, 2000, (f) => onProgress?.("Saving cards", 0.5 + f * 0.3));
    onProgress?.("Saving reviews", 0.8);
    await db.putMany("reviews", addedReviews, 5000, (f) => onProgress?.("Saving reviews", 0.8 + f * 0.2));
    await db.setMeta("lastImport", { at: Date.now(), summary: res.summary });
    this.bump(); this.touch();
    return { newNotes, newCards, updated, organized, reviews: addedReviews.length };
  }

  mediaUrl = (name: string): string | null => {
    const hit = this.mediaUrls.get(name); if (hit) return hit;
    const b = this.media.get(name); if (!b) return null;
    const u = URL.createObjectURL(b); this.mediaUrls.set(name, u); return u;
  };

  async importPack(json: unknown): Promise<string> {
    const r = parsePack(json, this.notes.values());
    for (const nt of r.notetypes) this.notetypes.set(nt.id, nt);
    for (const n of r.notes) this.notes.set(n.id, n);
    // Revised notes keep their existing cards (and scheduling); new cloze numbers get new cards,
    // cloze numbers that disappeared are suspended rather than deleted so sync stays consistent.
    // Existing cards are matched by note + template/cloze number, not by id: an Anki card keeps its Anki id
    // (and its scheduling) when a pack revises the note.
    const updated = new Set(r.updated); const cardsOut: Card[] = [];
    const byNoteOrd = new Map<string, Card>();
    if (updated.size) for (const c of this.cards.values()) if (updated.has(c.nid)) byNoteOrd.set(c.nid + "#" + c.ord, c);
    const kept = new Set<string>();
    for (const c of r.cards) {
      const prev = updated.has(c.nid) ? (this.cards.get(c.id) ?? byNoteOrd.get(c.nid + "#" + c.ord)) : undefined;
      if (prev) { kept.add(prev.id); continue; }
      this.cards.set(c.id, c); cardsOut.push(c); kept.add(c.id);
    }
    if (updated.size) {
      const now = stamp();
      for (const c of this.cards.values()) if (updated.has(c.nid) && !kept.has(c.id) && !c.suspended) { const s2 = { ...c, suspended: true, mod: now }; this.cards.set(c.id, s2); cardsOut.push(s2); }
    }
    r.cards = cardsOut;
    const blobs: { name: string; blob: Blob }[] = [];
    for (const m of r.media) { const res = await fetch(m.dataUrl); const blob = await res.blob(); this.media.set(m.name, blob); blobs.push({ name: m.name, blob }); }
    await db.putMany("notetypes", r.notetypes); await db.putMany("notes", r.notes); await db.putMany("cards", r.cards); if (blobs.length) await db.putMany("media", blobs);
    this.bump(); this.touch();
    return describePack(r);
  }

  /** Apply a curation file made by Claude: deck moves, note merges (keep one note, drop the copies, union tags) and tag additions. */
  async importCuration(json: unknown, onProgress?: (msg: string, frac: number) => void): Promise<string> {
    const c = json as { yuzu_curation: 1; name?: string; decks?: Record<string, string | null>; merges?: { keep: string; drop: string[]; tags?: string[] }[]; review?: string[][]; tags?: Record<string, string[]>; suspend?: string[]; edits?: { id: string; fields: Record<string, string>; tags?: string[] }[]; packs?: unknown[] };
    if (!c || c.yuzu_curation !== 1) throw new Error("Not a Yuzu curation file");
    const now = stamp();
    const changedNotes = new Map<string, Note>(); const changedCards = new Map<string, Card>();
    const delNotes: string[] = []; const delCards: string[] = [];
    const touchNote = (id: string, f: (n: Note) => void) => { const n = changedNotes.get(id) ?? this.notes.get(id); if (!n) return; const m = { ...n, tags: [...n.tags] }; f(m); m.modified = now; changedNotes.set(id, m); this.notes.set(id, m); };
    // 1. merges
    onProgress?.("Merging duplicates", 0.1);
    let merged = 0, moved = 0, tagged = 0, dropped = 0;
    const log: { keep: string; dropped: Note[]; cards: Card[] }[] = [];
    const keepSnap = new Map<string, { note: Note; cards: Card[] }>();
    const byNid = new Map<string, Card[]>(); for (const card of this.cards.values()) (byNid.get(card.nid) ?? byNid.set(card.nid, []).get(card.nid)!).push(card);
    for (const m of c.merges ?? []) {
      if (!this.notes.has(m.keep)) continue;
      const entry = { keep: m.keep, dropped: [] as Note[], cards: [] as Card[] };
      if (!keepSnap.has(m.keep)) keepSnap.set(m.keep, { note: this.notes.get(m.keep)!, cards: byNid.get(m.keep) ?? [] });
      for (const d of m.drop) {
        const n = this.notes.get(d); if (!n || d === m.keep) continue;
        entry.dropped.push(n); delNotes.push(d); this.notes.delete(d);
        for (const card of byNid.get(d) ?? []) { entry.cards.push(card); delCards.push(card.id); this.cards.delete(card.id); }
        this.tombstones["n:" + d] = now; dropped++;
      }
      if (entry.dropped.length) { log.push(entry); merged++; }
      if (m.tags?.length) touchNote(m.keep, (n) => { for (const t of m.tags!) if (!n.tags.includes(t)) n.tags.push(t); });
    }
    // 2. deck moves (exact deck path → new path; null = drop the deck)
    onProgress?.("Moving decks", 0.4);
    const decks = c.decks ?? {};
    for (const card of [...this.cards.values()]) {
      if (!(card.source in decks)) continue;
      const to = decks[card.source];
      if (to === null) { delCards.push(card.id); this.cards.delete(card.id); this.tombstones["c:" + card.id] = now; const sibs = byNid.get(card.nid) ?? []; if (sibs.every((x) => !this.cards.has(x.id)) && this.notes.has(card.nid)) { delNotes.push(card.nid); this.notes.delete(card.nid); this.tombstones["n:" + card.nid] = now; } dropped++; continue; }
      if (to === card.source) continue;
      const m = { ...card, source: to, mod: now }; this.cards.set(card.id, m); changedCards.set(card.id, m); moved++;
    }
    // 3. tags
    onProgress?.("Tagging", 0.7);
    for (const [tag, ids] of Object.entries(c.tags ?? {})) for (const id of ids) { const n = this.notes.get(id); if (n && !n.tags.includes(tag)) { touchNote(id, (x) => x.tags.push(tag)); tagged++; } }
    for (const g of c.review ?? []) for (const id of g) { const n = this.notes.get(id); if (n && !n.tags.includes("needs-review::similar")) touchNote(id, (x) => x.tags.push("needs-review::similar")); }
    // 4. edits: rewrite fields of existing notes in place (note type, cards and review history stay).
    // Marked as edited, so a later Anki update of the same note is flagged instead of overwriting the fix.
    let edited = 0;
    for (const e of c.edits ?? []) {
      const n = changedNotes.get(e.id) ?? this.notes.get(e.id); if (!n) continue;
      const fields = [...n.fields]; let diff = false;
      for (const [k, v] of Object.entries(e.fields)) { const i = Number(k); if (Number.isInteger(i) && i >= 0 && i < fields.length && fields[i] !== v) { fields[i] = v; diff = true; } }
      if (!diff && !e.tags?.length) continue;
      touchNote(e.id, (x) => { x.fields = fields; x.edited = now; for (const t of e.tags ?? []) if (!x.tags.includes(t)) x.tags.push(t); });
      if (diff) edited++;
    }
    // 5. suspend (e.g. notes the deck's author removed in Anki): history kept, reversible from the Library.
    let suspended = 0;
    for (const id of c.suspend ?? []) for (const card of byNid.get(id) ?? []) { const cur = changedCards.get(card.id) ?? this.cards.get(card.id); if (cur && !cur.suspended) { const m = { ...cur, suspended: true, mod: now }; this.cards.set(card.id, m); changedCards.set(card.id, m); suspended++; } }
    // Remember where Anki decks belong, so later imports land new cards in the right category by themselves.
    const learned = Object.fromEntries(Object.entries(decks).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    if (Object.keys(learned).length) await this.saveSettings({ deckMap: { ...this.settings.deckMap, ...learned } });
    onProgress?.("Saving", 0.85);
    await db.putMany("notes", [...changedNotes.values()]); await db.putMany("cards", [...changedCards.values()]);
    if (delNotes.length) await db.deleteMany("notes", delNotes); if (delCards.length) await db.deleteMany("cards", delCards);
    await db.setMeta("tombstones", this.tombstones);
    this.mergeLog = [...log.map((e, i) => ({ at: now + i, keep: e.keep, dropped: e.dropped, cards: e.cards, keepBefore: keepSnap.get(e.keep)!.note, keepCardsBefore: keepSnap.get(e.keep)!.cards })), ...this.mergeLog].slice(0, 1000);
    await db.setMeta("mergeLog2", this.mergeLog);
    this.bump(); this.touch();
    // 6a. Marks "needs improving" on the notes this file dealt with are cleared.
    const dealt = [...new Set([...(c.edits ?? []).map((e) => e.id), ...(c.suspend ?? []), ...((c as any).resolved ?? [])])].filter((id) => this.improve[id]?.r.length || this.notes.get(id)?.tags.includes("ask-claude"));
    if (dealt.length) await this.clearImprove(dealt);
    // 6. card packs carried in the same file (new cards, placed by their own category)
    const packMsgs: string[] = [];
    for (const [i, p] of (c.packs ?? []).entries()) { onProgress?.(`Adding cards (${i + 1}/${c.packs!.length})`, 0.9 + (0.1 * i) / c.packs!.length); packMsgs.push(`${(p as any)?.name ?? "Pack"}: ${await this.importPack(p)}.`); }
    return `${merged} duplicate groups merged (${dropped} notes removed), ${moved.toLocaleString()} cards moved to new categories, ${tagged.toLocaleString()} tags added${c.review?.length ? `, ${c.review.length} similar pairs tagged needs-review::similar` : ""}${edited ? `, ${edited.toLocaleString()} cards improved` : ""}${suspended ? `, ${suspended} cards suspended` : ""}.${packMsgs.length ? " " + packMsgs.join(" ") : ""}`;
  }

  // ---- hooks (personal notes on cards) --------------------------------------
  hooks: Record<string, { t: string; m: number }> = {};
  hookFor(nid: string): string { return this.hooks[nid]?.t ?? ""; }
  async setHook(nid: string, text: string) {
    const t = text.trim();
    if (!t && !this.hooks[nid]) return;
    this.hooks = { ...this.hooks, [nid]: { t, m: stamp() } }; // an empty text is kept as a tombstone so the deletion syncs
    await this.persist("saving your note", db.setMeta("hooks", this.hooks));
    this.bump(); this.touch();
  }

  // ---- "needs improving": cards the user wants Claude to rewrite or split ----------
  improve: Record<string, ImproveMark> = {};
  static IMPROVE_REASONS: Record<string, string> = { split: "Too much on one card — split it", unclear: "Unclear question or answer", wrong: "Wrong or outdated", format: "Messy formatting", media: "Picture/sound problem", confusion: "I mix it up with something similar", other: "Something else" };
  improveFor(nid: string): ImproveMark | null { const m = this.improve[nid]; return m && m.r.length ? m : null; }
  /** Notes marked for improving (plus leeches marked "mixed up with something similar"), newest first. */
  improveList(): { note: Note; mark: ImproveMark }[] {
    const out: { note: Note; mark: ImproveMark }[] = []; const seen = new Set<string>();
    for (const [nid, m] of Object.entries(this.improve)) { const n = this.notes.get(nid); if (n && m.r.length) { out.push({ note: n, mark: m }); seen.add(nid); } }
    for (const n of this.notes.values()) if (!seen.has(n.id) && n.tags.includes("ask-claude")) out.push({ note: n, mark: { r: ["confusion"], t: "", m: n.modified } });
    return out.sort((a, b) => b.mark.m - a.mark.m);
  }
  async markImprove(nids: string[], reasons: string[], text = "") {
    const now = stamp(); const next = { ...this.improve };
    for (const nid of nids) next[nid] = { r: reasons, t: text.trim(), m: now }; // empty reasons = cleared (kept so the clearing syncs)
    this.improve = next; await this.persist("saving the mark", db.setMeta("improve", next)); this.bump(); this.touch();
  }
  /** Clear marks (and the leech "ask-claude" tag) for notes Claude has dealt with. */
  async clearImprove(nids: string[]) {
    const now = stamp(); const next = { ...this.improve }; let n = 0;
    for (const nid of nids) { if (next[nid]?.r.length) { next[nid] = { r: [], t: "", m: now }; n++; } const note = this.notes.get(nid); if (note?.tags.includes("ask-claude")) { const m = { ...note, tags: note.tags.filter((t) => t !== "ask-claude"), modified: now }; this.notes.set(nid, m); await db.putOne("notes", m); n++; } }
    this.improve = next; await this.persist("saving", db.setMeta("improve", next)); this.bump(); this.touch(); return n;
  }
  /** Everything Claude needs to rewrite or split the marked cards: full field HTML (picture/sound tags in place), note type, deck, reasons. */
  improveExport() {
    const list = this.improveList(); const byNote = this.cardsByNote(); const dmy = ((d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`)(new Date());
    return {
      yuzu_improve: 1, exported: dmy, count: list.length,
      for_claude: "Improve these flashcards and send back ONE Yuzu curation file (JSON): {\"yuzu_curation\":1, \"name\":\"…\", \"edits\":[{\"id\":noteId, \"fields\":{\"0\":html,…}}], \"packs\":[{\"yuzu_pack\":1, \"id\":\"improve-<date>\", \"name\":\"…\", \"cards\":[{\"id\", \"type\":\"cloze\"|\"basic\", \"text\"|\"front\"/\"back\", \"extra\", \"category\":deck}]}], \"suspend\":[noteIds], \"resolved\":[noteIds]}. Rules: an edit keeps the note's review history, so for cloze notes keep exactly the same cloze numbers; keep every <img> and [sound:] tag (same file names) and put each with the fact it illustrates — when splitting, move a picture onto the new card it belongs to (new pack cards may use <img src=\"same-name.jpg\">); one fact per card; context first; check doses and guidelines against current sources; list every handled note id in resolved.",
      reasons: Store.IMPROVE_REASONS,
      cards: list.map(({ note, mark }) => { const nt = this.notetypes.get(note.ntid); const cs = byNote.get(note.id) ?? []; return {
        id: note.id, deck: cs[0]?.source ?? "", notetype: nt?.name ?? "", kind: nt?.kind ?? "standard", fieldNames: nt?.fields.map((f: any) => (typeof f === "string" ? f : f.name)) ?? [], fields: note.fields,
        tags: note.tags.filter((t) => !t.startsWith("auto::")), reasons: mark.r, yourNote: mark.t, cards: cs.length, reviews: cs.reduce((a, c) => a + c.reps, 0), lapses: cs.reduce((a, c) => a + c.lapses, 0),
      }; }),
    };
  }

  // ---- inbox ---------------------------------------------------------------
  inbox: { file: string; sha: string; at: number; pack: any }[] = [];
  packLog: { id: string; name: string; at: number; noteIds: string[] }[] = [];
  private async checkInbox(gh: GitHubSync) {
    let files: { name: string; sha: string; size: number }[] = [];
    try { files = await gh.listInbox(); } catch { return; }
    const seen = new Set(await db.getMeta<string[]>("inboxSeen", []));
    let changed = false;
    for (const f of files) {
      if (seen.has(f.sha) || this.inbox.some((x) => x.sha === f.sha)) continue;
      try { const t = await gh.readInbox(f.name); if (!t) continue; const pack = JSON.parse(t); if (pack?.yuzu_pack === 1 || pack?.yuzu_curation === 1) { this.inbox.push({ file: f.name, sha: f.sha, at: Date.now(), pack }); changed = true; } seen.add(f.sha); }
      catch { /* skip unreadable file */ }
    }
    // Files removed from the repo (handled on another device) leave the local inbox too.
    const remote = new Set(files.map((f) => f.sha)); const before = this.inbox.length;
    this.inbox = this.inbox.filter((x) => remote.has(x.sha)); if (this.inbox.length !== before) changed = true;
    if (changed) { await db.setMeta("inbox", this.inbox); await db.setMeta("inboxSeen", [...seen]); this.bump(); }
  }
  /** Add the chosen cards of an inbox pack, remember them for undo, and clear the file from the repo. */
  async acceptInbox(sha: string, keepIndexes: number[] | "all"): Promise<string> {
    const e = this.inbox.find((x) => x.sha === sha); if (!e) return "Not found";
    let msg: string;
    if (e.pack.yuzu_curation === 1) msg = await this.importCuration(e.pack);
    else {
      const cards = keepIndexes === "all" ? e.pack.cards : e.pack.cards.filter((_: unknown, i: number) => keepIndexes.includes(i));
      const before = new Set(this.notes.keys());
      msg = await this.importPack({ ...e.pack, cards });
      const noteIds = [...this.notes.keys()].filter((id) => !before.has(id));
      this.packLog = [{ id: e.pack.id ?? e.file, name: e.pack.name ?? e.file, at: Date.now(), noteIds }, ...this.packLog].slice(0, 50);
      await db.setMeta("packLog", this.packLog);
    }
    await this.dismissInbox(sha);
    return msg;
  }
  async dismissInbox(sha: string) {
    const e = this.inbox.find((x) => x.sha === sha); if (!e) return;
    this.inbox = this.inbox.filter((x) => x.sha !== sha); await db.setMeta("inbox", this.inbox); this.bump();
    if (this.syncConfigured()) { const cfg = this.settings.sync; await new GitHubSync({ owner: cfg.owner, repo: cfg.repo, token: cfg.token }).deleteInbox(e.file, e.sha).catch(() => {}); }
  }
  /** Delete notes with all their cards (synced; later Anki imports don't bring them back). Returns the last deletion for undo. */
  lastDeleted: { notes: Note[]; cards: Card[] } | null = null;
  /** note id → its cards, built once (cardsOfNote scans all cards; fine for one note, not for thousands). */
  private cardsByNote(): Map<string, Card[]> { const m = new Map<string, Card[]>(); for (const c of this.cards.values()) (m.get(c.nid) ?? m.set(c.nid, []).get(c.nid)!).push(c); return m; }
  /** Forget review-undo entries for cards that no longer exist (↶ must never resurrect a deleted card). */
  private dropUndo(cardIds: Set<string>) { if (this.undoStack.some((u) => cardIds.has(u.card.id))) { this.undoStack = this.undoStack.filter((u) => !cardIds.has(u.card.id)); db.setMeta("undoStack", this.undoStack).catch(() => {}); } }
  async deleteNotes(nids: string[]) {
    const now = stamp(); const notes: Note[] = [], cards: Card[] = []; const byNote = this.cardsByNote();
    for (const nid of new Set(nids)) { const n = this.notes.get(nid); if (!n) continue; notes.push(n); this.notes.delete(nid); this.tombstones["n:" + nid] = now; for (const c of byNote.get(nid) ?? []) { cards.push(c); this.cards.delete(c.id); } }
    if (!notes.length) return 0;
    this.dropUndo(new Set(cards.map((c) => c.id)));
    this.lastDeleted = { notes, cards };
    await this.persist("deleting", (async () => { await db.deleteMany("notes", notes.map((n) => n.id)); await db.deleteMany("cards", cards.map((c) => c.id)); await db.setMeta("tombstones", this.tombstones); })());
    this.treeCache.clear(); this.bump(); this.touch(); return notes.length;
  }
  async undoDelete() {
    const d = this.lastDeleted; if (!d) return 0; this.lastDeleted = null; const now = stamp();
    const notes = d.notes.map((n) => ({ ...n, modified: now })), cards = d.cards.map((c) => ({ ...c, mod: now }));
    for (const n of notes) { this.notes.set(n.id, n); delete this.tombstones["n:" + n.id]; } for (const c of cards) { this.cards.set(c.id, c); delete this.tombstones["c:" + c.id]; }
    await this.persist("restoring", (async () => { await db.putMany("notes", notes); await db.putMany("cards", cards); await db.setMeta("tombstones", this.tombstones); })());
    this.treeCache.clear(); this.bump(); this.touch(); return notes.length;
  }
  // ---- Mastery: retire cards whose next review is years away ----------------------------------------
  mastery: { log: MasteredEntry[]; kept: Record<string, number> } = { log: [], kept: {} };
  private get askDays() { return (this.settings.retireAskYears ?? 5) * 365.25; }
  private get autoDays() { const y = this.settings.retireAutoYears ?? 20; return y > 0 ? y * 365.25 : Infinity; }
  /** Days from the last review to the next one (0 for cards not in review). */
  intervalDays(c: Card) { return c.state === "review" && c.lastReview ? (c.due - c.lastReview) / 86400000 : 0; }
  /** Cards whose next review is beyond the "offer" line (and under the automatic line), not kept, not paused. */
  masteryCandidates(): Card[] {
    const out: Card[] = [];
    for (const c of this.cards.values()) { const d = this.intervalDays(c); if (d > this.askDays && d <= this.autoDays && !c.suspended && !this.mastery.kept[c.id]) out.push(c); }
    return out.sort((a, b) => this.intervalDays(b) - this.intervalDays(a));
  }
  /** What a card asks and answers, as plain text (cloze: this card's gap shown as […], the answer separately). */
  cardText(c: Card): { front: string; back: string } {
    const n = this.notes.get(c.nid); if (!n) return { front: "", back: "" };
    const plain = (h: string) => h.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>|<\/(div|p|li)>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\[sound:[^\]]+\]/g, "").replace(/\s+/g, " ").trim();
    const all = n.fields.join(" ");
    if (/\{\{c\d+::/.test(all)) {
      const k = c.ord + 1; const answers: string[] = []; const txt = n.fields.find((f) => new RegExp(`\\{\\{c${k}::`).test(f)) ?? n.fields[0];
      const front = txt.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_m, num, ans, hint) => { if (+num === k) { answers.push(ans); return hint ? `[${hint}]` : "[…]"; } return ans; });
      return { front: plain(front).slice(0, 400), back: plain(answers.join(" · ")).slice(0, 300) };
    }
    return { front: plain(n.fields[0] ?? "").slice(0, 400), back: plain(n.fields[1] ?? "").slice(0, 300) };
  }
  /** Retire cards as mastered: log what they were, then delete them (the note goes when its last card goes). Synced. */
  async masterCards(ids: string[], by: "auto" | "you") {
    const now = stamp(); const entries: MasteredEntry[] = []; const delCards: string[] = [], delNotes: string[] = [];
    const want = new Set(ids); const firstSeen = new Map<string, number>();
    for (const r of this.reviews) if (want.has(r.cid) && !firstSeen.has(r.cid)) firstSeen.set(r.cid, r.ts);
    const left = new Map<string, number>(); for (const c of this.cards.values()) left.set(c.nid, (left.get(c.nid) ?? 0) + 1);
    for (const id of ids) {
      const c = this.cards.get(id); if (!c) continue; const n = this.notes.get(c.nid); const t = this.cardText(c);
      const first = firstSeen.get(id) ?? 0;
      entries.push({ id, nid: c.nid, deck: c.source, front: t.front, back: t.back, tags: (n?.tags ?? []).filter((x) => !x.startsWith("auto::")).slice(0, 12), reps: c.reps, lapses: c.lapses, firstReview: first, lastReview: c.lastReview, intervalDays: Math.round(this.intervalDays(c)), at: now, by });
      this.cards.delete(id); this.tombstones["c:" + id] = now; delCards.push(id); left.set(c.nid, (left.get(c.nid) ?? 1) - 1);
      if (n && (left.get(n.id) ?? 0) <= 0) { this.notes.delete(n.id); this.tombstones["n:" + n.id] = now; delNotes.push(n.id); }
    }
    if (!entries.length) return 0;
    this.dropUndo(new Set(delCards));
    this.mastery = { ...this.mastery, log: [...this.mastery.log, ...entries] };
    await this.persist("retiring mastered cards", (async () => { await db.deleteMany("cards", delCards); if (delNotes.length) await db.deleteMany("notes", delNotes); await db.setMeta("tombstones", this.tombstones); await db.setMeta("mastery", this.mastery); })());
    this.treeCache.clear(); this.bump(); this.touch();
    this.pruneMedia().catch(() => {}); // free the pictures and sounds only these cards used
    return entries.length;
  }
  /** How many cards automatic retirement would take at `years` (for the confirmation before changing the setting). */
  countBeyond(years: number) { const d = years * 365.25; let n = 0; for (const c of this.cards.values()) if (this.intervalDays(c) > d && !c.suspended && !this.mastery.kept[c.id]) n++; return n; }
  /** "Keep studying these": they leave the list for good. */
  async keepCards(ids: string[]) { const kept = { ...this.mastery.kept }; const now = stamp(); for (const id of ids) kept[id] = now; this.mastery = { ...this.mastery, kept }; await this.persist("saving", db.setMeta("mastery", this.mastery)); this.bump(); this.touch(); }
  /** Cards past 20 years retire on their own (run at start and after a sync, never mid-session so ↶ still works). */
  async autoMaster() { const recent = Date.now() - 3600000; const ids = [...this.cards.values()].filter((c) => this.intervalDays(c) > this.autoDays && c.lastReview < recent && !c.suspended && !this.mastery.kept[c.id]).map((c) => c.id); return ids.length ? this.masterCards(ids, "auto") : 0; }
  /** Remove every note a pack added (cards and history go with them). */
  async removePack(id: string) {
    const e = this.packLog.find((x) => x.id === id); if (!e) return 0;
    const now = stamp(); const dc: string[] = []; const byNote = this.cardsByNote();
    for (const nid of e.noteIds) { if (!this.notes.has(nid)) continue; this.notes.delete(nid); this.tombstones["n:" + nid] = now; for (const c of byNote.get(nid) ?? []) { this.cards.delete(c.id); dc.push(c.id); } }
    this.dropUndo(new Set(dc));
    this.packLog = this.packLog.filter((x) => x.id !== id);
    await this.persist("removing the pack", (async () => { await db.deleteMany("notes", e.noteIds); await db.deleteMany("cards", dc); await db.setMeta("tombstones", this.tombstones); await db.setMeta("packLog", this.packLog); })());
    this.bump(); this.touch();
    return e.noteIds.length;
  }

  // ---- media ---------------------------------------------------------------
  /** Field filter for hidden fields (per note type, by field name). */
  skipHidden(): ((n: Note, i: number) => boolean) | undefined {
    const names = new Set(this.settings.hiddenFields.map((x) => x.trim().toLowerCase())); if (!names.size) return undefined;
    const idx = new Map<string, Set<number>>();
    for (const nt of this.notetypes.values()) { const set = new Set<number>(); nt.fields.forEach((f, i) => { if (names.has(f.trim().toLowerCase())) set.add(i); }); if (set.size) idx.set(nt.id, set); }
    return (n, i) => idx.get(n.ntid)?.has(i) ?? false;
  }
  /** Delete stored media no visible card uses (e.g. after hiding Sketchy). Pack images and template files stay. */
  async pruneMedia(): Promise<{ files: number; bytes: number }> {
    const refs = this.mediaRefs(); const del: string[] = []; let bytes = 0;
    for (const [name, blob] of this.media) if (!refs.has(name) && !name.startsWith("pack-") && !name.startsWith("_")) { del.push(name); bytes += blob.size; }
    for (const n of del) this.media.delete(n);
    if (del.length) { await db.deleteMany("media", del); this.mediaUrls.clear(); this.bump(); }
    return { files: del.length, bytes };
  }
  /** Media the cards reference vs what this device holds. */
  private refsCache: { key: string; refs: Set<string> } | null = null;
  /** Fingerprint of everything media references depend on: every note's edit time, the note types, the hidden fields. Cheap (no regexes). */
  refsKey(): string {
    let sig = 0; for (const n of this.notes.values()) sig = (sig + n.modified + n.fields.length) % 1e15;
    let ntSig = 0; for (const nt of this.notetypes.values()) ntSig += nt.css.length + nt.templates.length;
    return `${this.notes.size}:${sig}:${this.notetypes.size}:${ntSig}:${this.settings.hiddenFields.join("|")}`;
  }
  private savedRefs: { key: string; names: string[] } | null = null; // the last scan, kept in the database across launches
  mediaRefs(): Set<string> {
    // Re-scan only when card text can have changed (a review or flag changes no fields). The result is also kept in the
    // database, so a fresh launch — Android often restarts the app in the background — doesn't re-scan 100k notes.
    const key = this.refsKey();
    if (this.refsCache?.key === key) return this.refsCache.refs;
    if (this.savedRefs?.key === key) { this.refsCache = { key, refs: new Set(this.savedRefs.names) }; return this.refsCache.refs; }
    this.refsCache = { key, refs: mediaRefs(this.notes.values(), this.notetypes.values(), this.skipHidden()) };
    const names = [...this.refsCache.refs]; this.savedRefs = { key, names }; db.setMeta("mediaRefs", { key, names }).catch(() => {});
    return this.refsCache.refs;
  }
  mediaStatus(): { total: number; stored: number; bytes: number; images: { total: number; stored: number }; sounds: { total: number; stored: number }; missing: string[] } {
    let bytes = 0; for (const b of this.media.values()) bytes += b.size;
    const images = { total: 0, stored: 0 }, sounds = { total: 0, stored: 0 }; let total = 0, stored = 0; const missing: string[] = [];
    for (const r of this.mediaRefs()) {
      const has = this.media.has(r); total++; if (has) stored++; else if (missing.length < 200) missing.push(r);
      const k = IMG.test(r) ? images : AUDIO.test(r) ? sounds : null; if (k) { k.total++; if (has) k.stored++; }
    }
    return { total, stored, bytes, images, sounds, missing };
  }
  /** Remember Anki's media folder (PC). From then on every sync sends the other devices what they are missing. */
  async linkAnkiFolder(handle: any) { this.ankiDir = handle; this.ankiList = null; await db.setMeta("ankiDir", handle); this.ankiDirName = handle?.name ?? ""; this.ankiDirAccess = handle ? "granted" : "none"; this.bump(); if (handle) this.scheduleSync(1000); }
  async unlinkAnkiFolder() { await this.linkAnkiFolder(null); }
  /** After a browser restart Chrome may ask again; this must run from a tap. */
  async allowAnkiFolder() { const h = this.ankiDir ?? (await db.getMeta<any>("ankiDir", null)); if (!h) return false; const p = await h.requestPermission?.({ mode: "read" }); this.ankiDir = h; this.ankiDirAccess = p === "granted" ? "granted" : "prompt"; this.bump(); if (p === "granted") this.scheduleSync(1000); return p === "granted"; }
  async loadAnkiFolderState() { await this.deviceId(); if (this.ankiDir === undefined) { this.ankiDir = await db.getMeta<any>("ankiDir", null); this.mediaWants = await db.getMeta<Record<string, MediaWant>>("mediaWants", {}); } const h = this.ankiDir; this.ankiDirName = h?.name ?? ""; if (!h) { this.ankiDirAccess = "none"; return; } try { this.ankiDirAccess = (await h.queryPermission?.({ mode: "read" })) === "granted" ? "granted" : "prompt"; } catch { this.ankiDirAccess = "prompt"; } }
  private async ankiFolder(): Promise<any | null> { await this.loadAnkiFolderState(); return this.ankiDirAccess === "granted" ? this.ankiDir : null; }
  /** Other devices' missing media, as the sender sees it. */
  otherWants(): MediaWant[] { const me = this.myId; return Object.entries(this.mediaWants).filter(([k]) => k !== me).map(([, w]) => w); }
  private myId = "";
  /** A random id for this browser (kept in its database), so devices with the same or no name never mix up. */
  async deviceId(): Promise<string> { if (this.myId) return this.myId; let id = await db.getMeta<string>("deviceId", ""); if (!id) { id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); await db.setMeta("deviceId", id); } this.myId = id; return id; }
  private async ankiFile(dir: any, name: string): Promise<File | null> {
    try { return await (await dir.getFileHandle(name)).getFile(); } catch { /* not under that exact name */ }
    if (!this.ankiList) { const m = new Map<string, string>(); for await (const [n, h] of dir.entries()) if (h.kind === "file") m.set(n, n); this.ankiList = forgiving(m); }
    const real = this.ankiList(name); if (!real) return null;
    try { return await (await dir.getFileHandle(real)).getFile(); } catch { return null; }
  }
  /** Read what the other devices lack from Anki's folder, shrink pictures, and queue them for this sync (bounded per sync). */
  private async sendWanted(dir: any | null, wants: Record<string, MediaWant>, me: string, index: MediaIndex, out: { path: string; bytes: Uint8Array }[], progress: (m: string) => void): Promise<{ index: MediaIndex; left: number }> {
    const need = new Set<string>(); let biggest: MediaWant | null = null;
    for (const [k, w] of Object.entries(wants)) { if (k === me) continue; if (w.total > 4000) { if (!biggest || w.total > biggest.total) biggest = w; continue; } for (const n of w.missing) if (!index[n] && (dir || this.media.has(n))) need.add(n); }
    this.sendNote = biggest ? `${biggest.device} is missing ${biggest.total.toLocaleString()} files — too many for sync. ${dir ? "Make a phone media file once (above)" : "Press “Save media file” here and choose it there once"}; after that new media goes automatically.` : "";
    let budget = MEDIA_BATCH_BYTES - out.reduce((a, b) => a + b.bytes.length, 0); let sent = 0, notFound = 0; const list = [...need];
    for (const name of list) {
      if (budget <= 0) break;
      let blob: Blob;
      const own = this.media.get(name);
      if (own) { blob = own; } // already phone-sized: send as stored
      else {
        const f = dir ? await this.ankiFile(dir, name) : null; if (!f) { notFound++; if (dir) index = { ...index, [name]: { p: "", s: 0 } }; continue; } // not in Anki either: don't ask again
        if (f.size > 20 * 1048576) { notFound++; index = { ...index, [name]: { p: "", s: 0 } }; continue; } // too big for sync
        try { const bytes = new Uint8Array(await f.arrayBuffer()); blob = IMG.test(name) ? await shrinkImage(bytes, name) : new Blob([bytes as BlobPart], { type: mimeFor(name) }); }
        catch { notFound++; continue; }
      }
      if (blob.size > 20 * 1048576) { notFound++; continue; }
      const ext = blob.type === "image/webp" ? "webp" : (name.split(".").pop() || "bin").toLowerCase();
      let data: Uint8Array; try { data = new Uint8Array(await blob.arrayBuffer()); } catch { notFound++; continue; }
      const path = `media/${hashName(name)}.${ext}`;
      out.push({ path, bytes: data }); index = { ...index, [name]: { p: path, s: data.length } }; budget -= data.length; sent++;
      if (sent % 10 === 0) progress(`Sending media to your other devices · ${sent}`);
    }
    const left = list.length - sent - notFound;
    if (sent) this.log(true, `Sent ${sent} new media file${sent === 1 ? "" : "s"} to your other devices${left > 0 ? ` (${left} more next sync)` : ""}`, 0);
    return { index, left: sent ? Math.max(0, left) : 0 }; // only keep going while something is moving
  }
  /** Every file the cards use that isn't on this device, with where it is used (for the missing list / CSV). */
  missingMedia(): { name: string; kind: "image" | "sound" | "other"; notes: number; deck: string; example: string; noteId: string }[] {
    const have = (n: string) => this.media.has(n); const out = new Map<string, { name: string; kind: "image" | "sound" | "other"; notes: number; deck: string; example: string; noteId: string }>();
    const deckOf = new Map<string, string>(); for (const c of this.cards.values()) if (!deckOf.has(c.nid)) deckOf.set(c.nid, c.source);
    const skip = this.skipHidden(); const kind = (n: string) => (IMG.test(n) ? "image" : AUDIO.test(n) ? "sound" : "other") as "image" | "sound" | "other";
    const text = (h: string) => h.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
    for (const n of this.notes.values()) for (const r of mediaRefs([n], [], skip)) {
      if (have(r)) continue; const m = out.get(r);
      if (m) m.notes++; else out.set(r, { name: r, kind: kind(r), notes: 1, deck: deckOf.get(n.id) ?? "", example: text(n.fields.find((f) => text(f)) ?? ""), noteId: n.id });
    }
    for (const nt of this.notetypes.values()) for (const r of mediaRefs([], [nt])) if (!have(r) && !out.has(r)) out.set(r, { name: r, kind: kind(r), notes: 0, deck: `Note type “${nt.name}” (template file)`, example: "", noteId: "" });
    return [...out.values()].sort((a, b) => a.deck.localeCompare(b.deck) || a.name.localeCompare(b.name));
  }
  /** Add media from an Anki export with media, a Yuzu media file, or files picked from Anki's media folder. Stopping keeps what is stored; running it again resumes. */
  async addMediaFrom(input: Blob | File[] | FolderHandles, env: MediaEnv) {
    // A file counts only once the database has it and it reads back in full; until then it is not in
    // `this.media`, so nothing exists only in memory. If the browser refuses to save, the import stops
    // with the browser's own reason instead of carrying on.
    const batch: { name: string; blob: Blob }[] = []; const pending = new Set<string>(); let unreadable = 0;
    const flush = async () => {
      if (!batch.length) return; const items = batch.splice(0);
      try { await db.putMany("media", items); }
      catch (e: any) {
        for (const { name } of items) pending.delete(name);
        const why = `${e?.name ?? "Error"}${e?.message ? ": " + e.message : ""}`;
        db.setMeta("lastError", { at: Date.now(), where: "save media", message: why }).catch(() => {});
        throw Object.assign(new Error(`The browser refused to save more media (${why}). What was saved before this is kept.`), { fatal: true, cause: e });
      }
      for (const { name } of items) {
        pending.delete(name);
        try { const row = await db.getOne<{ name: string; blob: Blob }>("media", name); if (row?.blob) { await row.blob.arrayBuffer(); this.media.set(name, row.blob); continue; } } catch { /* not readable */ }
        unreadable++; try { await db.deleteMany("media", [name]); } catch { /* best effort */ }
      }
    };
    try { await navigator.storage?.persist?.(); } catch { /* best effort: keeps the browser from evicting a big library */ }
    try {
      const r = await importMedia(input, this.notes.values(), (n) => this.media.has(n) || pending.has(n), async (name, blob) => { pending.add(name); batch.push({ name, blob }); if (batch.length >= 40) await flush(); }, env, { notetypes: this.notetypes.values(), skipField: this.skipHidden() });
      await flush();
      const kept = r.stored - unreadable; r.failed += unreadable; r.stored = kept; return r;
    } finally { this.mediaUrls.clear(); this.bump(); }
  }
  /**
   * PC: make the phone's media file straight from Anki's media folder — pictures are shrunk and written into
   * the file on disk, nothing is stored in this browser. Parts of up to 1.8 GB go into `dest`.
   */
  async mediaFileFromFolder(src: FolderHandles, dest: any, env: MediaEnv) {
    const stampDate = ((d) => `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`)(new Date());
    const mark = new TextEncoder().encode(JSON.stringify({ yuzu_media: 1, at: Date.now() }));
    const open = async (n: number) => { const name = `yuzu-media-${stampDate}-${n}.zip`; const fh = await dest.getFileHandle(name, { create: true }); const w = await fh.createWritable(); return { name, write: (c: Uint8Array) => w.write(c), close: () => w.close(), abort: () => w.abort() }; };
    const zip = new ZipParts(open, { name: YUZU_MEDIA_MARK, data: mark });
    let r; try { r = await importMedia(src, this.notes.values(), () => false, async (name, blob) => { await zip.add("m/" + name, new Uint8Array(await blob.arrayBuffer())); }, env, { notetypes: this.notetypes.values(), skipField: this.skipHidden() }); }
    catch (e) { await zip.abort(); throw e; } // the finished parts stay; the half-written one is discarded
    const parts = await zip.finish();
    return { ...r, parts };
  }
  /** Read every stored file once, in full, and report the ones the browser can no longer read. Deletes nothing. */
  async checkMedia(onProgress?: (msg: string) => void): Promise<{ checked: number; unreadable: string[]; errors: Record<string, number> }> {
    const unreadable: string[] = []; const errors: Record<string, number> = {}; let checked = 0; const names = [...this.media.keys()];
    for (const name of names) {
      try { await this.media.get(name)!.arrayBuffer(); }
      catch {
        try { const row = await db.getOne<{ name: string; blob: Blob }>("media", name); if (!row?.blob) throw new Error("NotInDatabase"); await row.blob.arrayBuffer(); this.media.set(name, row.blob); }
        catch (e: any) { unreadable.push(name); const k = e?.name || e?.message || "Error"; errors[k] = (errors[k] ?? 0) + 1; }
      }
      if (++checked % 500 === 0) onProgress?.(`Checked ${checked.toLocaleString()} of ${names.length.toLocaleString()}${unreadable.length ? ` · ${unreadable.length.toLocaleString()} unreadable` : ""}`);
    }
    return { checked, unreadable, errors };
  }
  /** Forget only the given files (after a check) so "Choose media folder" adds them again. */
  async dropMedia(names: string[]) { for (const n of names) this.media.delete(n); await db.deleteMany("media", names); this.mediaUrls.clear(); this.bump(); return names.length; }
  /** This device's media (already shrunk) as one or more Yuzu media files, to carry to another device. */
  /**
   * Pack this device's media into Yuzu media files (split at 1.8 GB / 60k files).
   * With `dir` (a folder picked on a PC) each part is streamed straight to disk; otherwise Blobs are returned
   * for download. A file that can't be read is re-read from the database and skipped if that fails too.
   */
  async exportMedia(onProgress?: (msg: string) => void, dir?: any): Promise<{ files: { name: string; blob?: Blob; size: number }[]; skipped: string[] }> {
    const refs = this.mediaRefs();
    const all = [...this.media].filter(([n]) => refs.has(n) || n.startsWith("pack-"));
    const out: { name: string; blob?: Blob; size: number }[] = []; const skipped: string[] = []; const PART = 1800 * 1048576, MAX = 60000;
    const groups: [string, Blob][][] = []; let group: [string, Blob][] = [], size = 0;
    for (const [n, b] of all) { if (group.length && (size + b.size > PART || group.length >= MAX)) { groups.push(group); group = []; size = 0; } group.push([n, b]); size += b.size; }
    if (group.length) groups.push(group);
    const stampDate = ((d) => `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`)(new Date());
    const reread = async (zipName: string) => {
      const name = zipName.slice(2); const row = await db.getOne<{ name: string; blob: Blob }>("media", name);
      if (row?.blob) this.media.set(name, row.blob);
      return row?.blob;
    };
    let done = 0;
    for (let g = 0; g < groups.length; g++) {
      const grp = groups[g]; const name = `yuzu-media-${stampDate}${groups.length > 1 ? "-" + (g + 1) : ""}.zip`;
      const mark = new TextEncoder().encode(JSON.stringify({ yuzu_media: 1, files: grp.length, at: Date.now() }));
      const files = [{ name: YUZU_MEDIA_MARK, data: mark }, ...grp.map(([n, b]) => ({ name: "m/" + n, data: b }))];
      const opts = { reread, skipped, onFile: () => { if (++done % 200 === 0) onProgress?.(`Packing ${done.toLocaleString()} of ${(all.length + groups.length).toLocaleString()} files${groups.length > 1 ? ` · part ${g + 1} of ${groups.length}` : ""}`); } };
      if (dir) {
        const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable();
        let bytes = 0; const sink = { write: async (c: Uint8Array | Blob) => { bytes += c instanceof Blob ? c.size : c.length; await w.write(c); } };
        let n = 0;
        try { n = await streamZip(files, sink, opts); await w.close(); } catch (e) { try { await w.abort(); } catch { /* already closed */ } throw e; }
        if (n <= 1) { try { await dir.removeEntry(name); } catch { /* leave it */ } continue; } // nothing readable in this part
        out.push({ name, size: bytes });
      } else {
        const before = skipped.length; const blob = await writeZip(files, opts);
        if (skipped.length - before < grp.length) out.push({ name, blob, size: blob.size }); // skip a part with nothing readable
      }
    }
    // Nothing is deleted here: a file that can't be read is only left out of the media file and reported.
    return { files: out, skipped };
  }
  async clearMedia(keepPacks = true) {
    const del: string[] = []; for (const name of this.media.keys()) if (!(keepPacks && name.startsWith("pack-"))) { del.push(name); this.media.delete(name); }
    await db.deleteMany("media", del); this.mediaUrls.clear(); this.bump(); return del.length;
  }
  /** Small images from packs, as data URLs, for sync (cached per name). */
  private packMediaCache = new Map<string, string>();
  async packMedia(): Promise<Record<string, string>> {
    const out: Record<string, string> = {}; let total = 0;
    for (const [name, blob] of this.media) {
      if (!name.startsWith("pack-")) continue;
      let u = this.packMediaCache.get(name);
      if (!u) { u = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); }); this.packMediaCache.set(name, u); }
      total += u.length; if (total > 25 * 1048576) break;
      out[name] = u;
    }
    return out;
  }

  // ---- duplicates --------------------------------------------------------
  dismissedPairs = new Set<string>();
  mergeLog: { at: number; keep: string; dropped: Note[]; cards: Card[]; keepBefore: Note; keepCardsBefore: Card[] }[] = [];
  cardsOfNote(nid: string): Card[] { const out: Card[] = []; for (const c of this.cards.values()) if (c.nid === nid) out.push(c); return out; }
  similarPairs() { return similarPairs(this.notes.values(), this.dismissedPairs); }
  /** Merge note `drop` into `keep` (tags united, stronger scheduling kept); the dropped note can be restored from the merge log. */
  async mergeNotes(keepId: string, dropId: string) {
    const keep = this.notes.get(keepId), drop = this.notes.get(dropId); if (!keep || !drop || keepId === dropId) return;
    const now = stamp(); const keepCards = this.cardsOfNote(keepId), dropCards = this.cardsOfNote(dropId);
    const m = mergeInto(keep, keepCards, drop, dropCards, now);
    this.notes.set(keepId, m.note); for (const c of m.cards) this.cards.set(c.id, c);
    this.notes.delete(dropId); for (const c of dropCards) this.cards.delete(c.id);
    this.tombstones["n:" + dropId] = now;
    this.mergeLog = [{ at: now, keep: keepId, dropped: [drop], cards: dropCards, keepBefore: keep, keepCardsBefore: keepCards }, ...this.mergeLog].slice(0, 200);
    await this.persist("merging the cards", (async () => {
      await db.putOne("notes", m.note); await db.putMany("cards", m.cards); await db.deleteMany("notes", [dropId]); await db.deleteMany("cards", dropCards.map((c) => c.id));
      await db.setMeta("tombstones", this.tombstones); await db.setMeta("mergeLog2", this.mergeLog);
    })());
    this.bump(); this.touch();
  }
  /** Keep both notes: drop the review tag and remember the pair so it is not offered again. */
  async keepBoth(a: string, b: string) {
    const now = stamp(); const out: Note[] = [];
    for (const id of [a, b]) { const n = this.notes.get(id); if (n && n.tags.includes(SIMILAR_TAG)) { const m = { ...n, tags: n.tags.filter((t) => t !== SIMILAR_TAG), modified: now }; this.notes.set(id, m); out.push(m); } }
    this.dismissedPairs.add([a, b].sort().join("|"));
    await this.persist("updating the cards", (async () => { await db.putMany("notes", out); await db.setMeta("dismissedPairs", [...this.dismissedPairs]); })());
    this.bump(); this.touch();
  }
  async undoMerge(at: number) {
    const e = this.mergeLog.find((x) => x.at === at); if (!e) return;
    const now = stamp();
    this.notes.set(e.keep, { ...e.keepBefore, modified: now }); for (const c of e.keepCardsBefore) this.cards.set(c.id, { ...c, mod: now });
    for (const n of e.dropped) { this.notes.set(n.id, { ...n, modified: now }); delete this.tombstones["n:" + n.id]; }
    for (const c of e.cards) this.cards.set(c.id, { ...c, mod: now });
    this.mergeLog = this.mergeLog.filter((x) => x.at !== at);
    await this.persist("undoing the merge", (async () => {
      await db.putMany("notes", [this.notes.get(e.keep)!, ...e.dropped.map((n) => this.notes.get(n.id)!)]);
      await db.putMany("cards", [...e.keepCardsBefore, ...e.cards].map((c) => this.cards.get(c.id)!));
      await db.setMeta("tombstones", this.tombstones); await db.setMeta("mergeLog2", this.mergeLog);
    })());
    this.bump(); this.touch();
  }

  async wipe() {
    await db.clearAll();
    this.notetypes.clear(); this.notes.clear(); this.cards.clear(); this.reviews = []; this.media.clear();
    this.bump();
  }

  // ---- derived -------------------------------------------------------------

  dayStart(now = Date.now()): number {
    const d = new Date(now);
    d.setHours(this.settings.rollover, 0, 0, 0);
    if (d.getTime() > now) d.setDate(d.getDate() - 1);
    return d.getTime();
  }

  /** Category tree for a view. Counts are per card; a card in two categories is counted in both. */
  tree(view: View = "decks"): TreeNode {
    const cached = this.treeCache.get(view);
    if (cached && cached.v === this.version) return cached.tree;
    const root: TreeNode = { name: "All", path: "", children: [], total: 0, due: 0, newCount: 0, learning: 0, suspended: 0, reviewed: 0 };
    const now = stamp();
    const index = new Map<string, TreeNode>();
    index.set("", root);
    const getNode = (path: string): TreeNode => {
      const hit = index.get(path);
      if (hit) return hit;
      const parts = path.split("::");
      const parentPath = parts.slice(0, -1).join("::");
      const parent = getNode(parentPath);
      const node: TreeNode = { name: parts[parts.length - 1], path, children: [], total: 0, due: 0, newCount: 0, learning: 0, suspended: 0, reviewed: 0 };
      parent.children.push(node);
      index.set(path, node);
      return node;
    };
    const count = (node: TreeNode, c: Card) => {
      node.total++;
      if (c.suspended) { node.suspended++; return; }
      if (c.state === "new") node.newCount++;
      else if (c.due <= now) node.due++;
      if (c.state === "learning" || c.state === "relearning") node.learning++;
      if (c.reps > 0) node.reviewed++;
    };
    // The same paths repeat across thousands of cards (deck paths, deep tag hierarchies): resolve each path's node chain once.
    const chains = new Map<string, TreeNode[]>();
    const chainOf = (p: string) => { let ch = chains.get(p); if (!ch) { const parts = p.split("::"); ch = []; for (let i = 1; i <= parts.length; i++) ch.push(getNode(parts.slice(0, i).join("::"))); chains.set(p, ch); } return ch; };
    for (const c of this.cards.values()) {
      count(root, c);
      const ps = this.paths(c, view);
      if (ps.length === 1) { for (const n of chainOf(ps[0])) count(n, c); continue; }
      const seen = new Set<TreeNode>();
      for (const p of ps) for (const n of chainOf(p)) { if (seen.has(n)) continue; seen.add(n); count(n, c); }
    }
    const sortRec = (n: TreeNode) => { n.children.sort((a, b) => a.name.localeCompare(b.name)); n.children.forEach(sortRec); };
    sortRec(root);
    this.treeCache.set(view, { v: this.version, tree: root });
    return root;
  }

  /** Cards matching a smart deck: AND across groups, OR within a group. */
  cardsMatching(sd: SmartDeck): Card[] {
    const out: Card[] = [];
    for (const c of this.cards.values()) {
      if (sd.states.length && !sd.states.includes(c.state)) continue;
      if (sd.decks.length && !sd.decks.some((d) => c.source === d || c.source.startsWith(d + "::"))) continue;
      const n = this.notes.get(c.nid); if (!n) continue;
      if (sd.systems.length && !sd.systems.some((x) => n.tags.includes("auto::System::" + x))) continue;
      if (sd.specialties.length && !sd.specialties.some((x) => n.tags.includes("auto::Specialty::" + x))) continue;
      if (sd.tags.length && !sd.tags.some((x) => n.tags.some((t) => t === x || t.startsWith(x + "::")))) continue;
      out.push(c);
    }
    return out;
  }

  cardsIn(path: string, view: View = "decks"): Card[] {
    const out: Card[] = [];
    if (view === "smart") { const sd = this.settings.smart.find((x) => x.id === path); return sd ? this.cardsMatching(sd) : []; }
    if (!path) return [...this.cards.values()];
    for (const c of this.cards.values()) {
      if (this.paths(c, view).some((p) => p === path || p.startsWith(path + "::"))) out.push(c);
    }
    return out;
  }

  /** Cards reviewed today (count), for the daily goal and new-card budget. */
  reviewedToday(now = Date.now()): { reviews: number; newCards: number } {
    const start = this.dayStart(now);
    let reviews = 0; const newIds = new Set<string>();
    for (let i = this.reviews.length - 1; i >= 0; i--) {
      const r = this.reviews[i];
      if (r.ts < start) break;
      reviews++;
      if (r.state === "new") newIds.add(r.cid);
    }
    return { reviews, newCards: newIds.size };
  }

  /** Build today's queue for a scope: learning due → reviews due → new (within budget). */
  queue(path: string, now = Date.now(), view: View = "decks", only: "all" | "due" | "new" = "all"): Card[] {
    const cards = this.cardsIn(path, view).filter((c) => !c.suspended);
    const learning = only === "new" ? [] : cards.filter((c) => (c.state === "learning" || c.state === "relearning") && c.due <= now).sort((a, b) => a.due - b.due);
    let review = only === "new" ? [] : cards.filter((c) => c.state === "review" && c.due <= now);
    const order = this.settings.dueOrder;
    if (order === "forgotten") review.sort((a, b) => retrievability((now - a.lastReview) / DAY, a.stability) - retrievability((now - b.lastReview) / DAY, b.stability));
    else if (order === "rescue") review.sort((a, b) => retrievability((now - b.lastReview) / DAY, b.stability) - retrievability((now - a.lastReview) / DAY, a.stability)); // backlog: save the most memory per minute
    else if (order === "shuffle") { for (let i = review.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [review[i], review[j]] = [review[j], review[i]]; } }
    else review.sort((a, b) => a.due - b.due);
    if (this.settings.maxReviewsPerDay > 0) review = review.slice(0, Math.max(0, this.settings.maxReviewsPerDay - this.reviewedToday(now).reviews));
    review = interleaveBySystem(review, (c) => this.notes.get(c.nid)?.tags.find((t) => t.startsWith("auto::System::")) ?? c.source.split("::").slice(0, 3).join("::"));
    const budget = only === "due" ? 0 : Math.max(0, this.settings.newPerDay - this.reviewedToday(now).newCards);
    // New cards: oldest first within each category, categories taken in turns so one deck can't hog the daily budget.
    const byCat = new Map<string, Card[]>();
    for (const c of cards) if (c.state === "new") { const k = c.source.split("::").slice(0, 3).join("::"); (byCat.get(k) ?? byCat.set(k, []).get(k)!).push(c); }
    for (const list of byCat.values()) list.sort((a, b) => a.due - b.due || a.created - b.created);
    const fresh: Card[] = []; const lists = [...byCat.values()];
    for (let i = 0; fresh.length < budget && lists.some((l) => l.length); i++) { const l = lists[i % lists.length]; if (l.length) fresh.push(l.shift()!); }
    // Interleave new cards among reviews so a session isn't all-new at the end.
    const out: Card[] = [...learning];
    if (this.settings.burySiblings) {
      const seenNotes = new Set<string>();
      const start = this.dayStart(now);
      for (let i = this.reviews.length - 1; i >= 0 && this.reviews[i].ts >= start; i--) { const c = this.cards.get(this.reviews[i].cid); if (c) seenNotes.add(c.nid); }
      const keep = (c: Card) => { if (seenNotes.has(c.nid)) return false; seenNotes.add(c.nid); return true; };
      for (const c of learning) seenNotes.add(c.nid);
      review.splice(0, review.length, ...review.filter(keep));
      fresh.splice(0, fresh.length, ...fresh.filter(keep));
    }
    const step = fresh.length ? Math.max(1, Math.floor((review.length + fresh.length) / fresh.length)) : Infinity;
    let fi = 0;
    for (let i = 0; i < review.length; i++) {
      out.push(review[i]);
      if ((i + 1) % step === 0 && fi < fresh.length) out.push(fresh[fi++]);
    }
    while (fi < fresh.length) out.push(fresh[fi++]);
    return out;
  }

  /** Learning cards that are due later today (shown after the main queue drains). */
  learningAhead(path: string, now = Date.now(), view: View = "decks"): Card[] {
    const end = this.dayStart(now) + DAY;
    return this.cardsIn(path, view).filter((c) => !c.suspended && (c.state === "learning" || c.state === "relearning") && c.due > now && c.due < end).sort((a, b) => a.due - b.due);
  }

  lastMatured: string | null = null; // the card just answered crossed a 21-day interval (a small celebration)
  // ---- load balancer (Anki 24.11 idea): within the scheduler's normal ±spread, pick the quietest day --------------
  private dueByDay: Map<number, number> | null = null; private dueByDayAt = -1;
  private dayIndex(ts: number) { return Math.floor((ts - this.settings.rollover * 3600000 - new Date(ts).getTimezoneOffset() * 60000) / DAY); }
  /** How many review cards fall due each day (built once per data version; kept up to date by balance()). */
  private loadMap() {
    if (!this.dueByDay || this.dueByDayAt !== this.cards.size) { const m = new Map<number, number>(); for (const c of this.cards.values()) if (!c.suspended && c.state === "review") { const d = this.dayIndex(c.due); m.set(d, (m.get(d) ?? 0) + 1); } this.dueByDay = m; this.dueByDayAt = this.cards.size; }
    return this.dueByDay;
  }
  /** A day's weight for the balancer: light weekdays and break days look "fuller". */
  dayWeight(ts: number) {
    const dt = new Date(ts); const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`; const s = this.settings;
    if (s.breakFrom && s.breakTo && iso >= s.breakFrom && iso <= s.breakTo) return 0;
    return s.easyDays?.[new Date(ts).getDay()] ?? 1;
  }
  private balance(next: Card, review: Review, now: number): Card {
    if (next.state !== "review") return next;
    const ivl = Math.round((next.due - now) / DAY); if (ivl < 3) return next;
    // Fuzz range as Anki uses it: ±15% up to a week, ±10% up to 20 days, ±5% beyond (at least ±1 day).
    const spread = Math.max(1, Math.round(ivl * (ivl <= 7 ? 0.15 : ivl <= 20 ? 0.1 : 0.05)));
    const lo = Math.max(2, ivl - spread), hi = Math.min(this.settings.scheduler.maximumInterval, ivl + spread);
    const m = this.loadMap(); let best = ivl, bestScore = Infinity;
    for (let d = lo; d <= hi; d++) {
      const ts = now + d * DAY; const w = this.dayWeight(ts); const load = (m.get(this.dayIndex(ts)) ?? 0) + 1;
      const score = (w <= 0 ? 1e9 : load / w) * (1 + Math.abs(d - ivl) * 0.02); // a little preference for the exact day
      if (score < bestScore) { bestScore = score; best = d; }
    }
    const out = { ...next, due: now + best * DAY };
    const day = this.dayIndex(out.due); m.set(day, (m.get(day) ?? 0) + 1);
    review.scheduledDays = best;
    return out;
  }
  /**
   * Spread overdue cards over the next `days` days (FSRS Helper's "postpone", simplified): the cards that lose least by
   * waiting (high stability) go furthest. Returns an undo function.
   */
  async postponeOverdue(days: number) {
    const now = stamp(); const day0 = this.dayStart(now); const due = [...this.cards.values()].filter((c) => !c.suspended && c.state === "review" && c.due < day0);
    if (!due.length) return null;
    due.sort((a, b) => a.stability - b.stability); // most fragile first: they stay soonest
    const before = due.map((c) => ({ ...c })); const per = Math.ceil(due.length / days); const out: Card[] = [];
    due.forEach((c, i) => { const k = Math.floor(i / per); out.push({ ...c, due: day0 + k * DAY + 60000, mod: now }); });
    for (const c of out) this.cards.set(c.id, c); this.dueByDay = null;
    await this.persist("postponing", db.putMany("cards", out)); this.bump(); this.touch();
    return { moved: out.length, undo: async () => { const t = stamp(); const back = before.map((c) => ({ ...c, mod: t })); for (const c of back) this.cards.set(c.id, c); this.dueByDay = null; await this.persist("undoing", db.putMany("cards", back)); this.bump(); this.touch(); } };
  }
  /** Overdue review cards (due before today began). */
  overdueCount() { const day0 = this.dayStart(Date.now()); let n = 0; for (const c of this.cards.values()) if (!c.suspended && c.state === "review" && c.due < day0) n++; return n; }
  /** "You know about N cards right now": the sum of every learned card's current recall probability (Anki 24.11's estimated total knowledge). */
  knowledgeNow(now = Date.now()) { let k = 0, n = 0; for (const c of this.cards.values()) if (!c.suspended && c.lastReview && c.state !== "new") { k += retrievability((now - c.lastReview) / DAY, c.stability); n++; } return { known: Math.round(k), of: n }; }
  // ---- card-quality check (Wozniak's minimum-information rule): cards that cram too much ----------------------
  private overCache: { key: string; ids: string[] } | null = null;
  overfilled(): string[] {
    const key = this.refsKey(); if (this.overCache?.key === key) return this.overCache.ids;
    const ids: string[] = [];
    const plain = (h: string) => h.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<img[^>]*>/gi, "").replace(/\[sound:[^\]]+\]/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    for (const n of this.notes.values()) {
      const nt = this.notetypes.get(n.ntid); if (!nt || nt.kind === "cloze" || n.fields.length < 2) continue;
      const back = n.fields[1] ?? ""; const items = (back.match(/<li\b/gi)?.length ?? 0) + (back.match(/<br\s*\/?>\s*[-•·*]|(^|>)\s*[-•·*]\s/gi)?.length ?? 0);
      if (plain(back).length > 700 || items >= 8) ids.push(n.id); // clearly crammed only — a long explanation alone isn't a problem
    }
    this.overCache = { key, ids }; return ids;
  }
  async answer(cardId: string, g: Rating, durationMs = 0, now = stamp()) {
    const card = this.cards.get(cardId);
    if (!card) return;
    const { card: next0, review } = rate(card, g, now, this.settings.scheduler, durationMs);
    const next = this.balance(next0, review, now);
    const matured = card.state === "review" && (card.due - card.lastReview) / DAY < 21 && next.state === "review" && (next.due - now) / DAY >= 21;
    this.lastMatured = matured ? cardId : null;
    this.cards.set(cardId, next);
    this.reviews.push(review);
    // Leech: every `leechThreshold` lapses, mark the note and let the UI ask what went wrong.
    let leech = false;
    const note = this.notes.get(card.nid);
    if (g === 1 && note && next.lapses >= this.settings.leechThreshold && next.lapses % this.settings.leechThreshold === 0) {
      leech = true;
      if (!note.tags.includes("leech")) { const m = { ...note, tags: [...note.tags, "leech"], modified: now }; this.notes.set(note.id, m); await this.persist("tagging a leech", db.putOne("notes", m)); }
    }
    this.lastAnswer = { cardId, leech, lapses: next.lapses };
    this.undoStack = [...this.undoStack.slice(-19), { reviewId: review.id, card }];
    await this.persist("saving the review", Promise.all([db.putOne("cards", next), db.putOne("reviews", review), db.setMeta("undoStack", this.undoStack)]));
    this.bump(); this.touch();
    return next;
  }
  lastAnswer: { cardId: string; leech: boolean; lapses: number } | null = null;
  undoStack: { reviewId: string; card: Card }[] = [];

  /** Record why a leech was missed; tags drive later remediation (packs from Claude, suspension). */
  async leechReason(cardId: string, reason: "knowledge" | "retrieval" | "confusion" | "suspend") {
    const c = this.cards.get(cardId); const n = c && this.notes.get(c.nid); if (!c || !n) return;
    if (reason === "suspend") { await this.setSuspended(cardId, true); return; }
    const tags = n.tags.filter((t) => !t.startsWith("leech::")).concat("leech::" + reason, ...(reason === "confusion" ? ["ask-claude"] : []));
    await this.updateNote(n.id, n.fields, tags.filter((t) => !t.startsWith("auto::")));
  }

  /** Language note types (standard, single template) that can get reverse cards. */
  reversibleNotetypes(): { nt: Notetype; notes: number; on: boolean }[] {
    const count = new Map<string, number>();
    for (const c of this.cards.values()) { if (!c.source.startsWith("Languages") || c.ord !== 0) continue; const n = this.notes.get(c.nid); if (n) count.set(n.ntid, (count.get(n.ntid) ?? 0) + 1); }
    return [...count].map(([id, n]) => ({ nt: this.notetypes.get(id)!, notes: n, on: !!this.notetypes.get(id)?.templates.some((t) => t.name === "Yuzu reverse") })).filter((x) => x.nt && x.nt.kind === "standard" && x.nt.fields.length >= 2 && x.nt.fields.length <= 4 && !/occlusion|image/i.test(x.nt.name) && (x.nt.templates.length === 1 || x.on)).sort((a, b) => b.notes - a.notes);
  }
  /** Add (or suspend) reverse cards for a language note type: back → front. */
  async setReverse(ntid: string, on: boolean) {
    const nt = this.notetypes.get(ntid); if (!nt) return; const now = stamp();
    const hasRev = nt.templates.some((t) => t.name === "Yuzu reverse");
    if (on && !hasRev) {
      const [f1, f2] = nt.fields;
      const next = { ...nt, templates: [...nt.templates, { name: "Yuzu reverse", qfmt: `{{${f2}}}`, afmt: `{{FrontSide}}<hr id=answer>{{${f1}}}` }] };
      this.notetypes.set(ntid, next); await db.putOne("notetypes", next);
    }
    const ord = nt.templates.findIndex((t) => t.name === "Yuzu reverse"); const revOrd = ord >= 0 ? ord : nt.templates.length;
    const out: Card[] = [];
    for (const c of [...this.cards.values()]) {
      if (c.ord !== 0) continue; const n = this.notes.get(c.nid); if (!n || n.ntid !== ntid) continue;
      const id = `${c.nid}-r${revOrd}`; const existing = this.cards.get(id);
      if (on) { if (existing) { if (existing.suspended) out.push({ ...existing, suspended: false, mod: now }); } else out.push({ id, nid: c.nid, ord: revOrd, state: "new", suspended: false, flag: 0, due: now, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: 0, step: 0, created: now, mod: now, source: c.source }); }
      else if (existing && !existing.suspended) out.push({ ...existing, suspended: true, mod: now });
    }
    for (const c of out) this.cards.set(c.id, c);
    await this.persist("updating reverse cards", db.putMany("cards", out));
    this.bump(); this.touch();
    return out.length;
  }
  /** Rename or move a deck node: every card under `from` gets the same path with `to` in its place. */
  async renamePath(from: string, to: string): Promise<number> {
    to = to.trim().replace(/\s*::\s*/g, "::").replace(/^::|::$/g, ""); if (!from || !to || from === to) return 0;
    const now = stamp(); const out: Card[] = [];
    for (const c of this.cards.values()) if (c.source === from || c.source.startsWith(from + "::")) out.push({ ...c, source: to + c.source.slice(from.length), mod: now });
    for (const c of out) this.cards.set(c.id, c);
    const pins = this.settings.pins.map((p) => (p.view === "decks" && (p.path === from || p.path.startsWith(from + "::")) ? { ...p, path: to + p.path.slice(from.length) } : p));
    await this.persist("renaming the category", db.putMany("cards", out)); if (pins.some((p, i) => p !== this.settings.pins[i])) await this.saveSettings({ pins });
    this.bump(); this.touch();
    return out.length;
  }
  /** Add or remove a classification tag (auto::System::X / auto::Specialty::Y) on the notes of the given cards. Manual choices survive re-imports. */
  async classify(cardIds: string[], kind: "System" | "Specialty", name: string, on: boolean): Promise<number> {
    const tag = `auto::${kind}::${name}`; const now = stamp(); const out: Note[] = []; const seen = new Set<string>();
    for (const id of cardIds) { const c = this.cards.get(id); if (!c || seen.has(c.nid)) continue; seen.add(c.nid); const n = this.notes.get(c.nid); if (!n) continue;
      const manual = n.tags.includes("manual::classified") ? [] : ["manual::classified"]; // from now on the automatic classifier leaves this note alone
      if (on && !n.tags.includes(tag)) out.push({ ...n, tags: [...n.tags, tag, ...manual], modified: now }); else if (!on && n.tags.includes(tag)) out.push({ ...n, tags: [...n.tags.filter((t) => t !== tag), ...manual], modified: now }); }
    for (const n of out) this.notes.set(n.id, n);
    await this.persist("updating categories", db.putMany("notes", out));
    this.bump(); this.touch();
    return out.length;
  }
  cardsOfNoteType(ntid: string, ord: number): Card[] { const out: Card[] = []; for (const c of this.cards.values()) if (c.ord === ord) { const n = this.notes.get(c.nid); if (n?.ntid === ntid) out.push(c); } return out; }
  async recordBoss(key: string, score: number, passed: boolean) {
    const prev = this.settings.bosses[key]; await this.saveSettings({ bosses: { ...this.settings.bosses, [key]: { at: Date.now(), score, best: Math.max(score, prev?.best ?? 0), passed: passed || !!prev?.passed } } });
  }

  /** Median answer time over the last 200 reviews (ms), or 8 s when there is no history. */
  typicalAnswerMs(): number {
    const d = this.reviews.slice(-200).map((r) => r.durationMs).filter((x) => x > 500 && x < 120000).sort((a, b) => a - b);
    return d.length >= 20 ? d[Math.floor(d.length / 2)] : 8000;
  }

  // ---- learning engine ----------------------------------------------------
  fitting: { progress: number } | null = null;
  /** Fit FSRS weights to this user's review log, then rebuild every reviewed card's memory state with them. */
  async optimizeScheduler(): Promise<string> {
    if (this.fitting) return "Already running";
    this.fitting = { progress: 0 }; this.bump();
    try {
      const res = await fitWeights(this.reviews, this.settings.scheduler.w, { iterations: 120, yieldEvery: 1, onProgress: (i) => { if (i % 10 === 0) { this.fitting = { progress: i / 120 }; this.bump(); } } });
      if (res.iterations === 0) return `Not enough history yet (${res.n} usable reviews; needs about 400). Keep studying — this runs again automatically.`;
      const gain = res.before > 0 ? (1 - res.after / res.before) * 100 : 0;
      if (gain < 0.5) { await this.saveSettings({ fit: { at: Date.now(), n: res.n, before: res.before, after: res.after } }); return "Your weights were already close to optimal; nothing changed."; }
      await this.saveSettings({ scheduler: { ...this.settings.scheduler, w: res.w }, fit: { at: Date.now(), n: res.n, before: res.before, after: res.after } });
      const n = await this.rebuildMemory();
      return `Scheduler tuned to your history: prediction error down ${gain.toFixed(0)}% over ${res.n.toLocaleString()} reviews; ${n.toLocaleString()} cards rescheduled.`;
    } finally { this.fitting = null; this.bump(); }
  }
  /** Recompute stability/difficulty/due for every reviewed card from its review log with the current weights. */
  async rebuildMemory(): Promise<number> {
    const by = new Map<string, Review[]>();
    for (const r of this.reviews) (by.get(r.cid) ?? by.set(r.cid, []).get(r.cid)!).push(r);
    const now = stamp(); const out: Card[] = [];
    for (const [cid, list] of by) {
      const c = this.cards.get(cid); if (!c || c.state === "new") continue;
      const r = replay(c, list.sort((a, b) => a.ts - b.ts), this.settings.scheduler.w, this.settings.scheduler.desiredRetention);
      // Only cards whose schedule really moved get a new edit time (so a re-tune never overrides another device's newer reviews).
      if (Math.abs(r.due - c.due) < 3600000 && Math.abs(r.stability - c.stability) < 1e-3 && Math.abs(r.difficulty - c.difficulty) < 1e-3) continue;
      if ((c.mod ?? 0) > (r.lastReview ?? 0) && c.lastReview > r.lastReview) continue; // has a review this replay doesn't know yet
      out.push({ ...r, suspended: c.suspended, flag: c.flag, source: c.source, mod: now });
    }
    for (const c of out) this.cards.set(c.id, c);
    await this.persist("rescheduling cards", db.putMany("cards", out));
    this.bump(); this.touch();
    return out.length;
  }
  calibration() { return calib(this.reviews, this.settings.scheduler.w); }
  /** Mastery label of a card from its stability and current recall. */
  masteryOf(c: Card, now = Date.now()): "unseen" | "learning" | "developing" | "mastered" | "durable" {
    if (c.state === "new" || c.reps === 0) return "unseen";
    const t = this.settings.mastery; const s = c.stability;
    if (s < t.developing) return "learning";
    if (s < t.mastered) return "developing";
    const r = retrievability((now - c.lastReview) / DAY, s);
    if (s >= t.durable && r >= 0.8) return "durable";
    return "mastered";
  }
  /** Mastery distribution and average answer time (last 30 days) per system. */
  private mbsCache: { v: number; at: number; out: ReturnType<Store["masteryBySystemRaw"]> } | null = null;
  /** Per-system mastery (cached for a minute per data version: Today and Progress both ask on every render). */
  masteryBySystem(now = Date.now()) {
    const c = this.mbsCache; if (c && c.v === this.version && Math.abs(now - c.at) < 60000) return c.out;
    const out = this.masteryBySystemRaw(now); this.mbsCache = { v: this.version, at: now, out }; return out;
  }
  private masteryBySystemRaw(now: number) {
    const out = new Map<string, { unseen: number; learning: number; developing: number; mastered: number; durable: number; total: number; secs: number | null }>();
    const get = (k: string) => out.get(k) ?? out.set(k, { unseen: 0, learning: 0, developing: 0, mastered: 0, durable: 0, total: 0, secs: null }).get(k)!;
    for (const c of this.cards.values()) {
      if (c.suspended) continue;
      const n = this.notes.get(c.nid); if (!n) continue;
      const m = this.masteryOf(c, now);
      for (const t of n.tags) if (t.startsWith("auto::System::")) { const e = get(t.slice(14)); e[m]++; e.total++; }
    }
    const sum = new Map<string, { ms: number; n: number }>();
    for (const r of this.reviews) {
      if (r.ts < now - 30 * DAY || !r.durationMs || r.durationMs > 120000) continue;
      const n = this.notes.get(this.cards.get(r.cid)?.nid ?? ""); if (!n) continue;
      for (const t of n.tags) if (t.startsWith("auto::System::")) { const e = sum.get(t.slice(14)) ?? sum.set(t.slice(14), { ms: 0, n: 0 }).get(t.slice(14))!; e.ms += r.durationMs; e.n++; }
    }
    for (const [k, v] of sum) if (out.has(k) && v.n >= 5) out.get(k)!.secs = v.ms / v.n / 1000;
    return out;
  }

  /** Undo the last review: restore the card (with a fresh `mod` so the undo wins on sync) and tombstone the review. */
  async undoLast(): Promise<Card | null> {
    const last = this.reviews[this.reviews.length - 1];
    const u = this.undoStack[this.undoStack.length - 1];
    if (!last || !u || u.reviewId !== last.id || last.ts < Date.now() - 10 * 60000) return null;
    const now = stamp();
    const prev = { ...u.card, mod: now };
    this.cards.set(prev.id, prev);
    this.reviews.pop(); this.undoStack = this.undoStack.slice(0, -1);
    this.tombstones["r:" + last.id] = now;
    await this.persist("undoing the review", Promise.all([db.putOne("cards", prev), db.deleteMany("reviews", [last.id]), db.setMeta("undoStack", this.undoStack), db.setMeta("tombstones", this.tombstones)]));
    this.bump(); this.touch();
    return prev;
  }

  async bulk(cardIds: string[], action: { suspended?: boolean; flag?: number; addTag?: string; source?: string }) {
    const now = stamp(); const cards: Card[] = []; const notes: Note[] = [];
    for (const id of cardIds) {
      const c = this.cards.get(id); if (!c) continue;
      const next = { ...c, mod: now };
      if (action.suspended !== undefined) next.suspended = action.suspended;
      if (action.flag !== undefined) next.flag = action.flag;
      if (action.source) next.source = action.source;
      this.cards.set(id, next); cards.push(next);
      if (action.addTag) { const n = this.notes.get(c.nid); if (n && !n.tags.includes(action.addTag)) { const nn = { ...n, tags: [...n.tags, action.addTag], modified: now }; this.notes.set(n.id, nn); notes.push(nn); } }
    }
    await this.persist("saving the bulk change", (async () => { await db.putMany("cards", cards); if (notes.length) await db.putMany("notes", notes); })());
    this.bump(); this.touch();
  }

  /** Full backup as a plain object (token excluded). */
  backup() {
    const { sync, ...settings } = this.settings;
    return { app: "yuzu", version: 1, at: Date.now(), settings: { ...settings, sync: { ...sync, token: "" } }, notetypes: [...this.notetypes.values()], notes: [...this.notes.values()], cards: [...this.cards.values()], reviews: this.reviews, tombstones: this.tombstones, hooks: this.hooks, improve: this.improve, mastery: this.mastery };
  }
  /** Small backup: everything irreplaceable (reviews, settings, personal notes, scheduling), without the card text that the repository or Anki can restore. */
  quickBackup() {
    const { sync, ...settings } = this.settings;
    return { app: "yuzu", version: 1, quick: true, at: Date.now(), settings: { ...settings, sync: { ...sync, token: "" } }, cards: [...this.cards.values()].filter((c) => c.reps > 0 || c.suspended || c.flag), reviews: this.reviews, tombstones: this.tombstones, hooks: this.hooks, improve: this.improve, mastery: this.mastery };
  }
  async restore(data: any, onProgress?: (m: string, f: number) => void) {
    if (data?.app !== "yuzu") throw new Error("Not a Yuzu backup file");
    for (const nt of data.notetypes ?? []) this.notetypes.set(nt.id, nt);
    if (data.tombstones) { this.tombstones = mergeTombstones(this.tombstones, data.tombstones); await db.setMeta("tombstones", this.tombstones); }
    if (data.improve) { const merged = { ...this.improve }; for (const [k, v] of Object.entries(data.improve as typeof this.improve)) if ((merged[k]?.m ?? -1) < v.m) merged[k] = v; this.improve = merged; await db.setMeta("improve", merged); }
    if (data.mastery) { const ids = new Set(this.mastery.log.map((e) => e.id)); this.mastery = { log: [...this.mastery.log, ...(data.mastery.log ?? []).filter((e: any) => !ids.has(e.id))], kept: { ...(data.mastery.kept ?? {}), ...this.mastery.kept } }; await db.setMeta("mastery", this.mastery); }
    if (data.hooks) { const merged = { ...this.hooks }; for (const [k, v] of Object.entries(data.hooks as typeof this.hooks)) if ((merged[k]?.m ?? -1) < v.m) merged[k] = v; this.hooks = merged; await db.setMeta("hooks", merged); }
    const n = mergeNotes(this.notes, data.notes ?? [], this.tombstones); const c = mergeCards(this.cards, data.cards ?? [], this.tombstones);
    const known = new Set(this.reviews.map((r) => r.id));
    const m = mergeReviews(this.reviews, data.reviews ?? []); this.reviews = m.list;
    onProgress?.("Saving", 0.3);
    await db.putMany("notetypes", data.notetypes ?? []);
    await db.putMany("notes", (data.notes ?? []).filter((x: Note) => this.notes.get(x.id) === x), 1000);
    await db.putMany("cards", (data.cards ?? []).filter((x: Card) => this.cards.get(x.id) === x), 2000);
    await db.putMany("reviews", (data.reviews ?? []).filter((r: Review) => !known.has(r.id)), 5000);
    if (data.settings) { const { sync, ...rest } = data.settings; this.settings = { ...this.settings, ...rest, sync: { ...this.settings.sync, ...(sync ?? {}), token: this.settings.sync.token || sync?.token || "" } }; await db.setMeta("settings", this.settings); }
    this.bump(); this.touch();
    return { notes: n, cards: c, reviews: m.added };
  }

  async updateNote(noteId: string, fields: string[], userTags: string[]) {
    const n = this.notes.get(noteId); if (!n) return;
    const auto = n.tags.filter((t) => t.startsWith("auto::"));
    const t = stamp(); const fieldsChanged = fields.join("\x1f") !== n.fields.join("\x1f");
    const next = { ...n, fields, tags: [...new Set([...userTags, ...auto])], modified: t, ...(fieldsChanged ? { edited: t } : {}) };
    this.notes.set(noteId, next); await this.persist("editing the card", db.putOne("notes", next)); this.bump(); this.touch();
  }

  async setSuspended(cardId: string, suspended: boolean) {
    const c = this.cards.get(cardId); if (!c) return;
    const next = { ...c, suspended, mod: stamp() }; this.cards.set(cardId, next); await this.persist("suspending the card", db.putOne("cards", next)); this.bump(); this.touch();
  }
  async setFlag(cardId: string, flag: number) {
    const c = this.cards.get(cardId); if (!c) return;
    const next = { ...c, flag, mod: stamp() }; this.cards.set(cardId, next); await this.persist("flagging the card", db.putOne("cards", next)); this.bump(); this.touch();
  }

  stats(now = Date.now()): Stats {
    const { reviews: today } = this.reviewedToday(now);
    // Streak: consecutive local days (ending today or yesterday) with at least one review. Days start at `rollover`.
    const dayOf = (ts: number) => { const d = new Date(ts - this.settings.rollover * 3600000); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / DAY); };
    const days = new Set<number>();
    for (const r of this.reviews) days.add(dayOf(r.ts));
    let streak = 0; let d = dayOf(now);
    if (!days.has(d)) d--; // today isn't over yet
    // Rest days: up to `restDays` missed days per 7 don't break the streak (shift weeks happen).
    const rests: number[] = [];
    while (true) {
      if (days.has(d)) { streak++; d--; continue; }
      const recent = rests.filter((r) => r - d < 7).length;
      if (days.size && recent < this.settings.restDays && streak > 0) { rests.push(d); d--; continue; }
      break;
    }
    return { today, goal: this.settings.dailyGoal, streak };
  }

  /**
   * Recap for a period (a month or a year): totals, insights and a persona, all from real reviews.
   * Shown in Progress and offered on Today in the first days of a month.
   */
  recap(from: number, to: number) {
    const rs = this.reviews.filter((r) => r.ts >= from && r.ts < to);
    const dayOf = (ts: number) => this.dayIndex(ts);
    const days = new Map<number, number>(); const hours = new Array(24).fill(0); const bySys = new Map<string, { n: number; ok: number }>();
    let ms = 0, rv = 0, ok = 0, fresh = 0, matured = 0; const lapsesBy = new Map<string, number>();
    const sysOf = (cid: string) => { const c = this.cards.get(cid); const n = c && this.notes.get(c.nid); return n?.tags.find((t) => t.startsWith("auto::System::"))?.slice(14) ?? (c ? c.source.split("::")[0] : "Other"); };
    for (const r of rs) {
      days.set(dayOf(r.ts), (days.get(dayOf(r.ts)) ?? 0) + 1); hours[new Date(r.ts).getHours()]++; ms += Math.min(r.durationMs || 0, 120000);
      if (r.state === "new") fresh++;
      if (r.state === "review") { rv++; if (r.rating > 1) ok++; else lapsesBy.set(r.cid, (lapsesBy.get(r.cid) ?? 0) + 1); }
      if (r.state === "review" && r.rating > 1 && r.scheduledDays >= 21 && (r.elapsedDays ?? 0) < 21) matured++;
      const sy = sysOf(r.cid); const e = bySys.get(sy) ?? bySys.set(sy, { n: 0, ok: 0 }).get(sy)!; e.n++; if (r.rating > 1) e.ok++;
    }
    const spanDays = Math.max(1, Math.round((Math.min(to, Date.now()) - from) / DAY));
    const best = [...days].sort((a, b) => b[1] - a[1])[0];
    let streak = 0, run = 0; const keys = [...days.keys()].sort((a, b) => a - b); for (let i = 0; i < keys.length; i++) { run = i && keys[i] === keys[i - 1] + 1 ? run + 1 : 1; streak = Math.max(streak, run); }
    const topSys = [...bySys].filter(([k]) => k !== "Other").sort((a, b) => b[1].n - a[1].n).slice(0, 3).map(([name, e]) => ({ name, n: e.n, recall: e.n ? e.ok / e.n : 0 }));
    const nemesisId = [...lapsesBy].sort((a, b) => b[1] - a[1])[0]; const nem = nemesisId && this.cards.get(nemesisId[0]); const nemNote = nem && this.notes.get(nem.nid);
    const night = hours.slice(22).concat(hours.slice(0, 5)).reduce((a, b) => a + b, 0), morning = hours.slice(5, 10).reduce((a, b) => a + b, 0);
    const retired = this.mastery.log.filter((e) => e.at >= from && e.at < to).length;
    const recall = rv ? ok / rv : null; const minutes = Math.round(ms / 60000);
    // Persona: the most distinctive thing about this period.
    const personas: [boolean, string, string][] = [
      [rs.length > 0 && night / rs.length > 0.4, "The Night-Shift Scholar", "Most of your reviews happened between 22:00 and 05:00. Cards don't care what time it is — and neither do you."],
      [rs.length > 0 && morning / rs.length > 0.45, "The Dawn Reviewer", "Most of your reviews came before 10:00. Memory loves a fresh morning."],
      [days.size / spanDays >= 0.85 && spanDays >= 7, "The Metronome", `You studied on ${days.size} of ${spanDays} days. Spaced repetition rewards exactly this.`],
      [recall !== null && recall >= 0.92 && rv >= 100, "The Surgeon", `${Math.round((recall ?? 0) * 100)}% recalled on mature reviews. Precise.`],
      [retired >= 20, "The Graduate", `${retired} cards retired as mastered — known for years.`],
      [fresh >= 300, "The Explorer", `${fresh.toLocaleString()} new cards started. A lot of new ground.`],
      [best && best[1] >= 400, "The Marathoner", `${best?.[1].toLocaleString()} reviews in a single day.`],
      [true, "The Steady Climber", "Review by review, the curve bends your way."],
    ];
    const [, persona, personaWhy] = personas.find((p) => p[0])!;
    return {
      reviews: rs.length, minutes, daysStudied: days.size, spanDays, recall, fresh, matured, retired, longestRun: streak,
      bestDay: best ? { day: (best[0] + 0.5) * DAY, n: best[1] } : null, topSys, peakHour: hours.indexOf(Math.max(...hours)),
      nemesis: nemNote ? { title: nemNote.fields[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80), misses: nemesisId![1] } : null,
      knowledge: this.knowledgeNow().known, persona, personaWhy,
    };
  }

  /** Cards rated Again today (unique), oldest first: a short re-drill before bed is one of the cheapest wins in spaced repetition. */
  missedToday(now = Date.now()): Card[] {
    const start = this.dayStart(now); const seen = new Set<string>(); const out: Card[] = [];
    for (let i = this.reviews.length - 1; i >= 0 && this.reviews[i].ts >= start; i--) { const r = this.reviews[i]; if (r.rating !== 1 || seen.has(r.cid)) continue; seen.add(r.cid); const c = this.cards.get(r.cid); if (c && !c.suspended) out.push(c); }
    return out.reverse();
  }
  /** The system with the lowest recall over the last 7 days (at least 10 review-state reviews), for a targeted session. */
  weakestSystem(now = Date.now()): { name: string; retention: number; n: number } | null {
    const by = new Map<string, { ok: number; n: number }>();
    for (let i = this.reviews.length - 1; i >= 0 && this.reviews[i].ts >= now - 7 * DAY; i--) {
      const r = this.reviews[i]; if (r.state !== "review") continue;
      const n = this.notes.get(this.cards.get(r.cid)?.nid ?? ""); if (!n) continue;
      for (const t of n.tags) if (t.startsWith("auto::System::")) { const e = by.get(t.slice(14)) ?? by.set(t.slice(14), { ok: 0, n: 0 }).get(t.slice(14))!; e.n++; if (r.rating > 1) e.ok++; }
    }
    let best: { name: string; retention: number; n: number } | null = null;
    for (const [name, e] of by) if (e.n >= 10) { const ret = e.ok / e.n; if (!best || ret < best.retention) best = { name, retention: ret, n: e.n }; }
    return best && best.retention < 0.85 ? best : null;
  }

  private titles = new WeakMap<Note, string>();
  /** Lowercased title + tags of a note, cached per note object (a changed note is a new object, so no invalidation needed). */
  searchText(n: Note): string {
    let t = this.titles.get(n);
    if (t === undefined) { t = (noteTitle(n) + " " + n.tags.join(" ")).toLowerCase(); this.titles.set(n, t); }
    return t;
  }
  noteFor(card: Card): Note | undefined { return this.notes.get(card.nid); }
  notetypeFor(note: Note): Notetype | undefined { return this.notetypes.get(note.ntid); }
  stateCounts(): Record<CardState | "suspended", number> {
    const out = { new: 0, learning: 0, review: 0, relearning: 0, suspended: 0 };
    for (const c of this.cards.values()) { if (c.suspended) out.suspended++; else out[c.state]++; }
    return out;
  }
}

export const store = new Store();
