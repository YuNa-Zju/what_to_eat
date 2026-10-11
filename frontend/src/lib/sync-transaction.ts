/** IndexedDB is authoritative; localStorage remains a synchronous cache and legacy import. */
const KEYS = [
  'what-to-eat:local:v1',
  'what-to-eat:nickname:v1',
  'what-to-eat:sync:v1',
  'what-to-eat:before-sync:v1',
  'what-to-eat:sync-migration:v1',
] as const;
export const SYNC_STORAGE_CHANGE = 'what-to-eat:storage-hydrated';
type State = { version: number; values: Record<string, string | null> };
let database: Promise<IDBDatabase> | undefined;
let current: State | undefined;
let active: State | undefined;
let notifications: Set<() => void> | undefined;
let channel: BroadcastChannel | undefined;

/** Writes are staged while a transaction is active; no localStorage writes precede commit. */
export const syncStorage = {
  getItem(key: string): string | null {
    const state = active ?? current;
    return state && key in state.values ? state.values[key] : localStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    if (active) active.values[key] = value;
    else localStorage.setItem(key, value);
  },
  removeItem(key: string) {
    if (active) active.values[key] = null;
    else localStorage.removeItem(key);
  },
};
export function afterSyncCommit(notify: () => void) {
  if (notifications) notifications.add(notify);
  else notify();
}
function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('what-to-eat-sync', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('checkpoint');
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          database = undefined;
          current = undefined;
        };
        if (!channel && typeof BroadcastChannel !== 'undefined') {
          channel = new BroadcastChannel('what-to-eat-sync');
          channel.onmessage = (event) => {
            if (!current || event.data > current.version) void hydrateSyncStorage();
          };
        }
        resolve(request.result);
      };
      request.onerror = () => reject(new Error('浏览器无法打开本地存储，已有记录仍然保留'));
    }).catch((error) => {
      database = undefined;
      throw error;
    });
  }
  return database;
}
function mirror(state: State) {
  for (const key of KEYS) {
    try {
      const value = state.values[key];
      if (localStorage.getItem(key) === value) continue;
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // The IndexedDB commit already succeeded. Keep its in-memory view when the optional
      // localStorage cache is full; a later transaction will retry mirroring it.
    }
  }
}
export async function syncTransaction<T>(action: () => T): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('checkpoint', 'readwrite');
    const store = transaction.objectStore('checkpoint');
    let result: T;
    let error: unknown;
    let next: State;
    let modified = false;
    const callbacks = new Set<() => void>();
    const request = store.get('state');
    request.onsuccess = () => {
      try {
        const previous = request.result as State | undefined;
        next = previous
          ? { version: previous.version, values: { ...previous.values } }
          : {
              version: 0,
              values: Object.fromEntries(KEYS.map((key) => [key, localStorage.getItem(key)])),
            };
        active = next;
        notifications = callbacks;
        // Keep this synchronous. Network I/O never runs inside this transaction.
        result = action();
        modified = !previous || KEYS.some((key) => next.values[key] !== previous.values[key]);
        if (modified) {
          next.version++;
          store.put(next, 'state');
        }
      } catch (caught) {
        error = caught;
        transaction.abort();
      } finally {
        active = undefined;
        notifications = undefined;
      }
    };
    transaction.oncomplete = () => {
      const refreshed = !current || current.version !== next.version;
      if (!current || current.version <= next.version) {
        current = next;
        mirror(next);
      }
      for (const notify of callbacks) notify();
      if (refreshed && callbacks.size === 0) window.dispatchEvent(new Event(SYNC_STORAGE_CHANGE));
      if (modified) channel?.postMessage(next.version);
      resolve(result);
    };
    transaction.onabort = () =>
      reject(error ?? transaction.error ?? new Error('本地存储暂时不可用'));
    transaction.onerror = () => reject(error ?? transaction.error);
  });
}
/** Refresh synchronous readers on startup, focus, or another tab's committed change. */
export async function hydrateSyncStorage() {
  try {
    await syncTransaction(() => {});
  } catch {
    // Legacy data remains readable. A user-initiated write reports the storage failure.
  }
}
