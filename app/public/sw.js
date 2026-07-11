// DoorsWorld service worker.
// Two jobs: (1) receive Web Share Target POSTs from the Android share sheet
// and hand the files to the app via IndexedDB, (2) modest runtime caching —
// network-first for navigations (deploys must show up), cache-first for
// immutable photo derivatives and hashed bundle assets.

const CACHE = 'doorsworld-v1';
// Resolve the app's base path from the SW registration scope so the same
// file works at / (dev preview) and /DoorsWorld/ (GitHub Pages).
const BASE = new URL(self.registration.scope).pathname;

const SHARE_DB = 'doorsworld-share';
const SHARE_STORE = 'inbox';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// --- Share target inbox (IndexedDB, shared with the app) ------------------
function openShareDb() {
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

async function stashSharedFiles(files) {
  const db = await openShareDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, 'readwrite');
    const store = tx.objectStore(SHARE_STORE);
    for (const file of files) store.add(file);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Web Share Target: stash the files, then send the app to its ingest flow.
  if (event.request.method === 'POST' && url.pathname === `${BASE}share-target`) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const files = formData.getAll('photos').filter((f) => f && f.size > 0);
          if (files.length) await stashSharedFiles(files);
        } catch (e) {
          // Fall through to the app either way; it shows an empty inbox.
        }
        return Response.redirect(`${BASE}?shared=1`, 303);
      })(),
    );
    return;
  }

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Navigations: network first so a fresh deploy always wins; cached shell
  // as offline fallback.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(event.request);
          const cache = await caches.open(CACHE);
          cache.put(event.request, res.clone());
          return res;
        } catch {
          const cached = await caches.match(event.request);
          return cached || caches.match(BASE);
        }
      })(),
    );
    return;
  }

  // Photos and hashed bundle assets are immutable: cache first.
  const isImmutable =
    url.pathname.startsWith(`${BASE}photos/`) || url.pathname.startsWith(`${BASE}assets/`);
  if (isImmutable) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        const res = await fetch(event.request);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          cache.put(event.request, res.clone());
        }
        return res;
      })(),
    );
  }
});
