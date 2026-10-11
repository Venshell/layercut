/**
 * IndexedDB persistence for MVP 0.3 (project plan §13 / Stage F):
 * - "autosave": a single latest session snapshot, written debounced
 * - "recents":  named saved projects (full JSON), capped
 */

const DB_NAME = "layercut";
const DB_VERSION = 1;
const STORE_AUTOSAVE = "autosave";
const STORE_RECENTS = "recents";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_AUTOSAVE)) {
        db.createObjectStore(STORE_AUTOSAVE);
      }
      if (!db.objectStoreNames.contains(STORE_RECENTS)) {
        db.createObjectStore(STORE_RECENTS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        let result: T;
        req.onsuccess = () => { result = req.result; };
        req.onerror = () => reject(req.error);
        t.oncomplete = () => { db.close(); resolve(result); };
        t.onabort = () => { db.close(); reject(t.error ?? req.error ?? new Error("IndexedDB transaction aborted")); };
        t.onerror = () => { db.close(); reject(t.error ?? req.error); };
      })
  );
}

/**
 * One read-modify-write inside a SINGLE transaction. `work` receives the store
 * and the current rows, and issues its own requests; the promise settles when
 * the transaction commits, so a failure rolls the whole edit back instead of
 * leaving a half-rebuilt store behind.
 */
function txUpdate(
  store: string,
  work: (s: IDBObjectStore, rows: RecentProject[]) => void
): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(store, "readwrite");
        const objectStore = t.objectStore(store);
        const read = objectStore.getAll();
        read.onsuccess = () => {
          try {
            work(objectStore, read.result as RecentProject[]);
          } catch (error) {
            try { t.abort(); } catch { /* already aborting */ }
            reject(error);
          }
        };
        read.onerror = () => reject(read.error);
        t.oncomplete = () => { db.close(); resolve(); };
        t.onabort = () => { db.close(); reject(t.error ?? new Error("IndexedDB transaction aborted")); };
        t.onerror = () => { db.close(); reject(t.error); };
      })
  );
}

export interface RecentProject {
  /** ms timestamp — also the primary key */
  id: number;
  name: string;
  savedAt: number;
  layerCount: number;
  /** full serialized project */
  json: string;
}

// ---------- autosave ----------

export interface AutosaveRecord {
  savedAt: number;
  name: string;
  json: string;
}

export async function writeAutosave(record: AutosaveRecord): Promise<void> {
  // Resolve only after transaction commit; callers must not mark failed writes saved.
  await tx(STORE_AUTOSAVE, "readwrite", (s) => s.put(record, "latest"));
}

export async function readAutosave(): Promise<AutosaveRecord | null> {
  try {
    const rec = await tx<AutosaveRecord | undefined>(STORE_AUTOSAVE, "readonly", (s) =>
      s.get("latest")
    );
    return rec ?? null;
  } catch (e) {
    console.warn("autosave read failed", e);
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    await tx(STORE_AUTOSAVE, "readwrite", (s) => s.clear());
  } catch {
    /* ignore */
  }
}

// ---------- recents ----------

const RECENTS_LIMIT = 5;

/**
 * Add or refresh one recent project. The read-modify-write runs in a single
 * transaction: doing it across separate ones let two concurrent saves (or a
 * save overlapping a delete) both read the old list and then clobber each
 * other, losing an entry.
 */
export async function addRecent(entry: Omit<RecentProject, "id">): Promise<void> {
  try {
    const rec: RecentProject = { ...entry, id: Date.now() };
    await txUpdate(STORE_RECENTS, (store, rows) => {
      const all = [...rows].sort((a, b) => b.id - a.id);
      // replace an entry with the same name (re-save), keep newest first
      const filtered = all.filter((r) => r.name !== rec.name);
      const next = [rec, ...filtered].slice(0, RECENTS_LIMIT);
      store.clear();
      for (const r of next) store.put(r);
    });
  } catch (e) {
    console.warn("recents write failed", e);
  }
}

export async function listRecents(): Promise<RecentProject[]> {
  try {
    const all = await tx<RecentProject[]>(STORE_RECENTS, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.id - a.id).slice(0, RECENTS_LIMIT);
  } catch (e) {
    console.warn("recents read failed", e);
    return [];
  }
}

export async function deleteRecent(id: number): Promise<void> {
  try {
    await tx(STORE_RECENTS, "readwrite", (s) => s.delete(id));
  } catch {
    /* ignore */
  }
}
