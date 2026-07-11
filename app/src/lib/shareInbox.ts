// Reads files the service worker stashed from a Web Share Target POST
// (see public/sw.js — same DB/store names). Take-once semantics: reading
// drains the inbox so a reload doesn't re-import.

const SHARE_DB = 'doorsworld-share';
const SHARE_STORE = 'inbox';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SHARE_STORE)) {
        req.result.createObjectStore(SHARE_STORE, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Deduped across StrictMode's double effect run: both callers get the same
// drain result.
let pending: Promise<File[]> | null = null;

export function takeSharedFiles(): Promise<File[]> {
  if (!pending) {
    pending = drain().finally(() => {
      // Allow a later share (SPA kept alive) to drain again.
      setTimeout(() => (pending = null), 1000);
    });
  }
  return pending;
}

async function drain(): Promise<File[]> {
  if (!('indexedDB' in window)) return [];
  try {
    const db = await openDb();
    const files = await new Promise<File[]>((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE, 'readwrite');
      const store = tx.objectStore(SHARE_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        store.clear();
        resolve((req.result as File[]).filter((f) => f instanceof Blob));
      };
      req.onerror = () => reject(req.error);
    });
    db.close();
    return files;
  } catch {
    return [];
  }
}
