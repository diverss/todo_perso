/* Service Worker — Todo Perso
 *
 * Stratégie :
 *   - Fichiers statiques  → cache-first, mise à jour en arrière-plan
 *   - Pages (GET)         → network-first, fallback cache si hors-ligne
 *   - POST                → laissé passer (géré par pwa.js côté client)
 */

const CACHE = 'todo-v2';

// Pré-cache minimal (shell de l'app)
const PRECACHE = [
  '/static/tasks/style.css',
  '/static/tasks/app.js',
  '/static/tasks/pwa.js',
];

/* ── Install ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate : purge anciens caches ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch ── */
self.addEventListener('fetch', e => {
  const req = e.request;

  // On ne touche pas aux requêtes non-GET (POST…) — gérées par pwa.js
  if (req.method !== 'GET') return;
  // On ne touche pas aux extensions, chrome-extension, etc.
  if (!req.url.startsWith(self.location.origin)) return;

  const isStatic = req.url.includes('/static/');

  if (isStatic) {
    // Cache-first + mise à jour silencieuse
    e.respondWith(
      caches.match(req).then(cached => {
        const network = fetch(req).then(res => {
          if (res.ok) {
            const clone = res.clone(); // cloner immédiatement, avant toute consommation du body
            caches.open(CACHE).then(c => c.put(req, clone));
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
  } else {
    // Network-first → fallback cache
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const clone = res.clone(); // cloner immédiatement, avant toute consommation du body
            caches.open(CACHE).then(c => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
  }
});
