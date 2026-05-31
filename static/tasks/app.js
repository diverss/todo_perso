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
function openAddTask(projectId, sectionId, parentId, titleHint) {
  document.getElementById('addTaskProjectId').value = projectId || '';
  document.getElementById('addTaskSectionId').value = sectionId || '';
  document.getElementById('addTaskParentId').value = parentId || '';
  if (titleHint) document.getElementById('modalAddTaskTitle').textContent = titleHint;
  openModal('modalAddTask');
  setTimeout(() => document.querySelector('#formAddTask input[name="title"]')?.focus(), 50);
}

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

/* ── Coller une image depuis le presse-papiers ── */
document.addEventListener('paste', async e => {
  const input = document.getElementById('imageUploadInput');
  if (!input) return; // pas sur une page tâche

  const items = [...(e.clipboardData?.items || [])];
  const imageItem = items.find(item => item.type.startsWith('image/'));
  if (!imageItem) return;

  e.preventDefault();
  const taskId = input.dataset.taskId;
  const file = imageItem.getAsFile();
  const ext = file.type.split('/')[1] || 'png';
  const fname = `capture-${Date.now()}.${ext}`;

  const fd = new FormData();
  fd.append('csrfmiddlewaretoken', getCsrf());
  fd.append('image', new File([file], fname, { type: file.type }));

  const res = await fetch(`/task/${taskId}/images/upload/`, { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) { showToast(`Erreur : ${data.error}`); return; }

  const textarea = document.querySelector('textarea[name="description"]');
  if (e.target === textarea) {
    // Insérer le lien Markdown à la position du curseur
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
  script.onload = () => { initSortable(); _initSidebarSortable(); };
  document.head.appendChild(script);
})();
