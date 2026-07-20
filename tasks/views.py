import json
import mimetypes
import os
from datetime import datetime, timezone as dt_timezone
from django.shortcuts import render, get_object_or_404, redirect
from django.http import FileResponse, Http404, JsonResponse, HttpResponse
from django.contrib.auth import authenticate, login as auth_login, logout as auth_logout
from django.urls import reverse
from django.views.decorators.http import require_POST
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.db.models import Max, Q
from django.conf import settings as django_settings

from .models import Project, Section, Task, Label, AppSettings, TaskImage


def _get_inbox(user):
    inbox, _ = Project.objects.get_or_create(
        user=user,
        is_inbox=True,
        defaults={'name': 'A trier', 'color': '#718096', 'order': 9999}
    )
    return inbox


def _sidebar_context(user):
    inbox = _get_inbox(user)
    return {
        'projects': Project.objects.filter(user=user, is_inbox=False),
        'labels': Label.objects.filter(user=user),
        'favorite_sections': Section.objects.filter(user=user, is_favorite=True).select_related('project').order_by(
            'favorite_order', 'project__order', 'project__name', 'order', 'name', 'pk'
        ),
        'inbox': inbox,
        'inbox_task_count': Task.objects.filter(user=user, project=inbox, completed=False, parent__isnull=True).count(),
    }


def _normalize_favorite_order(user):
    sections = list(
        Section.objects
        .filter(user=user, is_favorite=True)
        .select_related('project')
        .order_by('favorite_order', 'project__order', 'project__name', 'order', 'name', 'pk')
    )
    changed = []
    for order, section in enumerate(sections):
        if section.favorite_order != order:
            section.favorite_order = order
            changed.append(section)

    if changed:
        Section.objects.bulk_update(changed, ['favorite_order'])


def _move_section_to_end_if_empty(section_id, user):
    if not section_id:
        return

    section = Section.objects.filter(pk=section_id, user=user).first()
    if not section:
        return

    has_visible_tasks = Task.objects.filter(
        user=user,
        project_id=section.project_id,
        section_id=section.pk,
        completed=False,
        parent__isnull=True,
    ).exists()
    if has_visible_tasks:
        return

    sections = list(
        Section.objects
        .filter(user=user, project_id=section.project_id)
        .order_by('order', 'name', 'pk')
    )
    if not sections or sections[-1].pk == section.pk:
        return

    ordered_sections = [s for s in sections if s.pk != section.pk] + [section]
    changed = []
    for order, item in enumerate(ordered_sections):
        if item.order != order:
            item.order = order
            changed.append(item)

    if changed:
        Section.objects.bulk_update(changed, ['order'])


def _as_int_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _offline_operation_datetime(request):
    raw = request.POST.get('offline_ts') or request.headers.get('X-Offline-Ts')
    if not raw:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value > 10_000_000_000:
        value = value / 1000
    try:
        return datetime.fromtimestamp(value, tz=dt_timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _operation_datetime(request):
    return _offline_operation_datetime(request) or timezone.now()


def _parse_due_date(value):
    if not value:
        return None
    return parse_date(value)


def _local_redirect_url(value):
    if value and value.startswith('/') and not value.startswith('//'):
        return value
    return ''


def _is_stale_task_operation(request, task):
    op_dt = _offline_operation_datetime(request)
    return bool(op_dt and task.updated_at and op_dt < task.updated_at)


def _stale_task_response():
    return JsonResponse({'status': 'skipped', 'reason': 'newer_server_version'})


def _owned_int_id(model, user, value, **filters):
    item_id = _as_int_id(value)
    if item_id is None:
        return None
    return (
        model.objects
        .filter(pk=item_id, user=user, **filters)
        .values_list('pk', flat=True)
        .first()
    )


def project_view(request, project_id):
    project = get_object_or_404(Project, pk=project_id, user=request.user)
    sections = list(project.sections.filter(user=request.user))
    recurring_section_ids = [section.pk for section in sections if section.has_recurring_tasks]
    completed_tasks_by_section = {section_id: [] for section_id in recurring_section_ids}
    if recurring_section_ids:
        completed_tasks = (
            Task.objects
            .filter(
                user=request.user,
                project=project,
                section_id__in=recurring_section_ids,
                completed=True,
                parent__isnull=True,
            )
            .select_related('label')
            .order_by('section_id', 'order', 'created_at')
        )
        for task in completed_tasks:
            completed_tasks_by_section.setdefault(task.section_id, []).append(task)
    for section in sections:
        section.completed_recurring_tasks = completed_tasks_by_section.get(section.pk, [])
    tasks_no_section = project.tasks.filter(
        user=request.user, completed=False, parent__isnull=True, section__isnull=True
    )
    ctx = _sidebar_context(request.user)
    ctx.update({
        'project': project,
        'sections': sections,
        'tasks_no_section': tasks_no_section,
        'all_projects': Project.objects.filter(user=request.user, is_inbox=False),
    })
    return render(request, 'tasks/project.html', ctx)


def index(request):
    s = AppSettings.load(request.user)
    if (
        s.default_view_type == AppSettings.VIEW_PROJECT
        and s.default_project_id
        and s.default_project.user_id == request.user.pk
    ):
        return redirect('project', project_id=s.default_project_id)
    if (
        s.default_view_type == AppSettings.VIEW_LABEL
        and s.default_label_id
        and s.default_label.user_id == request.user.pk
    ):
        return redirect('label', label_id=s.default_label_id)
    first_project = Project.objects.filter(user=request.user, is_inbox=False).first()
    if first_project:
        return redirect('project', project_id=first_project.pk)
    return render(request, 'tasks/empty.html', _sidebar_context(request.user))


def inbox_view(request):
    inbox = _get_inbox(request.user)
    tasks = Task.objects.filter(
        user=request.user, project=inbox, completed=False, parent__isnull=True
    ).order_by('order', 'created_at')
    ctx = _sidebar_context(request.user)
    ctx.update({'inbox': inbox, 'tasks': tasks})
    return render(request, 'tasks/inbox.html', ctx)


def label_view(request, label_id):
    from django.db.models import F
    label = get_object_or_404(Label, pk=label_id, user=request.user)
    tasks = Task.objects.filter(
        user=request.user, label=label, completed=False, parent__isnull=True
    ).select_related('project', 'section').order_by(
        F('label_order').asc(nulls_last=True), 'order', 'created_at'
    )
    ctx = _sidebar_context(request.user)
    ctx.update({'label': label, 'tasks': tasks})
    return render(request, 'tasks/label.html', ctx)


def search_view(request):
    query = request.GET.get('q', '').strip()
    tasks = Task.objects.none()

    if query:
        tasks = (
            Task.objects
            .filter(user=request.user, completed=False)
            .filter(
                Q(title__icontains=query) |
                Q(description__icontains=query) |
                Q(project__name__icontains=query) |
                Q(section__name__icontains=query) |
                Q(label__name__icontains=query)
            )
            .select_related('project', 'section', 'label', 'parent')
            .order_by('project__order', 'project__name', 'section__order', 'section__name', 'order', 'created_at')
        )

    ctx = _sidebar_context(request.user)
    ctx.update({'query': query, 'tasks': tasks})
    return render(request, 'tasks/search.html', ctx)


# --- Projects CRUD ---

@require_POST
def project_create(request):
    name = request.POST.get('name', '').strip()
    color = request.POST.get('color', '#5b8def')
    if not name:
        return redirect('index')
    order = Project.objects.filter(user=request.user).count()
    project = Project.objects.create(user=request.user, name=name, color=color, order=order)
    return redirect('project', project_id=project.pk)


@require_POST
def project_edit(request, project_id):
    project = get_object_or_404(Project, pk=project_id, user=request.user)
    project.name = request.POST.get('name', project.name).strip()
    project.color = request.POST.get('color', project.color)
    project.save()
    return redirect('project', project_id=project.pk)


@require_POST
def project_delete(request, project_id):
    project = get_object_or_404(Project, pk=project_id, user=request.user)
    if project.is_inbox:
        return redirect('inbox')
    project.delete()
    return redirect('index')


# --- Sections CRUD ---

@require_POST
def section_create(request, project_id):
    project = get_object_or_404(Project, pk=project_id, user=request.user)
    name = request.POST.get('name', '').strip()
    if name:
        order = project.sections.filter(user=request.user).count()
        Section.objects.create(
            user=request.user,
            name=name,
            project=project,
            order=order,
            has_recurring_tasks=request.POST.get('has_recurring_tasks') == '1',
        )
    return redirect('project', project_id=project.pk)


@require_POST
def section_edit(request, section_id):
    section = get_object_or_404(Section, pk=section_id, user=request.user)
    if request.POST.get('move_to_project'):
        origin_project_id = section.project_id
        new_project = get_object_or_404(Project, pk=request.POST.get('project_id'), user=request.user)
        section.project = new_project
        section.order = new_project.sections.filter(user=request.user).count()
        section.save()
        return redirect('project', project_id=origin_project_id)
    section.name = request.POST.get('name', section.name).strip()
    section.save()
    return redirect('project', project_id=section.project.pk)


@require_POST
def section_delete(request, section_id):
    section = get_object_or_404(Section, pk=section_id, user=request.user)
    project_id = section.project.pk
    section.delete()
    _normalize_favorite_order(request.user)
    return redirect('project', project_id=project_id)


@require_POST
def section_toggle_favorite(request, section_id):
    section = get_object_or_404(Section, pk=section_id, user=request.user)

    if section.is_favorite:
        section.is_favorite = False
        section.favorite_order = 0
    else:
        max_order = Section.objects.filter(user=request.user, is_favorite=True).aggregate(Max('favorite_order'))['favorite_order__max']
        section.is_favorite = True
        section.favorite_order = 0 if max_order is None else max_order + 1

    section.save(update_fields=['is_favorite', 'favorite_order'])
    if not section.is_favorite:
        _normalize_favorite_order(request.user)

    next_url = request.POST.get('next', '')
    if next_url.startswith('/'):
        return redirect(next_url)
    return redirect('project', project_id=section.project_id)


@require_POST
def section_restore_completed_tasks(request, section_id):
    section = get_object_or_404(Section, pk=section_id, user=request.user, has_recurring_tasks=True)
    op_dt = _operation_datetime(request)
    parent_tasks = Task.objects.filter(
        user=request.user,
        project=section.project,
        section=section,
        completed=True,
        parent__isnull=True,
    )
    parent_ids = list(parent_tasks.values_list('pk', flat=True))
    restored = parent_tasks.update(completed=False, completed_at=None, updated_at=op_dt)
    if parent_ids:
        Task.objects.filter(user=request.user, parent_id__in=parent_ids, completed=True).update(
            completed=False,
            completed_at=None,
            updated_at=op_dt,
        )

    back = _local_redirect_url(request.POST.get('back', ''))
    if back:
        return redirect(back)
    return redirect(reverse('project', args=[section.project_id]) + f'?section={section.pk}')


# --- Tasks CRUD ---

@require_POST
def task_create(request):
    title = request.POST.get('title', '').strip()
    if not title:
        return JsonResponse({'error': 'title required'}, status=400)

    project_id = request.POST.get('project_id')
    section_id = request.POST.get('section_id') or None
    parent_id = request.POST.get('parent_id') or None
    priority = int(request.POST.get('priority', 4))
    label_id = request.POST.get('label_id') or None

    project = get_object_or_404(Project, pk=project_id, user=request.user)
    section = (
        get_object_or_404(Section, pk=section_id, user=request.user, project=project)
        if section_id else None
    )
    parent = get_object_or_404(Task, pk=parent_id, user=request.user, project=project) if parent_id else None
    label = get_object_or_404(Label, pk=label_id, user=request.user) if label_id else None
    op_dt = _operation_datetime(request)
    completed = request.POST.get('completed') == '1'

    qs = Task.objects.filter(user=request.user, project=project, section=section, parent=parent)
    order = qs.count()

    task = Task.objects.create(
        user=request.user,
        title=title,
        description=request.POST.get('description', ''),
        priority=priority,
        label=label,
        due_date=_parse_due_date(request.POST.get('due_date')),
        project=project,
        section=section,
        parent=parent,
        order=order,
        completed=completed,
        completed_at=op_dt if completed else None,
        updated_at=op_dt,
    )

    back = _local_redirect_url(request.POST.get('back', ''))

    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return JsonResponse({'id': task.pk, 'title': task.title, 'redirect_url': back})

    if back:
        return redirect(back)
    if parent:
        return redirect('task_detail', task_id=parent.pk)
    if section:
        return redirect(reverse('project', args=[project.pk]) + f'?section={section.pk}')
    if project.is_inbox:
        return redirect('inbox')
    return redirect('project', project_id=project.pk)


def task_detail(request, task_id):
    task = get_object_or_404(Task, pk=task_id, user=request.user)
    subtasks = task.subtasks.filter(user=request.user, completed=False)
    back_url = _local_redirect_url(request.GET.get('back', ''))
    if not back_url and task.project.is_inbox and task.parent is None:
        ids = list(
            Task.objects.filter(project=task.project, completed=False, parent__isnull=True)
            .filter(user=request.user)
            .order_by('order', 'created_at')
            .values_list('pk', flat=True)
        )
        try:
            idx = ids.index(task.pk)
            back_url = f'/task/{ids[idx + 1]}/' if idx + 1 < len(ids) else '/inbox/'
        except ValueError:
            back_url = '/inbox/'
    ctx = _sidebar_context(request.user)
    ctx.update({
        'task': task,
        'subtasks': subtasks,
        'projects': Project.objects.filter(user=request.user, is_inbox=False),
        'sections': Section.objects.filter(user=request.user, project=task.project),
        'parent_tasks': Task.objects.filter(user=request.user, project=task.project, completed=False, parent__isnull=True),
        'back_url': back_url,
        'task_export_data': {
            'id': task.pk,
            'title': task.title,
            'description': task.description,
            'images': [{'url': img.image.url, 'name': img.original_filename} for img in task.images.all()],
            'back_url': back_url,
            'project_url': f'/project/{task.project.pk}/',
        },
    })
    return render(request, 'tasks/task_detail.html', ctx)


@require_POST
def task_edit(request, task_id):
    task = get_object_or_404(Task, pk=task_id, user=request.user)
    if _is_stale_task_operation(request, task):
        return _stale_task_response()

    old_section_id = task.section_id
    old_parent_id = task.parent_id
    old_completed = task.completed
    op_dt = _operation_datetime(request)

    task.title = request.POST.get('title', task.title).strip()
    task.description = request.POST.get('description', task.description)
    task.priority = int(request.POST.get('priority', task.priority))
    task.due_date = _parse_due_date(request.POST.get('due_date'))

    label_id = request.POST.get('label_id') or None
    task.label = get_object_or_404(Label, pk=label_id, user=request.user) if label_id else None

    project_id = request.POST.get('project_id')
    if project_id:
        task.project = get_object_or_404(Project, pk=project_id, user=request.user)

    section_id = request.POST.get('section_id') or None
    task.section = (
        get_object_or_404(Section, pk=section_id, user=request.user, project=task.project)
        if section_id else None
    )

    parent_id = request.POST.get('parent_id') or None
    task.parent = get_object_or_404(Task, pk=parent_id, user=request.user, project=task.project) if parent_id else None

    task.user = request.user
    task.updated_at = op_dt
    task.save()
    if old_section_id and old_parent_id is None and not old_completed:
        _move_section_to_end_if_empty(old_section_id, request.user)

    back = _local_redirect_url(request.POST.get('back', ''))
    if back:
        return redirect(back)
    if task.parent_id:
        return redirect('task_detail', task_id=task.parent_id)
    return redirect('project', project_id=task.project_id)


@require_POST
def task_complete(request, task_id):
    task = get_object_or_404(Task, pk=task_id, user=request.user)
    if _is_stale_task_operation(request, task):
        return _stale_task_response()

    old_section_id = task.section_id if task.parent_id is None else None
    op_dt = _operation_datetime(request)

    task.completed = True
    task.completed_at = op_dt
    task.updated_at = op_dt
    task.save()
    task.subtasks.filter(user=request.user, completed=False).update(completed=True, completed_at=op_dt, updated_at=op_dt)
    _move_section_to_end_if_empty(old_section_id, request.user)
    return JsonResponse({'status': 'ok'})


@require_POST
def task_delete(request, task_id):
    task = get_object_or_404(Task, pk=task_id, user=request.user)
    if _is_stale_task_operation(request, task):
        return _stale_task_response()

    project_id = task.project.pk
    parent_id = task.parent.pk if task.parent else None
    old_section_id = task.section_id if task.parent_id is None and not task.completed else None

    back = _local_redirect_url(request.POST.get('back', ''))
    task.delete()
    _move_section_to_end_if_empty(old_section_id, request.user)

    if back:
        return redirect(back)
    if parent_id:
        return redirect('task_detail', task_id=parent_id)
    return redirect('project', project_id=project_id)


@require_POST
def task_restore(request, task_id):
    task = get_object_or_404(
        Task.objects.select_related('section', 'project'),
        pk=task_id,
        user=request.user,
        completed=True,
        parent__isnull=True,
        section__has_recurring_tasks=True,
    )
    if _is_stale_task_operation(request, task):
        return _stale_task_response()

    op_dt = _operation_datetime(request)
    task.completed = False
    task.completed_at = None
    task.updated_at = op_dt
    task.save(update_fields=['completed', 'completed_at', 'updated_at'])
    task.subtasks.filter(user=request.user, completed=True).update(
        completed=False,
        completed_at=None,
        updated_at=op_dt,
    )

    back = _local_redirect_url(request.POST.get('back', ''))
    if back:
        return redirect(back)
    return redirect(reverse('project', args=[task.project_id]) + f'?section={task.section_id}')


@require_POST
def task_reorder(request):
    data = json.loads(request.body)
    op_dt = _operation_datetime(request)
    task_ids = [
        task_id
        for task_id in (_as_int_id(item.get('id')) for item in data)
        if task_id is not None
    ]
    old_tasks = {
        task.pk: task
        for task in Task.objects.filter(user=request.user, pk__in=task_ids)
    }
    sections_to_check = set()
    applied = 0
    skipped = 0

    # data = [{id: x, order: y, section_id: z|null, parent_id: z|null}, ...]
    for item in data:
        task_id = _as_int_id(item.get('id'))
        old_task = old_tasks.get(task_id)
        if not old_task:
            continue
        if _is_stale_task_operation(request, old_task):
            skipped += 1
            continue

        new_section_id = _owned_int_id(Section, request.user, item.get('section_id'), project_id=old_task.project_id)
        new_parent_id = _owned_int_id(Task, request.user, item.get('parent_id'), project_id=old_task.project_id)
        if item.get('section_id') and new_section_id is None:
            skipped += 1
            continue
        if item.get('parent_id') and new_parent_id is None:
            skipped += 1
            continue
        if (
            old_task
            and old_task.section_id
            and old_task.parent_id is None
            and not old_task.completed
            and (old_task.section_id != new_section_id or new_parent_id is not None)
        ):
            sections_to_check.add(old_task.section_id)

        Task.objects.filter(pk=task_id, user=request.user).update(
            order=item['order'],
            section_id=new_section_id,
            parent_id=new_parent_id,
            updated_at=op_dt,
        )
        applied += 1

    for section_id in sections_to_check:
        _move_section_to_end_if_empty(section_id, request.user)

    return JsonResponse({'status': 'ok', 'applied': applied, 'skipped': skipped})


# --- Labels CRUD ---

@require_POST
def label_create(request):
    name = request.POST.get('name', '').strip()
    color = request.POST.get('color', '#6c757d')
    if name:
        order = Label.objects.filter(user=request.user).count()
        label = Label.objects.create(user=request.user, name=name, color=color, order=order)
        return JsonResponse({'id': label.pk, 'name': label.name, 'color': label.color})
    return JsonResponse({'error': 'name required'}, status=400)


@require_POST
def label_edit(request, label_id):
    label = get_object_or_404(Label, pk=label_id, user=request.user)
    label.name = request.POST.get('name', label.name).strip()
    label.color = request.POST.get('color', label.color)
    label.save()
    return JsonResponse({'id': label.pk, 'name': label.name, 'color': label.color})


@require_POST
def label_delete(request, label_id):
    label = get_object_or_404(Label, pk=label_id, user=request.user)
    label.delete()
    return JsonResponse({'status': 'ok', 'default_url': reverse('index')})


def get_sections_for_project(request, project_id):
    project = get_object_or_404(Project, pk=project_id, user=request.user)
    sections = Section.objects.filter(user=request.user, project=project).values('id', 'name')
    return JsonResponse({'sections': list(sections)})


def get_tasks_for_parent(request, project_id):
    get_object_or_404(Project, pk=project_id, user=request.user)
    tasks = Task.objects.filter(
        user=request.user, project_id=project_id, parent__isnull=True, completed=False
    ).values('id', 'title')
    return JsonResponse({'tasks': list(tasks)})


def _revision_rows(qs, *fields):
    values = qs.order_by('pk').values_list('pk', *fields)
    return ';'.join('|'.join('' if value is None else str(value) for value in row) for row in values)


def app_revision(request):
    user = request.user
    parts = [
        f'p:{_revision_rows(Project.objects.filter(user=user), "name", "color", "order", "is_inbox")}',
        f's:{_revision_rows(Section.objects.filter(user=user), "name", "project_id", "order", "is_favorite", "favorite_order", "has_recurring_tasks")}',
        f'l:{_revision_rows(Label.objects.filter(user=user), "name", "color", "order")}',
        f't:{_revision_rows(Task.objects.filter(user=user), "project_id", "section_id", "parent_id", "label_id", "due_date", "priority", "order", "label_order", "completed", "updated_at")}',
        f'i:{_revision_rows(TaskImage.objects.filter(task__user=user), "task_id", "uploaded_at")}',
    ]

    response = JsonResponse({'revision': '|'.join(parts) or 'missing'})
    response['Cache-Control'] = 'no-store'
    return response


# --- Settings ---

def settings_view(request):
    settings = AppSettings.load(request.user)
    if request.method == 'POST':
        settings.default_view_type = request.POST.get('default_view_type', AppSettings.VIEW_FIRST_PROJECT)
        pid = request.POST.get('default_project_id') or None
        lid = request.POST.get('default_label_id') or None
        settings.default_project = get_object_or_404(Project, pk=pid, user=request.user) if pid else None
        settings.default_label = get_object_or_404(Label, pk=lid, user=request.user) if lid else None
        settings.save()
        return redirect('settings')
    db = _db_size()
    media = _media_size(request.user)
    ctx = _sidebar_context(request.user)
    ctx.update({
        'settings': settings,
        'db_size': _format_size(db),
        'media_size': _format_size(media),
        'total_size': _format_size(db + media),
        'task_count': Task.objects.filter(user=request.user, completed=False).count(),
        'completed_count': Task.objects.filter(user=request.user, completed=True).count(),
        'image_count': TaskImage.objects.filter(task__user=request.user).count(),
    })
    return render(request, 'tasks/settings.html', ctx)


@require_POST
def purge_completed(request):
    tasks = Task.objects.filter(user=request.user, completed=True)
    # Supprimer les fichiers images avant la suppression en cascade
    for img in TaskImage.objects.filter(task__in=tasks):
        img.image.delete(save=False)
    count, _ = tasks.delete()
    return JsonResponse({'deleted': count})


# ── Images ──

ALLOWED_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif'}


@require_POST
def task_image_upload(request, task_id):
    task = get_object_or_404(Task, pk=task_id, user=request.user)
    f = request.FILES.get('image')
    if not f:
        return JsonResponse({'error': 'aucun fichier'}, status=400)
    ext = os.path.splitext(f.name)[1].lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        return JsonResponse({'error': f'Format non supporté : {ext}'}, status=400)
    img = TaskImage.objects.create(task=task, image=f, original_filename=f.name, file_size=f.size)
    return JsonResponse({
        'id': img.pk,
        'url': img.image.url,
        'filename': img.original_filename,
    })


@require_POST
def task_image_delete(request, image_id):
    img = get_object_or_404(TaskImage, pk=image_id, task__user=request.user)
    img.image.delete(save=False)
    img.delete()
    return JsonResponse({'status': 'ok'})


def protected_media(request, path):
    img = get_object_or_404(TaskImage, image=path, task__user=request.user)
    if not img.image:
        raise Http404
    content_type = mimetypes.guess_type(img.original_filename or img.image.name)[0] or 'application/octet-stream'
    return FileResponse(img.image.open('rb'), content_type=content_type)


# ── Taille BDD + médias ──

def _format_size(n):
    if n < 1024:       return f'{n} o'
    if n < 1024**2:    return f'{n/1024:.1f} Ko'
    return             f'{n/1024**2:.1f} Mo'

def _db_size():
    p = django_settings.DATABASES['default']['NAME']
    return os.path.getsize(str(p)) if os.path.exists(str(p)) else 0

def _media_size(user):
    return sum(TaskImage.objects.filter(task__user=user).values_list('file_size', flat=True))


@require_POST
def label_task_reorder(request, label_id):
    get_object_or_404(Label, pk=label_id, user=request.user)
    data = json.loads(request.body)
    op_dt = _operation_datetime(request)
    task_ids = [
        task_id
        for task_id in (_as_int_id(item.get('id')) for item in data)
        if task_id is not None
    ]
    tasks_by_id = {
        task.pk: task
        for task in Task.objects.filter(user=request.user, label_id=label_id, pk__in=task_ids)
    }
    applied = 0
    skipped = 0

    for item in data:
        task_id = _as_int_id(item.get('id'))
        task = tasks_by_id.get(task_id)
        if not task:
            continue
        if _is_stale_task_operation(request, task):
            skipped += 1
            continue
        Task.objects.filter(pk=task_id, user=request.user).update(label_order=item['order'], updated_at=op_dt)
        applied += 1
    return JsonResponse({'status': 'ok', 'applied': applied, 'skipped': skipped})


@require_POST
def project_reorder(request):
    for item in json.loads(request.body):
        Project.objects.filter(pk=item['id'], user=request.user).update(order=item['order'])
    return JsonResponse({'status': 'ok'})


@require_POST
def label_reorder(request):
    for item in json.loads(request.body):
        Label.objects.filter(pk=item['id'], user=request.user).update(order=item['order'])
    return JsonResponse({'status': 'ok'})


@require_POST
def section_reorder(request):
    for item in json.loads(request.body):
        Section.objects.filter(pk=item['id'], user=request.user).update(order=item['order'])
    return JsonResponse({'status': 'ok'})


@require_POST
def section_favorite_reorder(request):
    for order, item in enumerate(json.loads(request.body)):
        Section.objects.filter(pk=item['id'], user=request.user, is_favorite=True).update(favorite_order=order)
    _normalize_favorite_order(request.user)
    return JsonResponse({'status': 'ok'})


def login_view(request):
    error = None
    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')
        user = authenticate(request, username=username, password=password)
        if user is not None:
            auth_login(request, user)
            next_url = request.GET.get('next', '/')
            if not next_url.startswith('/'):
                next_url = '/'
            return redirect(next_url)
        error = 'Identifiant ou mot de passe incorrect.'
    return render(request, 'tasks/login.html', {'error': error})


def logout_view(request):
    auth_logout(request)
    return redirect('/login/')


def service_worker(request):
    path = os.path.join(django_settings.BASE_DIR, 'static', 'tasks', 'sw.js')
    with open(path, 'r') as f:
        content = f.read()
    response = HttpResponse(content, content_type='application/javascript')
    response['Service-Worker-Allowed'] = '/'
    response['Cache-Control'] = 'no-store'
    return response


def manifest(request):
    path = os.path.join(django_settings.BASE_DIR, 'static', 'manifest.json')
    with open(path, 'r') as f:
        content = f.read()
    return HttpResponse(content, content_type='application/manifest+json')
