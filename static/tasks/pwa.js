/* pwa.js — Doit être chargé AVANT app.js
 *
 * Responsabilités :
 *  1. Enregistrer le Service Worker
 *  2. IndexedDB : file d'attente des opérations hors-ligne
 *  3. Intercepter les soumissions de formulaires quand hors-ligne
 *  4. Rejouer la file à la reconnexion
 *  5. Toasts + bannière hors-ligne
 *  6. Détecter les changements serveur et proposer une mise à jour
 *
 * API publique utilisée par app.js :
 *   getCsrf()                           → token CSRF cookie
 *   queueOfflineOp(url, type, body)     → ajoute à la file
 *   window.isOfflineQueueEmpty()        → bool
 */

/* ── CSRF (défini ici, app.js le réutilise) ── */
function getCsrf() {
  return document.cookie.split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('csrftoken='))
    ?.split('=')[1] || '';
}
window.getCsrf = getCsrf;

/* ════════════════════════════════════════════
 *  IndexedDB helpers
 * ════════════════════════════════════════════ */
const IDB_NAME  = 'todo-offline';
const IDB_STORE = 'pending';
const IDB_VER   = 1;

function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror  = e => reject(e.target.error);
  });
}

async function _idbAdd(op) {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req = store.add(op);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function _idbGetAll() {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function _idbDelete(id) {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).delete(id);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

async function _idbCount() {
  const db = await _openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).count();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

/* ════════════════════════════════════════════
 *  File d'attente publique
 * ════════════════════════════════════════════ */

/**
 * Ajoute une opération à la file hors-ligne.
 * @param {string} url
 * @param {'form'|'json'} type  - form = FormData, json = JSON body
 * @param {object} body         - données sérialisables (sans csrfmiddlewaretoken)
 * @param {string} [label]      - description lisible pour les logs
 */
async function queueOfflineOp(url, type, body, label) {
  await _idbAdd({ url, type, body, label: label || url, ts: Date.now() });
  await _updatePendingUI();
  showToast('Hors ligne — modification sauvegardée, sera synchronisée à la reconnexion.');
}
window.queueOfflineOp = queueOfflineOp;

window.isOfflineQueueEmpty = async () => (await _idbCount()) === 0;

/* ════════════════════════════════════════════
 *  Toast
 * ════════════════════════════════════════════ */
function showToast(msg, duration = 4000) {
  let el = document.getElementById('pwaToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pwaToast';
    el.className = 'pwa-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), duration);
}
window.showToast = showToast;

/* ════════════════════════════════════════════
 *  Bannière hors-ligne + badge
 * ════════════════════════════════════════════ */
async function _updatePendingUI() {
  const count = await _idbCount();
  const badge = document.getElementById('pendingBadge');
  const syncBtn = document.getElementById('syncNowBtn');
  if (badge) {
    badge.textContent = count > 0 ? count : '';
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
  if (syncBtn) syncBtn.style.display = count > 0 && navigator.onLine ? 'inline-flex' : 'none';
}

function _updateBanner() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;
  banner.style.display = navigator.onLine ? 'none' : 'flex';
}

/* ════════════════════════════════════════════
 *  Détection des changements serveur
 * ════════════════════════════════════════════ */
const APP_REVISION_URL = '/api/app-revision/';
const APP_REVISION_POLL_MS = 10000;
let _appRevision = null;
let _pendingExternalRevision = null;
let _checkingAppRevision = false;
let _localMutationsInFlight = 0;
let _localRevisionRefreshPending = false;
let _localRevisionRefreshRunning = false;
const _nativeFetch = window.fetch.bind(window);

function _getRequestUrl(input) {
  try {
    const raw = input instanceof Request ? input.url : input;
    return new URL(raw, window.location.href);
  } catch (_) {
    return null;
  }
}

function _getRequestMethod(input, init) {
  return (init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
}

async function _fetchAppRevision() {
  const res = await _nativeFetch(APP_REVISION_URL, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.revision || null;
}

function _ensureAppUpdatePrompt() {
  let el = document.getElementById('appUpdatePrompt');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'appUpdatePrompt';
  el.className = 'app-update-prompt';
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <span>Base modifiée ailleurs</span>
    <button type="button" id="appUpdateReloadBtn">Mettre à jour</button>
  `;
  el.querySelector('#appUpdateReloadBtn')?.addEventListener('click', () => location.reload());
  document.body.appendChild(el);
  return el;
}

function _showAppUpdatePrompt() {
  _ensureAppUpdatePrompt().classList.add('show');
}

function _hideAppUpdatePrompt() {
  document.getElementById('appUpdatePrompt')?.classList.remove('show');
}

function _queueLocalRevisionRefresh() {
  if (_pendingExternalRevision) return;

  _localRevisionRefreshPending = true;
  setTimeout(_refreshRevisionAfterLocalMutations, 250);
}

async function _refreshRevisionAfterLocalMutations() {
  if (!_localRevisionRefreshPending || _localRevisionRefreshRunning) return;
  if (_localMutationsInFlight > 0) {
    setTimeout(_refreshRevisionAfterLocalMutations, 250);
    return;
  }

  _localRevisionRefreshPending = false;
  _localRevisionRefreshRunning = true;
  try {
    if (_pendingExternalRevision) return;
    const revision = await _fetchAppRevision();
    if (revision) {
      _appRevision = revision;
      _hideAppUpdatePrompt();
    }
  } catch (_) {
    _localRevisionRefreshPending = true;
    setTimeout(_refreshRevisionAfterLocalMutations, APP_REVISION_POLL_MS);
  } finally {
    _localRevisionRefreshRunning = false;
  }
}

function _isTrackedLocalMutation(input, init) {
  const method = _getRequestMethod(input, init);
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;

  const url = _getRequestUrl(input);
  if (!url || url.origin !== window.location.origin) return false;
  return url.pathname !== APP_REVISION_URL;
}

window.fetch = async function(input, init) {
  const tracksLocalMutation = _isTrackedLocalMutation(input, init);
  if (tracksLocalMutation) _localMutationsInFlight++;

  try {
    const res = await _nativeFetch(input, init);
    if (tracksLocalMutation && res.ok) _queueLocalRevisionRefresh();
    return res;
  } finally {
    if (tracksLocalMutation) _localMutationsInFlight = Math.max(0, _localMutationsInFlight - 1);
  }
};

async function checkAppRevision() {
  if (!navigator.onLine || document.hidden || _checkingAppRevision) return;
  if (_localMutationsInFlight > 0 || _localRevisionRefreshPending || _localRevisionRefreshRunning) return;
  if (!(await window.isOfflineQueueEmpty())) return;

  _checkingAppRevision = true;
  try {
    const revision = await _fetchAppRevision();
    if (!revision) return;

    if (_appRevision === null) {
      _appRevision = revision;
      return;
    }

    if (revision !== _appRevision) {
      _pendingExternalRevision = revision;
      _showAppUpdatePrompt();
    }
  } catch (_) {
    // La prochaine sonde retentera silencieusement.
  } finally {
    _checkingAppRevision = false;
  }
}

/* ════════════════════════════════════════════
 *  Synchronisation
 * ════════════════════════════════════════════ */
async function syncPending() {
  const ops = await _idbGetAll();
  if (ops.length === 0) return;

  showToast(`Synchronisation de ${ops.length} modification(s)…`, 8000);

  let synced = 0;
  for (const op of ops) {
    try {
      let res;
      if (op.type === 'json') {
        res = await fetch(op.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf() },
          body: JSON.stringify(op.body),
        });
      } else {
        // form
        const fd = new FormData();
        fd.append('csrfmiddlewaretoken', getCsrf()); // token frais
        for (const [k, v] of Object.entries(op.body || {})) fd.append(k, v);
        res = await fetch(op.url, { method: 'POST', body: fd });
      }

      if (res.ok || res.status === 404) {
        // 404 = ressource supprimée entre-temps → on saute silencieusement
        await _idbDelete(op.id);
        synced++;
      } else {
        showToast(`Erreur sync (HTTP ${res.status}) — ${ops.length - synced} restante(s). Réessayez.`);
        break;
      }
    } catch {
      // Réseau à nouveau indisponible pendant la sync
      showToast('Sync interrompue (réseau perdu) — elle reprendra à la prochaine connexion.');
      break;
    }
  }

  await _updatePendingUI();

  if (synced > 0) {
    showToast(`${synced} modification(s) synchronisée(s) ✓`);
    _queueLocalRevisionRefresh();
  }
}
window.syncPending = syncPending;

/* ════════════════════════════════════════════
 *  Interception des formulaires hors-ligne
 * ════════════════════════════════════════════ */
document.addEventListener('submit', async e => {
  if (navigator.onLine) return; // en ligne → comportement normal

  const form = e.target;
  const method = (form.method || 'GET').toUpperCase();
  if (method !== 'POST') return;

  e.preventDefault();

  const fd = new FormData(form);
  const body = {};
  for (const [k, v] of fd.entries()) {
    if (k !== 'csrfmiddlewaretoken') body[k] = v;
  }

  const action = form.action || window.location.pathname;
  const label = form.dataset.offlineLabel || action;

  await queueOfflineOp(action, 'form', body, label);

  // Feedback visuel minimal : griser l'élément parent si dans une tâche
  const taskItem = form.closest('.task-item');
  if (taskItem) taskItem.style.opacity = '0.45';
}, true); // capture phase pour être avant app.js

/* ════════════════════════════════════════════
 *  Événements réseau
 * ════════════════════════════════════════════ */
window.addEventListener('online', async () => {
  _updateBanner();
  await _updatePendingUI();
  await syncPending();
});

window.addEventListener('offline', () => {
  _updateBanner();
});

/* ════════════════════════════════════════════
 *  Init au chargement
 * ════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  _updateBanner();
  await _updatePendingUI();

  // Bouton "Synchroniser maintenant" (affiché quand ops en attente + en ligne)
  document.getElementById('syncNowBtn')?.addEventListener('click', syncPending);

  checkAppRevision();
  setInterval(checkAppRevision, APP_REVISION_POLL_MS);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkAppRevision();
});

/* ════════════════════════════════════════════
 *  Enregistrement du Service Worker
 * ════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch(err => console.warn('SW registration failed:', err));
  });
}
