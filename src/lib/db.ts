// IndexedDB persistence. Everything is loaded into memory on start (collections of this size fit
// easily); IndexedDB is the durable copy, written in batches.
import type { Card, Note, Notetype, Review } from "./model";

const DB_NAME = "yuzu";
const DB_VERSION = 3; // 3: per-record journals for notes and cards (one small row per change instead of a bucket rewrite)
export const STORES = ["notetypes", "notes", "cards", "reviews", "meta", "media"] as const;
export type StoreName = (typeof STORES)[number];
// Notes and cards are stored in buckets (a few hundred records per IndexedDB row) because one row per
// record is ~50× slower to write: a 150k-card import took 6 minutes as single rows, seconds as buckets.
const BUCKETED: Partial<Record<StoreName, string>> = { notes: "notes_b", cards: "cards_b" };
const BUCKETS = 256;
const bucketOf = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % BUCKETS; };
interface Bucket { b: number; rows: { id: string }[] }
// Journals (version 3): a single changed note or card (an answer, an edit) is written as its own row here instead of
// rewriting its whole bucket (~570 cards). Reads lay the journal over the buckets (the journal row is always the newer
// copy); `foldJournals()` moves the rows into their buckets later, in one transaction, when the app is idle or hidden.
// Every bucket write removes the journal rows of the records it writes, in the same transaction, so a journal row can
// never hide a newer bucket copy.
const JOURNAL: Partial<Record<StoreName, string>> = { notes: "notes_j", cards: "cards_j" };
let journalRows = -1; // rows waiting in the journals (approximate; -1 until known)
export const journalSize = () => journalRows;
/** How many buckets one read request covers while loading: small enough that no single task freezes the screen. */
const READ_CHUNK = 8;

let dbp: Promise<IDBDatabase> | null = null; let hideHooked = false;

export function openDb(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (db.objectStoreNames.contains(s)) continue;
        const keyPath = s === "meta" ? "key" : s === "media" ? "name" : "id";
        const os = db.createObjectStore(s, { keyPath });
        if (s === "cards") { os.createIndex("nid", "nid"); os.createIndex("due", "due"); }
        if (s === "reviews") { os.createIndex("cid", "cid"); os.createIndex("ts", "ts"); }
        if (s === "notes") os.createIndex("ntid", "ntid");
      }
      for (const b of Object.values(BUCKETED)) if (!db.objectStoreNames.contains(b!)) db.createObjectStore(b!, { keyPath: "b" });
      for (const j of Object.values(JOURNAL)) if (!db.objectStoreNames.contains(j!)) db.createObjectStore(j!, { keyPath: "id" });
    };
    req.onsuccess = () => {
      // Leaving the app (the phone may kill the tab soon after): fold the journals into the buckets while nobody is looking.
      if (!hideHooked && typeof document !== "undefined") { hideHooked = true; document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && journalRows !== 0) foldJournals().catch(() => {}); }); }
      // Another tab opened a newer schema: close so it can upgrade, then reload this tab.
      req.result.onversionchange = () => { req.result.close(); dbp = null; if (typeof location !== "undefined") location.reload(); };
      migrate(req.result).then(() => resolve(req.result), reject);
    };
    req.onerror = () => reject(req.error);
    // Blocked: an older connection (another tab, the service worker) has not closed yet. Give it a moment; the request
    // goes ahead by itself once it closes.
    req.onblocked = () => { setTimeout(() => { dbp && req.readyState !== "done" && reject(new Error("The database is open in another Yuzu tab with an older version. Close the other tab and try again.")); }, 5000); };
  });
  return dbp;
}

function tx(db: IDBDatabase, store: string, mode: IDBTransactionMode) {
  return db.transaction(store, mode).objectStore(store);
}
const done = (t: IDBTransaction) => new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** Move rows written by version 1 (one row per note/card) into buckets, once. */
async function migrate(db: IDBDatabase): Promise<void> {
  for (const [store, bstore] of Object.entries(BUCKETED) as [StoreName, string][]) {
    const n = await req(tx(db, store, "readonly").count());
    if (!n) continue;
    const rows = await req(tx(db, store, "readonly").getAll()) as { id: string }[];
    await putBuckets(db, bstore, rows, [], true);
    const t = db.transaction(store, "readwrite"); t.objectStore(store).clear(); await done(t);
  }
}

async function putBuckets(db: IDBDatabase, bstore: string, puts: { id: string }[], dels: string[], fresh = false, onProgress?: (f: number) => void, jstore?: string): Promise<void> {
  const groups = new Map<number, { puts: { id: string }[]; dels: string[] }>();
  const g = (b: number) => groups.get(b) ?? groups.set(b, { puts: [], dels: [] }).get(b)!;
  for (const v of puts) g(bucketOf(v.id)).puts.push(v);
  for (const k of dels) g(bucketOf(k)).dels.push(k);
  const keys = [...groups.keys()]; const step = 32;
  for (let i = 0; i < keys.length; i += step) {
    const t = db.transaction(jstore ? [bstore, jstore] : bstore, "readwrite"); const os = t.objectStore(bstore); const js = jstore ? t.objectStore(jstore) : null;
    await Promise.all(keys.slice(i, i + step).map(async (b) => {
      const { puts, dels } = groups.get(b)!;
      if (js) { for (const v of puts) js.delete(v.id); for (const k of dels) js.delete(k); } // the bucket copy is now the newest
      const existing = fresh ? undefined : (await req(os.get(b)) as Bucket | undefined);
      const m = new Map<string, { id: string }>(existing?.rows.map((r) => [r.id, r]) ?? []);
      for (const v of puts) m.set(v.id, v);
      for (const k of dels) m.delete(k);
      os.put({ b, rows: [...m.values()] } as Bucket);
    }));
    await done(t);
    onProgress?.(Math.min(1, (i + step) / keys.length));
  }
}

export async function getAll<T>(store: StoreName, onChunk?: (frac: number) => void): Promise<T[]> {
  const db = await openDb();
  if (BUCKETED[store]) {
    // The journal first: a fold running meanwhile only moves rows from it into the buckets, so nothing can be missed.
    const jstore = JOURNAL[store]; const journal = jstore ? (await req(tx(db, jstore, "readonly").getAll()) as { id: string }[]) : [];
    // Buckets a few at a time: one request per chunk, so reading (and decoding) 150k records is many short tasks, not one long freeze.
    const out: { id: string }[] = [];
    for (let b = 0; b < BUCKETS; b += READ_CHUNK) {
      const bs = await req(tx(db, BUCKETED[store]!, "readonly").getAll(IDBKeyRange.bound(b, b + READ_CHUNK - 1))) as Bucket[];
      for (const x of bs) for (const r of x.rows) out.push(r);
      onChunk?.(Math.min(1, (b + READ_CHUNK) / BUCKETS));
    }
    if (journal.length) {
      const j = new Map(journal.map((r) => [r.id, r]));
      for (let i = 0; i < out.length; i++) { const n = j.get(out[i].id); if (n) { out[i] = n; j.delete(n.id); } }
      for (const r of j.values()) out.push(r); // new since the last fold
    }
    if (jstore) journalRows = Math.max(journalRows, 0) + journal.length;
    return out as T[];
  }
  return new Promise((res, rej) => {
    const r = tx(db, store, "readonly").getAll();
    r.onsuccess = () => res(r.result as T[]);
    r.onerror = () => rej(r.error);
  });
}
/** Media rows a chunk at a time (keys first, then ranges), yielding between chunks so the page stays responsive. */
export async function eachMediaChunk(fn: (rows: { name: string; blob: Blob }[]) => void, chunk = 1500): Promise<number> {
  const db = await openDb(); const keys = (await req(tx(db, "media", "readonly").getAllKeys())) as string[]; keys.sort();
  for (let i = 0; i < keys.length; i += chunk) {
    const range = IDBKeyRange.bound(keys[i], keys[Math.min(keys.length, i + chunk) - 1]);
    fn((await req(tx(db, "media", "readonly").getAll(range))) as { name: string; blob: Blob }[]);
    await new Promise((r) => setTimeout(r, 0));
  }
  return keys.length;
}
export async function getOne<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  if (BUCKETED[store]) {
    const jstore = JOURNAL[store]; const j = jstore ? await req(tx(db, jstore, "readonly").get(String(key))) : undefined; if (j) return j as T;
    const b = await req(tx(db, BUCKETED[store]!, "readonly").get(bucketOf(String(key)))) as Bucket | undefined; return b?.rows.find((r) => r.id === key) as T | undefined;
  }
  return new Promise((res, rej) => {
    const r = tx(db, store, "readonly").get(key);
    r.onsuccess = () => res(r.result as T | undefined);
    r.onerror = () => rej(r.error);
  });
}
export async function putOne(store: StoreName, value: unknown): Promise<void> {
  const db = await openDb();
  const jstore = JOURNAL[store];
  if (jstore) { const t = db.transaction(jstore, "readwrite"); t.objectStore(jstore).put(value); await done(t); journalRows = Math.max(journalRows, 0) + 1; if (journalRows >= FOLD_AT) foldSoon(); return; } // one small row, not a bucket
  if (BUCKETED[store]) return putBuckets(db, BUCKETED[store]!, [value as { id: string }], []);
  const t = db.transaction(store, "readwrite");
  t.objectStore(store).put(value);
  await done(t);
}
export async function putMany(store: StoreName, values: unknown[], batch = 2000, onProgress?: (frac: number) => void): Promise<void> {
  const db = await openDb();
  if (BUCKETED[store]) return putBuckets(db, BUCKETED[store]!, values as { id: string }[], [], false, onProgress, JOURNAL[store]);
  for (let i = 0; i < values.length; i += batch) {
    const t = db.transaction(store, "readwrite");
    const os = t.objectStore(store);
    try { for (const v of values.slice(i, i + batch)) os.put(v); } catch (e) { try { t.abort(); } catch { /* already over */ } throw e; } // all or nothing
    await done(t);
    onProgress?.(Math.min(1, (i + batch) / values.length));
  }
}
export async function deleteMany(store: StoreName, keys: IDBValidKey[]): Promise<void> {
  const db = await openDb();
  if (BUCKETED[store]) return putBuckets(db, BUCKETED[store]!, [], keys.map(String), false, undefined, JOURNAL[store]);
  const t = db.transaction(store, "readwrite");
  for (const k of keys) t.objectStore(store).delete(k);
  await done(t);
}
export async function clearStore(store: StoreName): Promise<void> {
  const db = await openDb();
  for (const s of [store, BUCKETED[store], JOURNAL[store]].filter(Boolean) as string[]) { const t = db.transaction(s, "readwrite"); t.objectStore(s).clear(); await done(t); }
  if (JOURNAL[store]) journalRows = 0;
}
/**
 * Move the journal rows into their buckets, a few buckets per transaction. Each transaction re-reads the journal rows it
 * moves, rewrites their buckets and deletes those rows, all or nothing: a reload or a killed tab part-way leaves every
 * record either still in the journal or already in its bucket, and running it again is harmless. A write made meanwhile
 * either lands before a step (and that step moves it) or after (and stays in the journal, the newer copy).
 * `pause` runs between steps (idle time while the app is in use; nothing when it's hidden).
 */
let folding: Promise<number> | null = null;
export function foldJournals(pause?: () => Promise<void>): Promise<number> {
  if (folding) return folding;
  folding = (async () => {
    const db = await openDb(); let moved = 0;
    for (const [store, jstore] of Object.entries(JOURNAL) as [StoreName, string][]) {
      const bstore = BUCKETED[store]!;
      const ids = await req(tx(db, jstore, "readonly").getAllKeys()) as string[]; if (!ids.length) continue;
      const groups = new Map<number, string[]>(); for (const id of ids) { const b = bucketOf(id); (groups.get(b) ?? groups.set(b, []).get(b)!).push(id); }
      const keys = [...groups.keys()]; const step = 16;
      for (let i = 0; i < keys.length; i += step) {
        if (i && pause) await pause();
        const t = db.transaction([bstore, jstore], "readwrite"); const os = t.objectStore(bstore); const js = t.objectStore(jstore);
        await Promise.all(keys.slice(i, i + step).map(async (b) => {
          const rows = (await Promise.all(groups.get(b)!.map((id) => req(js.get(id)) as Promise<{ id: string } | undefined>))).filter((r): r is { id: string } => !!r);
          if (!rows.length) return; // deleted (or folded) meanwhile
          const existing = await req(os.get(b)) as Bucket | undefined;
          const m = new Map<string, { id: string }>(existing?.rows.map((r) => [r.id, r]) ?? []); for (const v of rows) m.set(v.id, v);
          os.put({ b, rows: [...m.values()] } as Bucket); for (const v of rows) js.delete(v.id);
          moved += rows.length;
        }));
        await done(t);
      }
    }
    journalRows = 0; for (const jstore of Object.values(JOURNAL)) journalRows += await req(tx(db, jstore!, "readonly").count());
    return moved;
  })().finally(() => { folding = null; });
  return folding;
}
const idle = () => new Promise<void>((r) => { const ric = (globalThis as any).requestIdleCallback; if (ric) ric(() => r(), { timeout: 4000 }); else setTimeout(r, 50); });
let foldTimer: ReturnType<typeof setTimeout> | null = null;
/** Fold the journals in idle time after `delay` ms (a few buckets per idle slice, so studying never stalls on it). */
export function foldSoon(delay = 2000) {
  if (foldTimer || folding || journalRows === 0) return;
  foldTimer = setTimeout(() => { foldTimer = null; idle().then(() => foldJournals(idle)).catch(() => {}); }, delay);
}
const FOLD_AT = 300; // journal rows before a fold is scheduled while the app is in use
export async function clearAll(): Promise<void> { for (const s of STORES) await clearStore(s); }

export interface Snapshot { notetypes: Notetype[]; notes: Note[]; cards: Card[]; reviews: Review[] }
/** Everything, read a chunk at a time; `onProgress` gets 0…1 (cards, then notes, then the review log). */
export async function loadSnapshot(onProgress?: (frac: number) => void): Promise<Snapshot> {
  const notetypes = await getAll<Notetype>("notetypes");
  const cards = await getAll<Card>("cards", (f) => onProgress?.(f * 0.45));
  const notes = await getAll<Note>("notes", (f) => onProgress?.(0.45 + f * 0.5));
  const reviews = await getAll<Review>("reviews"); onProgress?.(1);
  return { notetypes, notes, cards, reviews };
}
export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const r = await getOne<{ key: string; value: T }>("meta", key);
  return r ? r.value : fallback;
}
export async function setMeta(key: string, value: unknown): Promise<void> { await putOne("meta", { key, value }); }
/**
 * Put records into several stores in ONE transaction: all of it is saved or none of it. A card pack used to write its notes
 * and its cards separately, so a reload or a full disk in between left notes without cards for good.
 */
export async function putAtomic(writes: Partial<Record<StoreName, unknown[]>>): Promise<void> {
  const db = await openDb();
  const entries = (Object.entries(writes) as [StoreName, unknown[] | undefined][]).filter(([, v]) => v?.length) as [StoreName, unknown[]][];
  if (!entries.length) return;
  // The journals too: a bucket write must drop the journal rows it replaces, or an older journal copy would win on the next load.
  const journals = entries.map(([s]) => JOURNAL[s]).filter((j): j is string => !!j);
  const t = db.transaction([...entries.map(([s]) => BUCKETED[s] ?? s), ...journals], "readwrite");
  let err: unknown = null;
  const fail = (e: unknown) => { if (!err) err = e; try { t.abort(); } catch { /* already over */ } };
  const finished = new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(err ?? t.error); t.onabort = () => rej(err ?? t.error ?? new Error("The save was interrupted")); });
  try {
    for (const [s, values] of entries) {
      const bstore = BUCKETED[s];
      if (!bstore) { const os = t.objectStore(s); for (const v of values) os.put(v); continue; }
      const jstore = JOURNAL[s]; if (jstore) { const js = t.objectStore(jstore); for (const v of values as { id: string }[]) js.delete(v.id); }
      const os = t.objectStore(bstore); const groups = new Map<number, { id: string }[]>();
      for (const v of values as { id: string }[]) { const b = bucketOf(v.id); (groups.get(b) ?? groups.set(b, []).get(b)!).push(v); }
      for (const [b, puts] of groups) {
        const r = os.get(b);
        r.onsuccess = () => { try { const m = new Map<string, { id: string }>((r.result as Bucket | undefined)?.rows.map((x) => [x.id, x]) ?? []); for (const v of puts) m.set(v.id, v); os.put({ b, rows: [...m.values()] } as Bucket); } catch (e) { fail(e); } };
      }
    }
  } catch (e) { fail(e); }
  await finished;
}
