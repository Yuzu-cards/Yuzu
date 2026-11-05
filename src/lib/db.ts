// IndexedDB persistence. Everything is loaded into memory on start (collections of this size fit
// easily); IndexedDB is the durable copy, written in batches.
import type { Card, Note, Notetype, Review } from "./model";

const DB_NAME = "yuzu";
const DB_VERSION = 2;
export const STORES = ["notetypes", "notes", "cards", "reviews", "meta", "media"] as const;
export type StoreName = (typeof STORES)[number];
// Notes and cards are stored in buckets (a few hundred records per IndexedDB row) because one row per
// record is ~50× slower to write: a 150k-card import took 6 minutes as single rows, seconds as buckets.
const BUCKETED: Partial<Record<StoreName, string>> = { notes: "notes_b", cards: "cards_b" };
const BUCKETS = 256;
const bucketOf = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % BUCKETS; };
interface Bucket { b: number; rows: { id: string }[] }

let dbp: Promise<IDBDatabase> | null = null;

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
    };
    req.onsuccess = () => {
      // Another tab opened a newer schema: close so it can upgrade, then reload this tab.
      req.result.onversionchange = () => { req.result.close(); dbp = null; if (typeof location !== "undefined") location.reload(); };
      migrate(req.result).then(() => resolve(req.result), reject);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("The database is open in another Yuzu tab with an older version. Close the other tab and try again."));
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

async function putBuckets(db: IDBDatabase, bstore: string, puts: { id: string }[], dels: string[], fresh = false, onProgress?: (f: number) => void): Promise<void> {
  const groups = new Map<number, { puts: { id: string }[]; dels: string[] }>();
  const g = (b: number) => groups.get(b) ?? groups.set(b, { puts: [], dels: [] }).get(b)!;
  for (const v of puts) g(bucketOf(v.id)).puts.push(v);
  for (const k of dels) g(bucketOf(k)).dels.push(k);
  const keys = [...groups.keys()]; const step = 32;
  for (let i = 0; i < keys.length; i += step) {
    const t = db.transaction(bstore, "readwrite"); const os = t.objectStore(bstore);
    await Promise.all(keys.slice(i, i + step).map(async (b) => {
      const { puts, dels } = groups.get(b)!;
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

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  if (BUCKETED[store]) { const bs = await req(tx(db, BUCKETED[store]!, "readonly").getAll()) as Bucket[]; return bs.flatMap((b) => b.rows) as T[]; }
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
  if (BUCKETED[store]) { const b = await req(tx(db, BUCKETED[store]!, "readonly").get(bucketOf(String(key)))) as Bucket | undefined; return b?.rows.find((r) => r.id === key) as T | undefined; }
  return new Promise((res, rej) => {
    const r = tx(db, store, "readonly").get(key);
    r.onsuccess = () => res(r.result as T | undefined);
    r.onerror = () => rej(r.error);
  });
}
export async function putOne(store: StoreName, value: unknown): Promise<void> {
  const db = await openDb();
  if (BUCKETED[store]) return putBuckets(db, BUCKETED[store]!, [value as { id: string }], []);
  const t = db.transaction(store, "readwrite");
  t.objectStore(store).put(value);
  await done(t);
}
export async function putMany(store: StoreName, values: unknown[], batch = 2000, onProgress?: (frac: number) => void): Promise<void> {
  const db = await openDb();
  if (BUCKETED[store]) return putBuckets(db, BUCKETED[store]!, values as { id: string }[], [], false, onProgress);
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
  if (BUCKETED[store]) return putBuckets(db, BUCKETED[store]!, [], keys.map(String));
  const t = db.transaction(store, "readwrite");
  for (const k of keys) t.objectStore(store).delete(k);
  await done(t);
}
export async function clearStore(store: StoreName): Promise<void> {
  const db = await openDb();
  for (const s of [store, BUCKETED[store]].filter(Boolean) as string[]) { const t = db.transaction(s, "readwrite"); t.objectStore(s).clear(); await done(t); }
}
export async function clearAll(): Promise<void> { for (const s of STORES) await clearStore(s); }

export interface Snapshot { notetypes: Notetype[]; notes: Note[]; cards: Card[]; reviews: Review[] }
export async function loadSnapshot(): Promise<Snapshot> {
  const [notetypes, notes, cards, reviews] = await Promise.all([
    getAll<Notetype>("notetypes"), getAll<Note>("notes"), getAll<Card>("cards"), getAll<Review>("reviews"),
  ]);
  return { notetypes, notes, cards, reviews };
}
export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const r = await getOne<{ key: string; value: T }>("meta", key);
  return r ? r.value : fallback;
}
export async function setMeta(key: string, value: unknown): Promise<void> { await putOne("meta", { key, value }); }
