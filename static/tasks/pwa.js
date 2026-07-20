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
 *   queueOfflineOp(url, type, body, label, meta) → ajoute à la file
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
const IDB_TASK_STATE_STORE = 'task_state';
const IDB_VER   = 2;

function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(IDB_TASK_STATE_STORE)) {
        db.createObjectStore(IDB_TASK_STATE_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror  = e => reject(e.target.error);
  });
}

function _withStore(storeName, mode, cb) {
  return _openDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = cb(store);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  }));
}

async function _idbAdd(op) {
  return _withStore(IDB_STORE, 'readwrite', store => store.add(op));
}

async function _idbGetAll() {
  return _withStore(IDB_STORE, 'readonly', store => store.getAll());
}

async function _idbPutPending(op) {
  return _withStore(IDB_STORE, 'readwrite', store => store.put(op));
}

async function _idbDelete(id) {
  return _withStore(IDB_STORE, 'readwrite', store => store.delete(id));
}

async function _idbCount() {
  return _withStore(IDB_STORE, 'readonly', store => store.count());
}

async function _idbGetAllTaskStates() {
  return _withStore(IDB_TASK_STATE_STORE, 'readonly', store => store.getAll());
}

async function _idbGetTaskState(id) {
  return _withStore(IDB_TASK_STATE_STORE, 'readonly', store => store.get(String(id)));
}

async function _idbPutTaskState(state) {
  return _withStore(IDB_TASK_STATE_STORE, 'readwrite', store => store.put({ ...state, id: String(state.id) }));
}

async function _idbDeleteTaskState(id) {
  return _withStore(IDB_TASK_STATE_STORE, 'readwrite', store => store.delete(String(id)));
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
 * @param {object} [meta]       - données internes, ex. tâche locale liée
 */
async function queueOfflineOp(url, type, body, label, meta) {
  const op = { url, type, body, label: label || url, ts: Date.now(), meta: meta || {} };
  op.id = await _idbAdd(op);
  await _updatePendingUI();
  showToast('Hors ligne — modification sauvegardée, sera synchronisée à la reconnexion.');
  return op;
}
window.queueOfflineOp = queueOfflineOp;

window.isOfflineQueueEmpty = async () => (await _idbCount()) === 0;

/* ════════════════════════════════════════════
 *  État local des tâches
 * ════════════════════════════════════════════ */
function _stringId(value) {
  return value == null ? '' : String(value);
}

function _blankToNull(value) {
  const str = _stringId(value);
  return str ? str : null;
}

function _isLocalTaskId(id) {
  return _stringId(id).startsWith('local-');
}

function _isServerTaskId(id) {
  return /^\d+$/.test(_stringId(id));
}

function _priorityColor(priority) {
  return { 1: '#db4035', 2: '#ff9933', 3: '#4073ff', 4: '#555' }[parseInt(priority)] || '#555';
}

function _currentPathWithSearch() {
  return `${window.location.pathname}${window.location.search}`;
}

function _findTaskItems(taskId) {
  const id = _stringId(taskId);
  return [...document.querySelectorAll('.task-item[data-task-id]')]
    .filter(item => _stringId(item.dataset.taskId) === id);
}

function _closestTaskContainer(item) {
  return item.closest('.task-list-container, #inboxTaskList, #labelTaskList');
}

function _selectedOption(form, name) {
  const el = form.querySelector(`[name="${name}"]`);
  return el?.options?.[el.selectedIndex] || null;
}

function _selectedOptionText(form, name) {
  const opt = _selectedOption(form, name);
  return opt && opt.value ? opt.textContent.trim() : '';
}

function _taskStateFromElement(item) {
  const title = item.dataset.taskTitle || item.querySelector('.task-title')?.textContent?.trim() || '';
  return {
    id: _stringId(item.dataset.taskId),
    title,
    project_id: _blankToNull(item.dataset.projectId),
    project_name: item.dataset.projectName || '',
    section_id: _blankToNull(item.dataset.sectionId),
    section_name: item.dataset.sectionName || '',
    parent_id: _blankToNull(item.dataset.parentId),
    priority: item.dataset.priority || '4',
    priority_color: item.dataset.priorityColor || _priorityColor(item.dataset.priority),
    label_id: _blankToNull(item.dataset.labelId),
    label_name: item.dataset.labelName || '',
    label_color: item.dataset.labelColor || '',
    order: parseInt(item.dataset.order || '0'),
    completed: false,
  };
}

function _taskStateFromTaskForm(form, body, taskId) {
  const labelOpt = _selectedOption(form, 'label_id');
  return {
    id: _stringId(taskId),
    title: body.title || '',
    description: body.description || '',
    project_id: _blankToNull(body.project_id),
    project_name: _selectedOptionText(form, 'project_id'),
    section_id: _blankToNull(body.section_id),
    section_name: _selectedOptionText(form, 'section_id'),
    parent_id: _blankToNull(body.parent_id),
    priority: body.priority || '4',
    priority_color: _priorityColor(body.priority || '4'),
    label_id: _blankToNull(body.label_id),
    label_name: labelOpt?.dataset.labelName || (labelOpt?.value ? labelOpt.textContent.trim() : ''),
    label_color: labelOpt?.dataset.labelColor || '',
    completed: body.completed === '1',
  };
}

async function _mergeTaskState(taskId, patch, base) {
  const id = _stringId(taskId);
  const existing = await _idbGetTaskState(id);
  const state = {
    ...(base || {}),
    ...(existing || {}),
    ...patch,
    id,
    localUpdatedAt: patch.localUpdatedAt || Date.now(),
  };
  await _idbPutTaskState(state);
  return state;
}

function _setItemDataset(item, state) {
  item.dataset.taskId = _stringId(state.id);
  item.dataset.taskTitle = state.title || '';
  item.dataset.projectId = _stringId(state.project_id);
  item.dataset.projectName = state.project_name || '';
  item.dataset.sectionId = _stringId(state.section_id);
  item.dataset.sectionName = state.section_name || '';
  item.dataset.parentId = _stringId(state.parent_id);
  item.dataset.priority = _stringId(state.priority || '4');
  item.dataset.priorityColor = state.priority_color || _priorityColor(state.priority);
  item.dataset.labelId = _stringId(state.label_id);
  item.dataset.labelName = state.label_name || '';
  item.dataset.labelColor = state.label_color || '';
  item.dataset.order = _stringId(state.order || 0);
  if (_isServerTaskId(state.id)) {
    item.dataset.href = `/task/${state.id}/`;
  } else {
    delete item.dataset.href;
  }
}

function _ensurePendingBadge(titleLink) {
  let hints = titleLink.querySelector('.task-local-hints');
  if (!hints) {
    hints = document.createElement('div');
    hints.className = 'task-hints task-local-hints';
    titleLink.appendChild(hints);
  }
  let badge = hints.querySelector('.task-sync-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'task-sync-badge';
    badge.textContent = 'en attente';
    hints.appendChild(badge);
  }
}

function _updateLabelBadge(titleLink, state) {
  const existing = titleLink.querySelector('.task-label-badge');
  if (!state.label_id) {
    existing?.closest('div')?.remove();
    return;
  }

  const wrap = existing?.closest('div') || document.createElement('div');
  const badge = existing || document.createElement('span');
  badge.className = 'task-label-badge';
  badge.textContent = state.label_name || 'Étiquette';
  if (state.label_color) {
    badge.style.background = `${state.label_color}20`;
    badge.style.color = state.label_color;
  }
  if (!existing) {
    wrap.appendChild(badge);
    titleLink.appendChild(wrap);
  }
}

function _updateTaskLocation(item, state) {
  const locationText = item.querySelector('.task-location-text');
  if (!locationText) return;
  const parts = [state.project_name, state.section_name].filter(Boolean);
  locationText.textContent = parts.join(' / ');
}

function _updateTaskItemFromState(item, state) {
  _setItemDataset(item, state);
  item.classList.add('task-item-pending');

  const completeBtn = item.querySelector('.task-complete-btn');
  if (completeBtn) {
    completeBtn.dataset.taskId = _stringId(state.id);
    completeBtn.style.setProperty('--priority-color', state.priority_color || _priorityColor(state.priority));
  }

  const titleEl = item.querySelector('.task-title');
  if (titleEl) titleEl.textContent = state.title || '(sans titre)';

  const link = item.querySelector('a[href*="/task/"]');
  if (link) {
    if (_isServerTaskId(state.id)) link.href = `/task/${state.id}/`;
    else link.removeAttribute('href');
  }

  const titleLink = item.querySelector('.task-title-link');
  if (titleLink) {
    _ensurePendingBadge(titleLink);
    _updateLabelBadge(titleLink, state);
  }
  _updateTaskLocation(item, state);
}

function _buildTaskItem(state) {
  const item = document.createElement('div');
  item.className = 'task-item task-item-pending';
  _setItemDataset(item, state);

  const row = document.createElement('div');
  row.className = 'task-row';

  const completeBtn = document.createElement('button');
  completeBtn.type = 'button';
  completeBtn.className = 'task-complete-btn';
  completeBtn.dataset.taskId = _stringId(state.id);
  completeBtn.dataset.redirect = _currentPathWithSearch();
  completeBtn.title = 'Terminer';
  completeBtn.style.setProperty('--priority-color', state.priority_color || _priorityColor(state.priority));

  const titleLink = document.createElement('div');
  titleLink.className = 'task-title-link';

  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = state.title || '(sans titre)';

  if (_isServerTaskId(state.id)) {
    const a = document.createElement('a');
    a.href = `/task/${state.id}/`;
    a.appendChild(title);
    titleLink.appendChild(a);
  } else {
    titleLink.appendChild(title);
  }

  _ensurePendingBadge(titleLink);
  _updateLabelBadge(titleLink, state);

  row.appendChild(completeBtn);
  row.appendChild(titleLink);
  item.appendChild(row);
  return item;
}

function _containerAcceptsTaskState(container, state) {
  if (!container || state.completed || state.deleted) return false;

  if (container.id === 'labelTaskList') {
    return _stringId(state.label_id) === _stringId(container.dataset.labelId) && !_stringId(state.parent_id);
  }

  const projectId = container.dataset.project;
  if (!projectId) return false;
  if (_stringId(state.project_id) !== _stringId(projectId)) return false;

  const sectionId = container.dataset.section || '';
  const parentId = container.dataset.parent || '';
  return _stringId(state.section_id) === sectionId && _stringId(state.parent_id) === parentId;
}

function _findContainerForTaskState(state) {
  return [...document.querySelectorAll('.task-list-container, #inboxTaskList, #labelTaskList')]
    .find(container => _containerAcceptsTaskState(container, state)) || null;
}

function _removeEmptyMessages(container) {
  container.querySelectorAll(':scope > .task-list-empty').forEach(el => el.remove());
  const hiddenParent = container.closest('[hidden]');
  if (hiddenParent) hiddenParent.hidden = false;
}

function _applyStateToTaskDetail(state) {
  const form = document.getElementById('taskEditForm');
  if (!form || !form.action.includes(`/task/${state.id}/edit/`)) return;

  form.querySelector('[name="title"]').value = state.title || '';
  form.querySelector('[name="description"]').value = state.description || '';
  form.querySelector('[name="project_id"]').value = _stringId(state.project_id);
  form.querySelector('[name="section_id"]').value = _stringId(state.section_id);
  form.querySelector('[name="priority"]').value = _stringId(state.priority || '4');
  form.querySelector('[name="label_id"]').value = _stringId(state.label_id);
  form.querySelector('[name="parent_id"]').value = _stringId(state.parent_id);
}

function _applyTaskStateToDom(state) {
  if (state.completed || state.deleted) {
    _findTaskItems(state.id).forEach(item => item.remove());
    return;
  }

  _applyStateToTaskDetail(state);

  const target = _findContainerForTaskState(state);
  const items = _findTaskItems(state.id);
  let itemInTarget = null;

  for (const item of items) {
    const container = _closestTaskContainer(item);
    if (target && container === target) {
      itemInTarget = item;
      _updateTaskItemFromState(item, state);
    } else if (container && !_containerAcceptsTaskState(container, state)) {
      item.remove();
    } else {
      _updateTaskItemFromState(item, state);
    }
  }

  if (target && !itemInTarget) {
    _removeEmptyMessages(target);
    target.appendChild(_buildTaskItem(state));
  }
}

async function applyLocalTaskStates() {
  const states = (await _idbGetAllTaskStates())
    .sort((a, b) => (a.localUpdatedAt || 0) - (b.localUpdatedAt || 0));
  for (const state of states) _applyTaskStateToDom(state);
}
window.applyLocalTaskStates = applyLocalTaskStates;

function _taskIdFromAction(action, suffix) {
  try {
    const url = new URL(action, window.location.href);
    const match = url.pathname.match(new RegExp(`/task/(\\d+)/${suffix}/`));
    return match?.[1] || '';
  } catch (_) {
    return '';
  }
}

async function _markPendingCreateCompleted(localTaskId) {
  const ops = await _idbGetAll();
  for (const op of ops) {
    if (op.meta?.action !== 'task_create') continue;
    if (_stringId(op.meta.local_task_id) !== _stringId(localTaskId)) continue;
    op.body = { ...(op.body || {}), completed: '1' };
    await _idbPutPending(op);
  }
}

async function completeTaskOffline(taskId, item) {
  if (_isLocalTaskId(taskId)) {
    await _markPendingCreateCompleted(taskId);
    await _mergeTaskState(taskId, {
      completed: true,
      pending_action: 'complete',
      localUpdatedAt: Date.now(),
    }, item ? _taskStateFromElement(item) : null);
    await applyLocalTaskStates();
    return;
  }

  const base = item ? _taskStateFromElement(item) : { id: taskId };
  const op = await queueOfflineOp(`/task/${taskId}/complete/`, 'form', {}, 'Terminer tâche', {
    action: 'task_complete',
    task_id: _stringId(taskId),
  });
  await _mergeTaskState(taskId, {
    completed: true,
    pending_action: 'complete',
    localUpdatedAt: op.ts,
  }, base);
  await applyLocalTaskStates();
}
window.completeTaskOffline = completeTaskOffline;

async function queueTaskReorderOffline(url, items, label) {
  const serverItems = items
    .filter(item => _isServerTaskId(item.id))
    .map(item => ({
      id: parseInt(item.id),
      order: item.order,
      section_id: item.section_id ? parseInt(item.section_id) : null,
      parent_id: item.parent_id ? parseInt(item.parent_id) : null,
    }));

  const op = serverItems.length
    ? await queueOfflineOp(url, 'json', serverItems, label, {
      action: 'task_reorder',
      task_ids: serverItems.map(item => _stringId(item.id)),
    })
    : { ts: Date.now() };

  for (const item of items) {
    await _mergeTaskState(item.id, {
      order: item.order,
      section_id: _blankToNull(item.section_id),
      parent_id: _blankToNull(item.parent_id),
      pending_action: 'reorder',
      localUpdatedAt: op.ts,
    }, _taskStateFromElement(item.element));
  }
  await applyLocalTaskStates();
}
window.queueTaskReorderOffline = queueTaskReorderOffline;

async function queueLabelTaskReorderOffline(url, items, label) {
  const serverItems = items
    .filter(item => _isServerTaskId(item.id))
    .map(item => ({ id: parseInt(item.id), order: item.order }));

  const op = serverItems.length
    ? await queueOfflineOp(url, 'json', serverItems, label, {
      action: 'label_task_reorder',
      task_ids: serverItems.map(item => _stringId(item.id)),
    })
    : { ts: Date.now() };

  for (const item of items) {
    await _mergeTaskState(item.id, {
      label_order: item.order,
      pending_action: 'label_reorder',
      localUpdatedAt: op.ts,
    }, _taskStateFromElement(item.element));
  }
  await applyLocalTaskStates();
}
window.queueLabelTaskReorderOffline = queueLabelTaskReorderOffline;

function _formBody(form) {
  const fd = new FormData(form);
  const body = {};
  for (const [k, v] of fd.entries()) {
    if (k !== 'csrfmiddlewaretoken') body[k] = v;
  }
  return body;
}

async function _handleOfflineTaskCreate(form, body, action) {
  const localTaskId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const op = await queueOfflineOp(action, 'form', body, 'Créer tâche', {
    action: 'task_create',
    local_task_id: localTaskId,
  });
  const state = _taskStateFromTaskForm(form, body, localTaskId);
  state.pending_action = 'create';
  state.localUpdatedAt = op.ts;
  await _idbPutTaskState(state);

  form.reset();
  document.getElementById('modalAddTask')?.classList.remove('open');
  await applyLocalTaskStates();
}

async function _handleOfflineTaskEdit(form, body, action) {
  const taskId = _taskIdFromAction(action, 'edit');
  if (!taskId) {
    await queueOfflineOp(action, 'form', body, form.dataset.offlineLabel || action);
    return;
  }

  const op = await queueOfflineOp(action, 'form', body, 'Modifier tâche', {
    action: 'task_edit',
    task_id: taskId,
  });
  const state = _taskStateFromTaskForm(form, body, taskId);
  state.pending_action = 'edit';
  state.localUpdatedAt = op.ts;
  await _mergeTaskState(taskId, state);
  await applyLocalTaskStates();

  if (body.back && body.back.startsWith('/')) {
    window.location.href = body.back;
  }
}

async function _handleOfflineTaskDelete(form, body, action) {
  const taskId = _taskIdFromAction(action, 'delete');
  if (!taskId) {
    await queueOfflineOp(action, 'form', body, form.dataset.offlineLabel || action);
    return;
  }

  const op = await queueOfflineOp(action, 'form', body, 'Supprimer tâche', {
    action: 'task_delete',
    task_id: taskId,
  });
  await _mergeTaskState(taskId, {
    deleted: true,
    pending_action: 'delete',
    localUpdatedAt: op.ts,
  });
  await applyLocalTaskStates();

  if (body.back && body.back.startsWith('/')) {
    window.location.href = body.back;
  }
}

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
  document.body.classList.toggle('is-offline', !navigator.onLine);
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
async function _responseJsonOrNull(res) {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  try {
    return await res.clone().json();
  } catch (_) {
    return null;
  }
}

function _relatedTaskStateIds(op) {
  const meta = op.meta || {};
  if (meta.local_task_id) return [_stringId(meta.local_task_id)];
  if (meta.task_id) return [_stringId(meta.task_id)];
  if (Array.isArray(meta.task_ids)) return meta.task_ids.map(_stringId);
  return [];
}

async function _hasNewerPendingTaskOp(taskId, op) {
  const pending = await _idbGetAll();
  return pending.some(other => {
    if ((other.ts || 0) <= (op.ts || 0)) return false;
    return _relatedTaskStateIds(other).includes(_stringId(taskId));
  });
}

function _replaceTaskIdInDom(oldId, newId) {
  for (const item of _findTaskItems(oldId)) {
    item.dataset.taskId = _stringId(newId);
    item.dataset.href = `/task/${newId}/`;
    item.querySelectorAll('.task-complete-btn').forEach(btn => { btn.dataset.taskId = _stringId(newId); });
    item.querySelectorAll('a[href]').forEach(a => {
      if (a.href.includes('/task/')) a.href = `/task/${newId}/`;
    });
  }
}

function _clearPendingTaskUi(taskId) {
  for (const item of _findTaskItems(taskId)) {
    item.classList.remove('task-item-pending');
    item.querySelectorAll('.task-local-hints').forEach(el => el.remove());
  }
}

async function _finalizeSyncedOp(op, data) {
  const meta = op.meta || {};
  if (meta.action === 'task_create' && meta.local_task_id) {
    if (data?.id) {
      _replaceTaskIdInDom(meta.local_task_id, data.id);
      _clearPendingTaskUi(data.id);
    }
  }

  for (const taskId of _relatedTaskStateIds(op)) {
    if (await _hasNewerPendingTaskOp(taskId, op)) continue;
    await _idbDeleteTaskState(taskId);
    _clearPendingTaskUi(taskId);
  }
}

async function syncPending() {
  const ops = (await _idbGetAll())
    .sort((a, b) => (a.ts || 0) - (b.ts || 0) || (a.id || 0) - (b.id || 0));
  if (ops.length === 0) return;

  showToast(`Synchronisation de ${ops.length} modification(s)…`, 8000);

  let synced = 0;
  let skipped = 0;
  for (const op of ops) {
    try {
      let res;
      if (op.type === 'json') {
        res = await fetch(op.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrf(),
            'X-Offline-Ts': _stringId(op.ts),
          },
          body: JSON.stringify(op.body),
        });
      } else {
        // form
        const fd = new FormData();
        fd.append('csrfmiddlewaretoken', getCsrf()); // token frais
        fd.append('offline_ts', _stringId(op.ts));
        for (const [k, v] of Object.entries(op.body || {})) fd.append(k, v);
        const headers = {};
        if (op.meta?.action === 'task_create') headers['X-Requested-With'] = 'XMLHttpRequest';
        res = await fetch(op.url, { method: 'POST', headers, body: fd });
      }

      if (res.ok || res.status === 404) {
        // 404 = ressource supprimée entre-temps → on saute silencieusement
        const data = res.status === 404 ? null : await _responseJsonOrNull(res);
        await _idbDelete(op.id);
        if (data?.status === 'skipped') skipped++;
        else if (data?.skipped) skipped += data.skipped;
        await _finalizeSyncedOp(op, data);
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
    const details = skipped ? ` (${skipped} ignorée(s), version serveur plus récente)` : '';
    showToast(`${synced} modification(s) synchronisée(s)${details} ✓`);
    await applyLocalTaskStates();
    if (skipped) {
      _pendingExternalRevision = _pendingExternalRevision || 'conflict';
      _showAppUpdatePrompt();
    } else {
      _queueLocalRevisionRefresh();
    }
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
  e.stopImmediatePropagation();

  const body = _formBody(form);
  const action = form.action || window.location.pathname;
  const label = form.dataset.offlineLabel || action;

  if (form.id === 'formAddTask') {
    await _handleOfflineTaskCreate(form, body, action);
    return;
  }

  if (form.id === 'formAddLabel') {
    await queueOfflineOp('/label/create/', 'form', body, 'Créer étiquette');
    document.getElementById('modalAddLabel')?.classList.remove('open');
    return;
  }

  if (form.id === 'formEditLabel') {
    const id = document.getElementById('editLabelId')?.value;
    const name = document.getElementById('editLabelName')?.value || '';
    const color = document.getElementById('editLabelColor')?.value || '#718096';
    await queueOfflineOp(`/label/${id}/edit/`, 'form', { name, color }, 'Modifier étiquette');
    document.getElementById('modalEditLabel')?.classList.remove('open');
    return;
  }

  if (form.id === 'taskEditForm') {
    await _handleOfflineTaskEdit(form, body, action);
    return;
  }

  if (form.id === 'deleteTaskForm') {
    await _handleOfflineTaskDelete(form, body, action);
    return;
  }

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
  await applyLocalTaskStates();

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
