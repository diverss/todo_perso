/* app.js — chargé APRÈS pwa.js (getCsrf + queueOfflineOp sont disponibles) */

/* ── Modals ── */
function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

document.addEventListener('click', e => {
  const closeBtn = e.target.closest('.modal-close');
  if (closeBtn) {
    const modalId = closeBtn.dataset.modal;
    if (modalId) closeModal(modalId);
    closeBtn.closest('.modal-overlay')?.classList.remove('open');
    return;
  }
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
    return;
  }
  if (!e.target.closest('.dropdown')) closeAllDropdowns();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    closeAllDropdowns();
  }
});

/* ── Dropdowns ── */
function toggleDropdown(id) {
  const menu = document.getElementById(id);
  if (!menu) return;
  const wasOpen = menu.classList.contains('open');
  closeAllDropdowns();
  if (!wasOpen) menu.classList.add('open');
}
function closeDropdown(id) { document.getElementById(id)?.classList.remove('open'); }
function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-menu.open').forEach(d => d.classList.remove('open'));
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('projectMenuBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleDropdown('projectMenu');
  });
});

/* ── Add Project modal ── */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('addProjectBtn')?.addEventListener('click', () => openModal('modalAddProject'));
  bindColorPresets('modalAddProject', 'projectColorInput');
  bindColorPresets('editProjectForm', 'editProjectColor');
});

/* ── Add Label modal ── */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('addLabelBtn')?.addEventListener('click', () => openModal('modalAddLabel'));
  bindColorPresets('modalAddLabel', 'labelColorInput');

  document.getElementById('formAddLabel')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!navigator.onLine) {
      const fd = new FormData(e.target);
      await queueOfflineOp('/label/create/', 'form',
        { name: fd.get('name'), color: fd.get('color') }, 'Créer étiquette');
      closeModal('modalAddLabel');
      return;
    }
    const fd = new FormData(e.target);
    fd.append('csrfmiddlewaretoken', getCsrf());
    const res = await fetch('/label/create/', { method: 'POST', body: fd });
    if (res.ok) location.reload();
  });
});

/* ── Edit Label modal ── */
function openEditLabel(e, btn) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('editLabelId').value = btn.dataset.labelId;
  document.getElementById('editLabelName').value = btn.dataset.labelName;
  document.getElementById('editLabelColor').value = btn.dataset.labelColor;
  document.querySelectorAll('#editLabelColorPresets .color-preset').forEach(cp => {
    cp.classList.toggle('selected', cp.dataset.color === btn.dataset.labelColor);
  });
  bindColorPresets('modalEditLabel', 'editLabelColor');
  openModal('modalEditLabel');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('formEditLabel')?.addEventListener('submit', async e => {
    e.preventDefault();
    const id    = document.getElementById('editLabelId').value;
    const name  = document.getElementById('editLabelName').value;
    const color = document.getElementById('editLabelColor').value;
    if (!navigator.onLine) {
      await queueOfflineOp(`/label/${id}/edit/`, 'form', { name, color }, 'Modifier étiquette');
      closeModal('modalEditLabel');
      return;
    }
    const fd = new FormData();
    fd.append('csrfmiddlewaretoken', getCsrf());
    fd.append('name', name); fd.append('color', color);
    const res = await fetch(`/label/${id}/edit/`, { method: 'POST', body: fd });
    if (res.ok) location.reload();
  });

  document.getElementById('deleteLabelBtn')?.addEventListener('click', async () => {
    if (!confirm('Supprimer cette étiquette ?')) return;
    const id = document.getElementById('editLabelId').value;
    if (!navigator.onLine) {
      await queueOfflineOp(`/label/${id}/delete/`, 'form', {}, 'Supprimer étiquette');
      closeModal('modalEditLabel');
      return;
    }
    const fd = new FormData();
    fd.append('csrfmiddlewaretoken', getCsrf());
    const res = await fetch(`/label/${id}/delete/`, { method: 'POST', body: fd });
    if (res.ok) location.reload();
  });
});

/* ── Color presets ── */
function bindColorPresets(modalId, inputId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.querySelectorAll('.color-preset').forEach(cp => {
    cp.onclick = () => {
      modal.querySelectorAll('.color-preset').forEach(x => x.classList.remove('selected'));
      cp.classList.add('selected');
      document.getElementById(inputId).value = cp.dataset.color;
    };
  });
}

/* ── Add Task modal ── */
async function _loadSectionsIntoModal(projectId, preselectSectionId) {
  const sel = document.getElementById('addTaskSectionSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Aucune —</option>';
  if (!projectId) return;
  try {
    const res = await fetch(`/api/project/${projectId}/sections/`);
    const data = await res.json();
    for (const s of data.sections) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (String(s.id) === String(preselectSectionId)) opt.selected = true;
      sel.appendChild(opt);
    }
  } catch (_) {}
}

function openAddTask(projectId, sectionId, parentId, titleHint) {
  const projSel = document.getElementById('addTaskProjectSelect');
  if (projSel && projectId) projSel.value = projectId;
  document.getElementById('addTaskParentId').value = parentId || '';
  if (titleHint) document.getElementById('modalAddTaskTitle').textContent = titleHint;
  _clearPendingImages();
  _loadSectionsIntoModal(projectId, sectionId);
  openModal('modalAddTask');
  setTimeout(() => document.querySelector('#formAddTask input[name="title"]')?.focus(), 50);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('addTaskProjectSelect')?.addEventListener('change', e => {
    _loadSectionsIntoModal(e.target.value, null);
  });
});

/* ── Complete task ── */
document.addEventListener('click', async e => {
  const btn = e.target.closest('.task-complete-btn');
  if (!btn || !btn.dataset.taskId) return;

  const taskId  = btn.dataset.taskId;
  const redirect = btn.dataset.redirect;

  // ── Hors-ligne : optimistic UI + mise en file ──
  if (!navigator.onLine) {
    await queueOfflineOp(`/task/${taskId}/complete/`, 'form', {}, 'Terminer tâche');
    const item = btn.closest('.task-item');
    if (item) {
      item.style.transition = 'opacity .3s, transform .3s';
      item.style.opacity = '0';
      item.style.transform = 'translateX(20px)';
      setTimeout(() => item.remove(), 300);
    }
    return;
  }

  const fd = new FormData();
  fd.append('csrfmiddlewaretoken', getCsrf());
  const res = await fetch(`/task/${taskId}/complete/`, { method: 'POST', body: fd });
  if (res.ok) {
    const item = btn.closest('.task-item');
    if (item) {
      item.style.transition = 'opacity .3s, transform .3s';
      item.style.opacity = '0';
      item.style.transform = 'translateX(20px)';
      setTimeout(() => { item.remove(); if (redirect) location.href = redirect; }, 300);
    } else if (redirect) {
      location.href = redirect;
    }
  }
});

/* ── Images en attente (modale création de tâche) ── */
let _pendingImages = [];

function _addPendingImage(file) {
  _pendingImages.push(file);
  _renderPendingImages();
}

function _removePendingImage(idx) {
  _pendingImages.splice(idx, 1);
  _renderPendingImages();
}

function _clearPendingImages() {
  _pendingImages = [];
  _renderPendingImages();
}

function _renderPendingImages() {
  const grid = document.getElementById('pendingImagesGrid');
  const hint = document.getElementById('pendingImagesHint');
  if (!grid) return;
  grid.innerHTML = '';
  if (_pendingImages.length === 0) {
    grid.style.display = 'none';
    if (hint) hint.style.display = '';
    return;
  }
  grid.style.display = '';
  if (hint) hint.style.display = 'none';
  _pendingImages.forEach((file, idx) => {
    const url = URL.createObjectURL(file);
    const d = document.createElement('div');
    d.className = 'image-card';
    d.innerHTML = `
      <a href="${url}" target="_blank" class="image-thumb-link">
        <img src="${url}" alt="${file.name}" class="image-thumb">
      </a>
      <div class="image-footer">
        <span class="image-name" title="${file.name}">${file.name}</span>
        <div class="image-actions">
          <button class="btn-icon pending-img-remove" data-idx="${idx}" title="Retirer">&#10005;</button>
        </div>
      </div>`;
    grid.appendChild(d);
  });
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.pending-img-remove');
  if (!btn) return;
  _removePendingImage(parseInt(btn.dataset.idx));
});

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('addTaskImageInput')?.addEventListener('change', e => {
    [...e.target.files].forEach(_addPendingImage);
    e.target.value = '';
  });

  document.getElementById('formAddTask')?.addEventListener('submit', async e => {
    if (_pendingImages.length === 0) return; // submit classique
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const res = await fetch(form.action, {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: fd,
    });
    if (!res.ok) { showToast('Erreur lors de la création de la tâche'); return; }
    const task = await res.json();
    for (const file of _pendingImages) {
      const ifd = new FormData();
      ifd.append('csrfmiddlewaretoken', getCsrf());
      ifd.append('image', file);
      await fetch(`/task/${task.id}/images/upload/`, { method: 'POST', body: ifd });
    }
    const projectId = document.getElementById('addTaskProjectSelect')?.value;
    const sectionId = document.getElementById('addTaskSectionSelect')?.value;
    const parentId  = document.getElementById('addTaskParentId').value;
    if (parentId)      location.href = `/task/${parentId}/`;
    else if (sectionId) location.href = `/project/${projectId}/?section=${sectionId}`;
    else               location.href = `/project/${projectId}/`;
  });
});

/* ── Coller une image via le bouton (mobile) ── */
async function pasteImageFromClipboard(context) {
  if (!navigator.clipboard?.read) {
    showToast('Coller non supporté sur ce navigateur');
    return;
  }
  let items;
  try {
    items = await navigator.clipboard.read();
  } catch (err) {
    showToast(err.name === 'NotAllowedError' ? 'Permission refusée — autorisez le presse-papier' : 'Erreur presse-papier');
    return;
  }
  for (const item of items) {
    const imageType = item.types.find(t => t.startsWith('image/'));
    if (!imageType) continue;
    const blob = await item.getType(imageType);
    const ext = imageType.split('/')[1] || 'png';
    const fname = `capture-${Date.now()}.${ext}`;
    const file = new File([blob], fname, { type: imageType });
    if (context === 'modal') {
      _addPendingImage(file);
      showToast('Image ajoutée ✓');
    } else {
      const taskId = document.getElementById('imageUploadInput')?.dataset.taskId;
      if (!taskId) return;
      const fd = new FormData();
      fd.append('csrfmiddlewaretoken', getCsrf());
      fd.append('image', file);
      const res = await fetch(`/task/${taskId}/images/upload/`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { showToast(`Erreur : ${data.error}`); return; }
      document.getElementById('noImagesMsg')?.remove();
      _appendImageCard(data);
      showToast('Image collée ✓');
    }
    return;
  }
  showToast('Aucune image dans le presse-papier');
}

/* ── Coller une image depuis le presse-papiers (Ctrl+V desktop) ── */
document.addEventListener('paste', async e => {
  const taskDetailInput = document.getElementById('imageUploadInput');
  const modalOpen = document.getElementById('modalAddTask')?.classList.contains('open');

  if (!taskDetailInput && !modalOpen) return;

  const items = [...(e.clipboardData?.items || [])];
  const imageItem = items.find(item => item.type.startsWith('image/'));
  if (!imageItem) return;

  e.preventDefault();
  const file = imageItem.getAsFile();
  const ext = file.type.split('/')[1] || 'png';
  const fname = `capture-${Date.now()}.${ext}`;

  if (modalOpen) {
    _addPendingImage(new File([file], fname, { type: file.type }));
    showToast('Image ajoutée ✓');
    return;
  }

  // Page task_detail : upload direct
  const taskId = taskDetailInput.dataset.taskId;
  const fd = new FormData();
  fd.append('csrfmiddlewaretoken', getCsrf());
  fd.append('image', new File([file], fname, { type: file.type }));

  const res = await fetch(`/task/${taskId}/images/upload/`, { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) { showToast(`Erreur : ${data.error}`); return; }

  const textarea = document.querySelector('textarea[name="description"]');
  if (e.target === textarea) {
    const md = `![${data.filename}](${location.origin}${data.url})`;
    const s = textarea.selectionStart;
    textarea.value = textarea.value.slice(0, s) + md + textarea.value.slice(textarea.selectionEnd);
    textarea.selectionStart = textarea.selectionEnd = s + md.length;
    showToast('Image insérée dans la description ✓');
  } else {
    document.getElementById('noImagesMsg')?.remove();
    _appendImageCard(data);
    showToast('Image ajoutée à la galerie ✓');
  }
});

/* ── Sidebar toggle (desktop + mobile) ── */
document.addEventListener('DOMContentLoaded', () => {
  const sidebar   = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebarToggle');
  const showBtn   = document.getElementById('sidebarShowBtn');
  const mobileBtn = document.getElementById('mobileMenuBtn');
  const backdrop  = document.getElementById('sidebarBackdrop');

  toggleBtn?.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  showBtn?.addEventListener('click', () => sidebar.classList.remove('collapsed'));

  function openMobile()  { sidebar.classList.add('mobile-open'); backdrop.classList.add('active'); }
  function closeMobile() { sidebar.classList.remove('mobile-open'); backdrop.classList.remove('active'); }

  mobileBtn?.addEventListener('click', openMobile);
  backdrop?.addEventListener('click', closeMobile);
  sidebar?.querySelectorAll('.nav-item').forEach(a =>
    a.addEventListener('click', () => { if (window.innerWidth <= 700) closeMobile(); })
  );
});

/* ── Drag & Drop (SortableJS) ── */
let sortableInstances = [];

function initSortable() {
  sortableInstances.forEach(s => s.destroy());
  sortableInstances = [];
  document.querySelectorAll('.task-list-container').forEach(list => {
    sortableInstances.push(Sortable.create(list, {
      group: 'tasks', animation: 150,
      ghostClass: 'sortable-ghost', dragClass: 'sortable-drag',
      handle: '.drag-handle',
      onEnd: saveOrder,
    }));
  });
}

async function saveOrder(evt) {
  const list = evt.to;
  const sectionId = list.dataset.section || null;
  const parentId  = list.dataset.parent  || null;

  const items = [...list.querySelectorAll(':scope > .task-item')].map((el, i) => ({
    id: parseInt(el.dataset.taskId),
    order: i,
    section_id: sectionId ? parseInt(sectionId) : null,
    parent_id:  parentId  ? parseInt(parentId)  : null,
  }));

  if (!navigator.onLine) {
    await queueOfflineOp('/task/reorder/', 'json', items, 'Réordonner tâches');
    return;
  }

  fetch('/task/reorder/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf() },
    body: JSON.stringify(items),
  });
}

/* ── Sidebar sortable (projets + étiquettes) ── */
function _initSidebarSortable() {
  const lists = [
    { id: 'projectNavList', url: '/project/reorder/' },
    { id: 'labelNavList',   url: '/label/reorder/'   },
  ];
  lists.forEach(({ id, url }) => {
    const el = document.getElementById(id);
    if (!el || typeof Sortable === 'undefined') return;
    Sortable.create(el, {
      animation: 150,
      handle: '.nav-drag-handle',
      ghostClass: 'nav-item-ghost',
      onEnd: () => {
        const order = [...el.querySelectorAll('[data-id]')].map((a, i) => ({
          id: parseInt(a.dataset.id), order: i,
        }));
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf() },
          body: JSON.stringify(order),
        });
      },
    });
  });
}

/* ── Tri vue étiquette ── */
function _initLabelSortable() {
  const list = document.getElementById('labelTaskList');
  if (!list) return;
  const labelId = list.dataset.labelId;
  Sortable.create(list, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    dragClass: 'sortable-drag',
    delay: 150,
    delayOnTouchOnly: true,
    onEnd: () => {
      const items = [...list.querySelectorAll('.task-item')].map((el, i) => ({
        id: parseInt(el.dataset.taskId), order: i,
      }));
      fetch(`/label/${labelId}/tasks/reorder/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf() },
        body: JSON.stringify(items),
      });
    },
  });
}

/* ── Images ── */
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('imageUploadInput');
  if (!input) return;
  const taskId = input.dataset.taskId;

  input.addEventListener('change', async () => {
    for (const file of input.files) {
      const fd = new FormData();
      fd.append('csrfmiddlewaretoken', getCsrf());
      fd.append('image', file);
      const res = await fetch(`/task/${taskId}/images/upload/`, { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok) {
        document.getElementById('noImagesMsg')?.remove();
        _appendImageCard(data);
      } else {
        showToast(`Erreur : ${data.error}`);
      }
    }
    input.value = '';
  });
});

function _appendImageCard(img) {
  const grid = document.getElementById('imagesGrid');
  if (!grid) return;
  const d = document.createElement('div');
  d.className = 'image-card';
  d.id = `imgCard-${img.id}`;
  d.innerHTML = `
    <a href="${img.url}" target="_blank" class="image-thumb-link">
      <img src="${img.url}" alt="${img.filename}" class="image-thumb">
    </a>
    <div class="image-footer">
      <span class="image-name" title="${img.filename}">${img.filename}</span>
      <div class="image-actions">
        <button class="btn-icon copy-md-btn" data-url="${img.url}" data-name="${img.filename}" title="Copier lien Markdown">&#9113;</button>
        <button class="btn-icon delete-image-btn" data-image-id="${img.id}" title="Supprimer">&#10005;</button>
      </div>
    </div>`;
  grid.appendChild(d);
}

// Copier lien Markdown
document.addEventListener('click', e => {
  const btn = e.target.closest('.copy-md-btn');
  if (!btn) return;
  const md = `![${btn.dataset.name}](${location.origin}${btn.dataset.url})`;
  navigator.clipboard.writeText(md).then(() => showToast('Lien Markdown copié !'));
});

// Supprimer image
document.addEventListener('click', async e => {
  const btn = e.target.closest('.delete-image-btn');
  if (!btn) return;
  if (!confirm('Supprimer cette image ?')) return;
  const fd = new FormData();
  fd.append('csrfmiddlewaretoken', getCsrf());
  const res = await fetch(`/task/images/${btn.dataset.imageId}/delete/`, { method: 'POST', body: fd });
  if (res.ok) document.getElementById(`imgCard-${btn.dataset.imageId}`)?.remove();
});

(function loadSortable() {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.3/Sortable.min.js';
  script.onload = () => { initSortable(); _initSidebarSortable(); _initLabelSortable(); };
  document.head.appendChild(script);
})();

/* ════════════════════════════════════════════
 *  Export Obsidian
 * ════════════════════════════════════════════ */

const _OBS_IDB = 'todo-obsidian';
const _OBS_STORE = 'files';

function _openObsidianDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_OBS_IDB, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(_OBS_STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function _obsSaveHandle(handle) {
  const db = await _openObsidianDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_OBS_STORE, 'readwrite');
    const store = tx.objectStore(_OBS_STORE);
    store.getAll().onsuccess = e => {
      const existing = e.target.result.find(r => r.name === handle.name);
      if (existing) store.put({ id: existing.id, name: handle.name, handle, lastUsed: Date.now() });
      else store.add({ name: handle.name, handle, lastUsed: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
  });
}

async function _obsLoadHandles() {
  const db = await _openObsidianDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(_OBS_STORE, 'readonly').objectStore(_OBS_STORE).getAll();
    req.onsuccess = e => resolve(e.target.result.sort((a, b) => b.lastUsed - a.lastUsed));
    req.onerror = () => reject(req.error);
  });
}

let _obsHandle = null;
let _obsEntries = {};

async function openExportObsidian() {
  _obsHandle = null;
  _obsEntries = {};
  document.getElementById('obsidianExportBtn').disabled = true;
  document.getElementById('obsidianChosenFile').textContent = '';

  const recentSection = document.getElementById('obsidianRecentSection');
  const list = document.getElementById('obsidianFileList');
  list.innerHTML = '';

  try {
    const entries = await _obsLoadHandles();
    if (entries.length > 0) {
      entries.forEach(entry => {
        _obsEntries[entry.id] = entry;
        const d = document.createElement('div');
        d.className = 'obsidian-file-item';
        d.innerHTML = `<span class="obsidian-file-name">&#128196; ${entry.name}</span>
          <button class="btn btn-sm btn-ghost" data-obs-id="${entry.id}">Utiliser</button>`;
        list.appendChild(d);
      });
      recentSection.style.display = '';
    } else {
      recentSection.style.display = 'none';
    }
  } catch (_) {
    recentSection.style.display = 'none';
  }

  openModal('modalExportObsidian');
}

document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-obs-id]');
  if (!btn) return;
  const entry = _obsEntries[parseInt(btn.dataset.obsId)];
  if (!entry?.handle) return;
  try {
    const perm = await entry.handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') { showToast('Permission refusée'); return; }
    _obsHandle = entry.handle;
    document.getElementById('obsidianChosenFile').textContent = entry.name;
    document.getElementById('obsidianExportBtn').disabled = false;
  } catch (err) {
    showToast('Erreur : ' + err.message);
  }
});

async function pickObsidianFile() {
  if (!window.showOpenFilePicker) {
    showToast('Nécessite Chrome ou Edge (bureau)');
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Markdown', accept: { 'text/plain': ['.md'] } }],
    });
    await _obsSaveHandle(handle);
    _obsHandle = handle;
    document.getElementById('obsidianChosenFile').textContent = handle.name;
    document.getElementById('obsidianExportBtn').disabled = false;
    // Rafraîchir la liste
    const entries = await _obsLoadHandles();
    const list = document.getElementById('obsidianFileList');
    list.innerHTML = '';
    _obsEntries = {};
    entries.forEach(entry => {
      _obsEntries[entry.id] = entry;
      const d = document.createElement('div');
      d.className = 'obsidian-file-item';
      d.innerHTML = `<span class="obsidian-file-name">&#128196; ${entry.name}</span>
        <button class="btn btn-sm btn-ghost" data-obs-id="${entry.id}">Utiliser</button>`;
      list.appendChild(d);
    });
    document.getElementById('obsidianRecentSection').style.display = '';
  } catch (err) {
    if (err.name !== 'AbortError') showToast('Erreur : ' + err.message);
  }
}

async function confirmExportObsidian() {
  if (!_obsHandle) return;
  const task = JSON.parse(document.getElementById('obsidian-task-data').textContent);

  const dateStr = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  let block = `\n## ${task.title}\n_${dateStr}_\n`;
  if (task.description.trim()) block += `\n${task.description}\n`;
  for (const img of task.images) {
    block += `\n![${img.name}](${location.origin}${img.url})\n`;
  }
  block += '\n---\n';

  try {
    const file = await _obsHandle.getFile();
    const lines = (await file.text()).split('\n');
    lines.splice(0, 0, block);
    const writable = await _obsHandle.createWritable();
    await writable.write(lines.join('\n'));
    await writable.close();
  } catch (err) {
    showToast('Erreur écriture : ' + err.message);
    return;
  }

  const fd = new FormData();
  fd.append('csrfmiddlewaretoken', getCsrf());
  await fetch(`/task/${task.id}/complete/`, { method: 'POST', body: fd });

  closeModal('modalExportObsidian');
  showToast('Exporté et tâche terminée ✓');
  setTimeout(() => { location.href = task.back_url || task.project_url; }, 800);
}
