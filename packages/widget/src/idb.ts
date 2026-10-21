// Minimal async key-value store over IndexedDB (database "annota", one object store per use). IndexedDB can
// be missing, blocked or throw (private mode, storage pressure); then the store silently falls back to
// memory, so drafts and the outbox still work for the lifetime of the page.

export type KV<T> = {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  all(): Promise<T[]>;
};

const STORES = ["drafts", "outbox"] as const;
let db: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  db ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open("annota", 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return db;
}

export function memoryKV<T>(): KV<T> {
  const m = new Map<string, T>();
  return {
    get: async (k) => m.get(k),
    set: async (k, v) => void m.set(k, v),
    del: async (k) => void m.delete(k),
    all: async () => [...m.values()],
  };
}

export function idbKV<T>(store: (typeof STORES)[number]): KV<T> {
  const mem = memoryKV<T>();
  const run = async <R>(
    mode: IDBTransactionMode,
    fn: (s: IDBObjectStore) => IDBRequest,
    fallback: () => Promise<R>,
  ) => {
    const d = await open();
    if (!d) return fallback();
    try {
      return await new Promise<R>((resolve, reject) => {
        const req = fn(d.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result as R);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return fallback();
    }
  };
  return {
    get: (k) =>
      run(
        "readonly",
        (s) => s.get(k),
        () => mem.get(k),
      ),
    set: (k, v) =>
      run(
        "readwrite",
        (s) => s.put(v, k),
        () => mem.set(k, v),
      ).then(() => undefined),
    del: (k) =>
      run(
        "readwrite",
        (s) => s.delete(k),
        () => mem.del(k),
      ).then(() => undefined),
    all: () =>
      run(
        "readonly",
        (s) => s.getAll(),
        () => mem.all(),
      ),
  };
}
