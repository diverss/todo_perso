/* app.js  chargé APRÈS pwa.js (getCsrf + queueOfflineOp sont disponibles) */

/* ── Modals ── */
function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}
function focusModalNameInput(id) {
  setTimeout(() => document.querySelector(`#${id} input[name="name"]`)?.focus(), 50);
}

function _isSafeLocalPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

function _currentProjectSectionId() {
  const board = document.getElementById('sectionsBoard');
  if (!board) return '';

  const activeTab = document.querySelector('.section-tab.active');
  const activeCol = activeTab ? board.querySelector(`.section-col[data-col="${activeTab.dataset.col}"]`) : null;
  if (activeCol?.dataset.sectionId) return activeCol.dataset.sectionId;

  const cols = [...board.querySelectorAll('.section-col')];
  if (!cols.length) return '';

  const left = board.scrollLeft;
  let closest = cols[0];
  let closestDistance = Math.abs(cols[0].offsetLeft - left);
  for (const col of cols.slice(1)) {
    const distance = Math.abs(col.offsetLeft - left);
    if (distance < closestDistance) {
      closest = col;
      closestDistance = distance;
    }
  }
  return closest?.dataset.sectionId || '';
}

function currentViewBackUrl() {
  const url = new URL(window.location.href);
  url.hash = '';

  const board = document.getElementById('sectionsBoard');
  if (board && /^\/project\/\d+\/$/.test(url.pathname)) {
    const sectionId = _currentProjectSectionId();
    if (sectionId) url.searchParams.set('section', sectionId);
    if (window.innerWidth > 700) {
      url.searchParams.set('scroll', String(Math.round(board.scrollLeft)));
    } else {
      url.searchParams.delete('scroll');
    }
  }

  return `${url.pathname}${url.search}`;
}
window.currentViewBackUrl = currentViewBackUrl;

function _taskHrefWithCurrentBack(href) {
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || !/^\/task\/\d+\/$/.test(url.pathname)) return href;
    if (/^\/inbox\/?$/.test(window.location.pathname) && !url.searchParams.has('back')) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    url.searchParams.set('back', currentViewBackUrl());
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (_) {
    return href;
  }
}

function _isPlainNavigationClick(e) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
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

/* ── Task item navigation ── */
document.addEventListener('click', e => {
  const item = e.target.closest('.task-item[data-href]');
  if (!item) return;
  if (e.target.closest('a, button, input, textarea, select, label, .drag-handle')) return;
  if (window.getSelection?.().toString()) return;
  window.location.href = _taskHrefWithCurrentBack(item.dataset.href);
});

document.addEventListener('click', e => {
  const link = e.target.closest('.task-item[data-href] a[href*="/task/"]');
  if (!link || !_isPlainNavigationClick(e) || link.target && link.target !== '_self') return;
  e.preventDefault();
  window.location.href = _taskHrefWithCurrentBack(link.getAttribute('href'));
});

/* ── Search field clear ── */
document.addEventListener('DOMContentLoaded', () => {
  const input = document.querySelector('.sidebar-search-input');
  const clearBtn = document.getElementById('sidebarSearchClear');
  if (!input || !clearBtn) return;

  function updateClearButton() {
    clearBtn.hidden = input.value.length === 0;
  }

  input.addEventListener('input', updateClearButton);
  clearBtn.addEventListener('click', () => {
    input.value = '';
    input.focus();
    updateClearButton();
  });
  updateClearButton();
});

/* ── Description links preview ── */
const DESCRIPTION_LINK_RE = /https?:\/\/[^\s<>"']+/gi;

function _trimUrlPunctuation(url) {
  let result = url.replace(/[.,;:!?]+$/g, '');
  const pairs = { ')': '(', ']': '[', '}': '{' };
  while (result.length && pairs[result.at(-1)]) {
    const close = result.at(-1);
    const open = pairs[close];
    const opens = [...result].filter(ch => ch === open).length;
    const closes = [...result].filter(ch => ch === close).length;
    if (closes <= opens) break;
    result = result.slice(0, -1);
  }
  return result;
}

function _extractDescriptionLinks(text) {
  const seen = new Set();
  const matches = text.match(DESCRIPTION_LINK_RE) || [];
  return matches
    .map(_trimUrlPunctuation)
    .filter(url => {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        if (seen.has(parsed.href)) return false;
        seen.add(parsed.href);
        return true;
      } catch (_) {
        return false;
      }
    });
}

function _renderDescriptionLinks(textarea) {
  const panel = document.getElementById(textarea.dataset.descriptionLinksTarget);
  const list = panel?.querySelector('.description-links-list');
  if (!panel || !list) return;

  list.innerHTML = '';
  const links = _extractDescriptionLinks(textarea.value);
  panel.hidden = links.length === 0;

  for (const url of links) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = url;
    list.appendChild(a);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('textarea[data-description-links-target]').forEach(textarea => {
    textarea.addEventListener('input', () => _renderDescriptionLinks(textarea));
    _renderDescriptionLinks(textarea);
  });
});

/* ── Textareas resize handle élargi ── */
const TEXTAREA_RESIZE_ZONE_W = 56;
const TEXTAREA_RESIZE_ZONE_H = 36;

function _isTextareaResizeZone(e, textarea) {
  const rect = textarea.getBoundingClientRect();
  return (
    e.clientX >= rect.right - TEXTAREA_RESIZE_ZONE_W &&
    e.clientX <= rect.right &&
    e.clientY >= rect.bottom - TEXTAREA_RESIZE_ZONE_H &&
    e.clientY <= rect.bottom
  );
}

let _textareaResizeHover = null;
document.addEventListener('pointermove', e => {
  const textarea = e.target.closest?.('textarea.form-textarea');
  const next = textarea && _isTextareaResizeZone(e, textarea) ? textarea : null;
  if (_textareaResizeHover === next) return;
  _textareaResizeHover?.classList.remove('resize-grip-hover');
  next?.classList.add('resize-grip-hover');
  _textareaResizeHover = next;
});

document.addEventListener('pointerdown', e => {
  const textarea = e.target.closest?.('textarea.form-textarea');
  if (!textarea || !_isTextareaResizeZone(e, textarea)) return;

  e.preventDefault();
  const startY = e.clientY;
  const startHeight = textarea.getBoundingClientRect().height;
  const minHeight = parseFloat(getComputedStyle(textarea).minHeight) || 70;

  textarea.classList.add('is-resizing');
  textarea.setPointerCapture?.(e.pointerId);

  function resize(moveEvt) {
    moveEvt.preventDefault();
    textarea.style.height = `${Math.max(minHeight, startHeight + moveEvt.clientY - startY)}px`;
  }

  function stop() {
    textarea.classList.remove('is-resizing');
    textarea.releasePointerCapture?.(e.pointerId);
    document.removeEventListener('pointermove', resize);
    document.removeEventListener('pointerup', stop);
    document.removeEventListener('pointercancel', stop);
  }

  document.addEventListener('pointermove', resize);
  document.addEventListener('pointerup', stop);
  document.addEventListener('pointercancel', stop);
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
  document.getElementById('addProjectBtn')?.addEventListener('click', () => {
    openModal('modalAddProject');
    focusModalNameInput('modalAddProject');
  });
  bindColorPresets('modalAddProject', 'projectColorInput');
  bindColorPresets('editProjectForm', 'editProjectColor');
});

/* ── Add Label modal ── */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('addLabelBtn')?.addEventListener('click', () => {
    openModal('modalAddLabel');
    focusModalNameInput('modalAddLabel');
  });
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
    const isCurrentLabel = window.location.pathname === `/label/${id}/`;
    if (!navigator.onLine) {
      await queueOfflineOp(`/label/${id}/delete/`, 'form', {}, 'Supprimer étiquette');
      closeModal('modalEditLabel');
      if (isCurrentLabel) location.href = '/';
      return;
    }
    const fd = new FormData();
    fd.append('csrfmiddlewaretoken', getCsrf());
    const res = await fetch(`/label/${id}/delete/`, { method: 'POST', body: fd });
    if (res.ok) {
      const data = await res.json();
      if (isCurrentLabel) location.href = data.default_url || '/';
      else location.reload();
    }
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
  sel.innerHTML = '<option value="">- Aucune -</option>';
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
  const backInput = document.getElementById('addTaskBack');
  if (backInput) backInput.value = currentViewBackUrl();
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

/* ── Recurring section tasks ── */
function _formatDisplayDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '');
}

function _directEmptyMessages(container) {
  return [...container.children].filter(child => child.classList.contains('task-list-empty'));
}

function _setHiddenInput(form, name, value) {
  let input = form.querySelector(`input[name="${name}"]`);
  if (!input) {
    input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    form.appendChild(input);
  }
  input.value = value;
}

function _preserveCurrentProjectView(form) {
  if (!window.currentViewBackUrl) return;
  const back = window.currentViewBackUrl();
  form.querySelectorAll('input[name="next"], input[name="back"]').forEach(input => {
    input.value = back;
  });
}

function _recurringList(sectionId) {
  return document.querySelector(`#modalRecurringTasks-${sectionId} .recurring-task-list`);
}

function _recurringRestoreAllButton(sectionId) {
  return document.querySelector(`#modalRecurringTasks-${sectionId} .recurring-restore-all-form button[type="submit"]`);
}

function _updateRecurringListState(sectionId) {
  const list = _recurringList(sectionId);
  if (!list) return;
  const hasTasks = Boolean(list.querySelector('.recurring-task-item'));
  _directEmptyMessages(list).forEach(el => el.remove());
  if (!hasTasks) {
    const empty = document.createElement('p');
    empty.className = 'task-list-empty';
    empty.textContent = 'Aucune tâche terminée dans cette section.';
    list.appendChild(empty);
  }
  const restoreAll = _recurringRestoreAllButton(sectionId);
  if (restoreAll) restoreAll.disabled = !hasTasks;
}

function _taskStateFromTaskItem(item) {
  const title = item.dataset.taskTitle || item.querySelector('.task-title')?.textContent?.trim() || '';
  return {
    id: item.dataset.taskId || '',
    title,
    project_id: item.dataset.projectId || '',
    section_id: item.dataset.sectionId || '',
    parent_id: item.dataset.parentId || '',
    priority: item.dataset.priority || '4',
    priority_color: item.dataset.priorityColor || '#555',
    label_id: item.dataset.labelId || '',
    label_name: item.dataset.labelName || '',
    label_color: item.dataset.labelColor || '',
    due_date: item.dataset.dueDate || '',
    order: item.dataset.order || '0',
  };
}

function _taskStateFromRecurringItem(item) {
  return {
    id: item.dataset.taskId || '',
    title: item.dataset.taskTitle || item.querySelector('.recurring-task-title')?.textContent?.trim() || '',
    project_id: item.dataset.projectId || '',
    section_id: item.dataset.sectionId || '',
    parent_id: item.dataset.parentId || '',
    priority: item.dataset.priority || '4',
    priority_color: item.dataset.priorityColor || '#555',
    label_id: item.dataset.labelId || '',
    label_name: item.dataset.labelName || '',
    label_color: item.dataset.labelColor || '',
    due_date: item.dataset.dueDate || '',
    order: item.dataset.order || '0',
  };
}

function _applyTaskDataset(item, state) {
  item.dataset.taskId = state.id;
  item.dataset.order = state.order || '0';
  item.dataset.taskTitle = state.title || '';
  item.dataset.projectId = state.project_id || '';
  item.dataset.sectionId = state.section_id || '';
  item.dataset.parentId = state.parent_id || '';
  item.dataset.priority = state.priority || '4';
  item.dataset.priorityColor = state.priority_color || '#555';
  item.dataset.labelId = state.label_id || '';
  item.dataset.labelName = state.label_name || '';
  item.dataset.labelColor = state.label_color || '';
  item.dataset.dueDate = state.due_date || '';
}

function _buildHiddenInput(name, value) {
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = name;
  input.value = value;
  return input;
}

function _buildRecurringActionForm(action, className, label, buttonClass) {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = action;
  form.className = className;
  form.dataset.preserveProjectView = '';
  form.appendChild(_buildHiddenInput('csrfmiddlewaretoken', getCsrf()));
  form.appendChild(_buildHiddenInput('back', currentViewBackUrl()));

  const button = document.createElement('button');
  button.type = 'submit';
  button.className = buttonClass;
  button.textContent = label;
  form.appendChild(button);
  return form;
}

function _buildRecurringTaskItem(state) {
  const item = document.createElement('div');
  item.className = 'recurring-task-item';
  _applyTaskDataset(item, state);

  const main = document.createElement('div');
  main.className = 'recurring-task-main';

  const title = document.createElement('span');
  title.className = 'recurring-task-title';
  title.textContent = state.title || '(sans titre)';
  main.appendChild(title);

  if (state.due_date) {
    const date = document.createElement('span');
    date.className = 'task-due-date';
    date.textContent = _formatDisplayDate(state.due_date);
    main.appendChild(date);
  }

  if (state.label_id) {
    const wrap = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'task-label-badge';
    badge.textContent = state.label_name || 'Étiquette';
    if (state.label_color) {
      badge.style.background = `${state.label_color}20`;
      badge.style.color = state.label_color;
    }
    wrap.appendChild(badge);
    main.appendChild(wrap);
  }

  const actions = document.createElement('div');
  actions.className = 'recurring-task-actions';
  actions.appendChild(_buildRecurringActionForm(`/task/${state.id}/restore/`, 'recurring-restore-form', 'Restaurer', 'btn btn-ghost btn-sm'));
  actions.appendChild(_buildRecurringActionForm(`/task/${state.id}/delete/`, 'recurring-delete-form', 'Supprimer', 'btn btn-danger btn-sm'));

  item.append(main, actions);
  return item;
}

function _buildRestoredTaskItem(state) {
  const item = document.createElement('div');
  item.className = 'task-item';
  item.dataset.href = `/task/${state.id}/`;
  _applyTaskDataset(item, state);

  const row = document.createElement('div');
  row.className = 'task-row';

  const completeBtn = document.createElement('button');
  completeBtn.type = 'button';
  completeBtn.className = 'task-complete-btn';
  completeBtn.dataset.taskId = state.id;
  completeBtn.title = 'Terminer';
  completeBtn.style.setProperty('--priority-color', state.priority_color || '#555');

  const titleLink = document.createElement('div');
  titleLink.className = 'task-title-link';
  const link = document.createElement('a');
  link.href = `/task/${state.id}/`;
  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = state.title || '(sans titre)';
  link.appendChild(title);
  if (state.due_date) {
    const date = document.createElement('span');
    date.className = 'task-due-date';
    date.textContent = _formatDisplayDate(state.due_date);
    link.appendChild(date);
  }
  titleLink.appendChild(link);

  if (state.label_id) {
    const wrap = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'task-label-badge';
    badge.textContent = state.label_name || 'Étiquette';
    if (state.label_color) {
      badge.style.background = `${state.label_color}20`;
      badge.style.color = state.label_color;
    }
    wrap.appendChild(badge);
    titleLink.appendChild(wrap);
  }

  const meta = document.createElement('div');
  meta.className = 'task-meta';

  const subtaskBtn = document.createElement('button');
  subtaskBtn.type = 'button';
  subtaskBtn.className = 'btn-icon task-add-subtask-btn';
  subtaskBtn.title = 'Ajouter une sous-tâche';
  subtaskBtn.textContent = '+';
  subtaskBtn.addEventListener('click', () => openAddTask(state.project_id, state.section_id, state.id, 'Sous-tâche'));

  const dragHandle = document.createElement('span');
  dragHandle.className = 'drag-handle';
  dragHandle.title = 'Déplacer';

  row.append(completeBtn, titleLink, meta, subtaskBtn, dragHandle);
  item.appendChild(row);
  return item;
}

function _addTaskToRecurringModal(taskItem) {
  if (!taskItem || taskItem.dataset.parentId) return;
  const sectionCol = taskItem.closest('.section-col[data-recurring="1"]');
  const sectionId = sectionCol?.dataset.sectionId;
  const list = sectionId ? _recurringList(sectionId) : null;
  if (!list) return;

  const state = _taskStateFromTaskItem(taskItem);
  if (!state.id) return;
  list.querySelector(`.recurring-task-item[data-task-id="${state.id}"]`)?.remove();
  _directEmptyMessages(list).forEach(el => el.remove());
  list.appendChild(_buildRecurringTaskItem(state));
  _updateRecurringListState(sectionId);
}

function _restoreTaskInProjectDom(state) {
  const list = document.getElementById(`taskList-${state.section_id}`);
  if (!list || list.querySelector(`.task-item[data-task-id="${state.id}"]`)) return;
  _directEmptyMessages(list).forEach(el => el.remove());
  list.appendChild(_buildRestoredTaskItem(state));
}

function _removeRecurringTaskRow(row) {
  const sectionId = row?.dataset.sectionId;
  row?.remove();
  if (sectionId) _updateRecurringListState(sectionId);
}

function _closeRecurringModalIfEmpty(sectionId) {
  const modal = document.getElementById(`modalRecurringTasks-${sectionId}`);
  if (!modal) return;
  if (!modal.querySelector('.recurring-task-item')) closeModal(modal.id);
}

async function _submitRecurringForm(form) {
  if (!navigator.onLine) return false;
  _preserveCurrentProjectView(form);
  const fd = new FormData(form);
  const res = await fetch(form.action, {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    body: fd,
  });
  if (!res.ok) {
    showToast('Erreur lors de la mise à jour des tâches récurrentes');
    return true;
  }
  const data = await res.json().catch(() => ({}));
  if (data.status === 'skipped') {
    showToast('Modification ignorée : version serveur plus récente');
    return true;
  }
  return true;
}

document.addEventListener('submit', async e => {
  const form = e.target;
  if (!form.matches?.('.recurring-restore-form, .recurring-restore-all-form, .recurring-delete-form')) return;
  if (e.defaultPrevented) return;

  e.preventDefault();
  if (form.classList.contains('recurring-delete-form') && !form.getAttribute('onsubmit')) {
    if (!confirm('Supprimer définitivement cette tâche ?')) return;
  }

  if (form.classList.contains('recurring-restore-all-form')) {
    const modal = form.closest('.modal-overlay');
    const sectionId = modal?.querySelector('.recurring-task-list')?.dataset.sectionId;
    const rows = [...modal.querySelectorAll('.recurring-task-item')];
    const states = rows.map(_taskStateFromRecurringItem);
    if (!(await _submitRecurringForm(form))) return;
    states.forEach(_restoreTaskInProjectDom);
    rows.forEach(_removeRecurringTaskRow);
    if (sectionId) closeModal(`modalRecurringTasks-${sectionId}`);
    return;
  }

  const row = form.closest('.recurring-task-item');
  const state = row ? _taskStateFromRecurringItem(row) : null;
  const sectionId = row?.dataset.sectionId;
  if (!(await _submitRecurringForm(form))) return;

  if (form.classList.contains('recurring-restore-form') && state) {
    _restoreTaskInProjectDom(state);
  }
  _removeRecurringTaskRow(row);
  if (sectionId) _closeRecurringModalIfEmpty(sectionId);
});

/* ── Complete task ── */
document.addEventListener('click', async e => {
  const btn = e.target.closest('.task-complete-btn');
  if (!btn || !btn.dataset.taskId) return;

  const taskId  = btn.dataset.taskId;
  const redirect = btn.dataset.redirect;
  const item = btn.closest('.task-item');

  // ── Hors-ligne : optimistic UI + mise en file ──
  if (!navigator.onLine || String(taskId).startsWith('local-')) {
    if (item && !String(taskId).startsWith('local-')) _addTaskToRecurringModal(item);
    if (window.completeTaskOffline) {
      await window.completeTaskOffline(taskId, item);
    } else {
      await queueOfflineOp(`/task/${taskId}/complete/`, 'form', {}, 'Terminer tâche');
      item?.remove();
    }
    if (!item && redirect) location.href = redirect;
    return;
  }

  const fd = new FormData();
  fd.append('csrfmiddlewaretoken', getCsrf());
  const res = await fetch(`/task/${taskId}/complete/`, { method: 'POST', body: fd });
  if (res.ok) {
    const item = btn.closest('.task-item');
    if (item) {
      _addTaskToRecurringModal(item);
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
    const back = task.redirect_url || fd.get('back');
    if (_isSafeLocalPath(back)) {
      location.href = back;
      return;
    }
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
    showToast(err.name === 'NotAllowedError' ? 'Permission refusée : autorisez le presse-papier' : 'Erreur presse-papier');
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
    id: el.dataset.taskId,
    order: i,
    section_id: sectionId || null,
    parent_id:  parentId  || null,
    element: el,
  }));
  const serverItems = items
    .filter(item => /^\d+$/.test(String(item.id)))
    .map(item => ({
      id: parseInt(item.id),
      order: item.order,
      section_id: item.section_id ? parseInt(item.section_id) : null,
      parent_id: item.parent_id ? parseInt(item.parent_id) : null,
    }));

  if (!navigator.onLine || serverItems.length !== items.length) {
    if (window.queueTaskReorderOffline) {
      await window.queueTaskReorderOffline('/task/reorder/', items, 'Réordonner tâches');
    } else {
      await queueOfflineOp('/task/reorder/', 'json', serverItems, 'Réordonner tâches');
    }
    return;
  }

  fetch('/task/reorder/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf() },
    body: JSON.stringify(serverItems),
  });
}

/* ── Sidebar sortable (projets + favoris + étiquettes) ── */
function _initSidebarSortable() {
  const lists = [
    { id: 'projectNavList',  url: '/project/reorder/' },
    { id: 'favoriteNavList', url: '/section/favorites/reorder/' },
    { id: 'labelNavList',    url: '/label/reorder/'   },
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
    onEnd: async () => {
      const items = [...list.querySelectorAll('.task-item')].map((el, i) => ({
        id: el.dataset.taskId,
        order: i,
        element: el,
      }));
      const serverItems = items
        .filter(item => /^\d+$/.test(String(item.id)))
        .map(item => ({ id: parseInt(item.id), order: item.order }));

      if (!navigator.onLine || serverItems.length !== items.length) {
        if (window.queueLabelTaskReorderOffline) {
          await window.queueLabelTaskReorderOffline(`/label/${labelId}/tasks/reorder/`, items, 'Réordonner tâches étiquette');
        } else {
          await queueOfflineOp(`/label/${labelId}/tasks/reorder/`, 'json', serverItems, 'Réordonner tâches étiquette');
        }
        return;
      }

      fetch(`/label/${labelId}/tasks/reorder/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf() },
        body: JSON.stringify(serverItems),
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

async function _obsDeleteHandle(id) {
  const db = await _openObsidianDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_OBS_STORE, 'readwrite');
    tx.objectStore(_OBS_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function _obsLoadHandles() {
  const db = await _openObsidianDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(_OBS_STORE, 'readonly').objectStore(_OBS_STORE).getAll();
    req.onsuccess = e => resolve(e.target.result.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)));
    req.onerror = () => reject(req.error);
  });
}

let _obsHandle = null;
let _obsEntries = {};
let _obsSelectedId = null;

function _obsSetSelectedHandle(handle, name, id = null) {
  _obsHandle = handle || null;
  _obsSelectedId = id;
  document.getElementById('obsidianChosenFile').textContent = name || '';
  document.getElementById('obsidianExportBtn').disabled = !_obsHandle;
  document.querySelectorAll('.obsidian-file-item').forEach(item => {
    const selected = parseInt(item.dataset.obsId) === _obsSelectedId;
    item.classList.toggle('selected', selected);
    const useBtn = item.querySelector('[data-obs-use-id]');
    if (useBtn) {
      useBtn.disabled = selected;
      useBtn.textContent = selected ? 'Choisi' : 'Utiliser';
    }
  });
}

function _obsRenderFileList(entries) {
  const recentSection = document.getElementById('obsidianRecentSection');
  const list = document.getElementById('obsidianFileList');
  list.innerHTML = '';
  _obsEntries = {};

  if (!entries.length) {
    recentSection.style.display = 'none';
    return;
  }

  entries.forEach(entry => {
    _obsEntries[entry.id] = entry;

    const item = document.createElement('div');
    item.className = 'obsidian-file-item';
    item.dataset.obsId = entry.id;

    const name = document.createElement('span');
    name.className = 'obsidian-file-name';
    name.textContent = entry.name;

    const actions = document.createElement('div');
    actions.className = 'obsidian-file-actions';

    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.className = 'btn btn-sm btn-ghost';
    useBtn.dataset.obsUseId = entry.id;
    useBtn.textContent = 'Utiliser';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-icon obsidian-remove-file';
    removeBtn.dataset.obsRemoveId = entry.id;
    removeBtn.title = 'Retirer de la liste';
    removeBtn.setAttribute('aria-label', `Retirer ${entry.name} de la liste`);
    removeBtn.textContent = '\u00d7';

    actions.append(useBtn, removeBtn);
    item.append(name, actions);
    list.appendChild(item);
  });

  recentSection.style.display = '';
  _obsSetSelectedHandle(_obsHandle, document.getElementById('obsidianChosenFile').textContent, _obsSelectedId);
}

async function _obsEnsureWritePermission(handle) {
  if (!handle?.queryPermission || !handle?.requestPermission) return 'granted';
  const opts = { mode: 'readwrite' };
  const current = await handle.queryPermission(opts);
  if (current === 'granted') return current;
  return handle.requestPermission(opts);
}

async function openExportObsidian() {
  _obsEntries = {};
  _obsSetSelectedHandle(null, '');

  try {
    const entries = await _obsLoadHandles();
    if (entries.length) _obsSetSelectedHandle(entries[0].handle, entries[0].name, entries[0].id);
    _obsRenderFileList(entries);
  } catch (_) {
    document.getElementById('obsidianRecentSection').style.display = 'none';
  }

  openModal('modalExportObsidian');
}

document.addEventListener('click', async e => {
  const removeBtn = e.target.closest('[data-obs-remove-id]');
  if (removeBtn) {
    const id = parseInt(removeBtn.dataset.obsRemoveId);
    const wasSelected = _obsSelectedId === id;
    try {
      await _obsDeleteHandle(id);
      const entries = await _obsLoadHandles();
      if (wasSelected) {
        const next = entries[0];
        _obsSetSelectedHandle(next?.handle, next?.name || '', next?.id || null);
      }
      _obsRenderFileList(entries);
      showToast('Fichier retiré de la liste');
    } catch (err) {
      showToast('Erreur : ' + err.message);
    }
    return;
  }

  const btn = e.target.closest('[data-obs-use-id]');
  if (!btn) return;
  const entry = _obsEntries[parseInt(btn.dataset.obsUseId)];
  if (!entry?.handle) return;
  try {
    const perm = await _obsEnsureWritePermission(entry.handle);
    if (perm !== 'granted') { showToast('Permission refusée'); return; }
    _obsSetSelectedHandle(entry.handle, entry.name, entry.id);
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
    _obsSetSelectedHandle(handle, handle.name);
  } catch (err) {
    if (err.name !== 'AbortError') showToast('Erreur : ' + err.message);
  }
}

async function confirmExportObsidian() {
  if (!_obsHandle) return;
  const task = JSON.parse(document.getElementById('obsidian-task-data').textContent);

  const blockLines = [`#### ${task.title}`];
  if (task.description.trim()) blockLines.push(task.description);
  for (const img of task.images) blockLines.push(`![${img.name}](${location.origin}${img.url})`);
  const block = blockLines.join('\n');

  try {
    const perm = await _obsEnsureWritePermission(_obsHandle);
    if (perm !== 'granted') { showToast('Permission refusée'); return; }
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

  try { await _obsSaveHandle(_obsHandle); } catch (_) {}

  const fd = new FormData();
  fd.append('csrfmiddlewaretoken', getCsrf());
  await fetch(`/task/${task.id}/complete/`, { method: 'POST', body: fd });

  closeModal('modalExportObsidian');
  showToast('Exporté et tâche terminée ✓');
  setTimeout(() => { location.href = task.back_url || task.project_url; }, 800);
}
