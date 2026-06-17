import json
import os
from django.shortcuts import render, get_object_or_404, redirect
from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_POST, require_http_methods
from django.utils import timezone
from django.db.models import Max, Q
from django.conf import settings as django_settings

from .models import Project, Section, Task, Label, AppSettings, TaskImage


def _get_inbox():
    inbox, _ = Project.objects.get_or_create(
        is_inbox=True,
        defaults={'name': 'A trier', 'color': '#718096', 'order': 9999}
    )
    return inbox


def _sidebar_context():
    inbox = _get_inbox()
    return {
        'projects': Project.objects.filter(is_inbox=False),
        'labels': Label.objects.all(),
        'favorite_sections': Section.objects.filter(is_favorite=True).select_related('project').order_by(
            'favorite_order', 'project__order', 'project__name', 'order', 'name', 'pk'
        ),
        'inbox': inbox,
        'inbox_task_count': Task.objects.filter(project=inbox, completed=False, parent__isnull=True).count(),
    }


def _normalize_favorite_order():
    sections = list(
        Section.objects
        .filter(is_favorite=True)
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


def _move_section_to_end_if_empty(section_id):
    if not section_id:
        return

    section = Section.objects.filter(pk=section_id).first()
    if not section:
        return

    has_visible_tasks = Task.objects.filter(
        project_id=section.project_id,
        section_id=section.pk,
        completed=False,
        parent__isnull=True,
    ).exists()
    if has_visible_tasks:
        return

    sections = list(
        Section.objects
        .filter(project_id=section.project_id)
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


def project_view(request, project_id):
    project = get_object_or_404(Project, pk=project_id)
    sections = project.sections.all()
    tasks_no_section = project.tasks.filter(
        completed=False, parent__isnull=True, section__isnull=True
    )
    ctx = _sidebar_context()
    ctx.update({
        'project': project,
        'sections': sections,
        'tasks_no_section': tasks_no_section,
        'all_projects': Project.objects.filter(is_inbox=False),
    })
    return render(request, 'tasks/project.html', ctx)


def index(request):
    s = AppSettings.load()
    if s.default_view_type == AppSettings.VIEW_PROJECT and s.default_project_id:
        return redirect('project', project_id=s.default_project_id)
    if s.default_view_type == AppSettings.VIEW_LABEL and s.default_label_id:
        return redirect('label', label_id=s.default_label_id)
    first_project = Project.objects.filter(is_inbox=False).first()
    if first_project:
        return redirect('project', project_id=first_project.pk)
    return render(request, 'tasks/empty.html', _sidebar_context())


def inbox_view(request):
    inbox = _get_inbox()
    tasks = Task.objects.filter(
        project=inbox, completed=False, parent__isnull=True
    ).order_by('order', 'created_at')
    ctx = _sidebar_context()
    ctx.update({'inbox': inbox, 'tasks': tasks})
    return render(request, 'tasks/inbox.html', ctx)


def label_view(request, label_id):
    from django.db.models import F
    label = get_object_or_404(Label, pk=label_id)
    tasks = Task.objects.filter(
        label=label, completed=False, parent__isnull=True
    ).select_related('project', 'section').order_by(
        F('label_order').asc(nulls_last=True), 'order', 'created_at'
    )
    ctx = _sidebar_context()
    ctx.update({'label': label, 'tasks': tasks})
    return render(request, 'tasks/label.html', ctx)


# --- Projects CRUD ---

@require_POST
def project_create(request):
    name = request.POST.get('name', '').strip()
    color = request.POST.get('color', '#5b8def')
    if name:
        order = Project.objects.count()
        project = Project.objects.create(name=name, color=color, order=order)
    return redirect('project', project_id=project.pk)


@require_POST
def project_edit(request, project_id):
    project = get_object_or_404(Project, pk=project_id)
    project.name = request.POST.get('name', project.name).strip()
    project.color = request.POST.get('color', project.color)
    project.save()
    return redirect('project', project_id=project.pk)


@require_POST
def project_delete(request, project_id):
    project = get_object_or_404(Project, pk=project_id)
    if project.is_inbox:
        return redirect('inbox')
    project.delete()
    return redirect('index')


# --- Sections CRUD ---

@require_POST
def section_create(request, project_id):
    project = get_object_or_404(Project, pk=project_id)
    name = request.POST.get('name', '').strip()
    if name:
        order = project.sections.count()
        Section.objects.create(name=name, project=project, order=order)
    return redirect('project', project_id=project.pk)


@require_POST
def section_edit(request, section_id):
    section = get_object_or_404(Section, pk=section_id)
    if request.POST.get('move_to_project'):
        origin_project_id = section.project_id
        new_project = get_object_or_404(Project, pk=request.POST.get('project_id'))
        section.project = new_project
        section.order = new_project.sections.count()
        section.save()
        return redirect('project', project_id=origin_project_id)
    section.name = request.POST.get('name', section.name).strip()
    section.save()
    return redirect('project', project_id=section.project.pk)


@require_POST
def section_delete(request, section_id):
    section = get_object_or_404(Section, pk=section_id)
    project_id = section.project.pk
    section.delete()
    _normalize_favorite_order()
    return redirect('project', project_id=project_id)


@require_POST
def section_toggle_favorite(request, section_id):
    section = get_object_or_404(Section, pk=section_id)

    if section.is_favorite:
        section.is_favorite = False
        section.favorite_order = 0
    else:
        max_order = Section.objects.filter(is_favorite=True).aggregate(Max('favorite_order'))['favorite_order__max']
        section.is_favorite = True
        section.favorite_order = 0 if max_order is None else max_order + 1

    section.save(update_fields=['is_favorite', 'favorite_order'])
    if not section.is_favorite:
        _normalize_favorite_order()

    next_url = request.POST.get('next', '')
    if next_url.startswith('/'):
        return redirect(next_url)
    return redirect('project', project_id=section.project_id)


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

    project = get_object_or_404(Project, pk=project_id)
    section = get_object_or_404(Section, pk=section_id) if section_id else None
    parent = get_object_or_404(Task, pk=parent_id) if parent_id else None
    label = get_object_or_404(Label, pk=label_id) if label_id else None

    qs = Task.objects.filter(project=project, section=section, parent=parent)
    order = qs.count()

    task = Task.objects.create(
        title=title,
        description=request.POST.get('description', ''),
        priority=priority,
        label=label,
        project=project,
        section=section,
        parent=parent,
        order=order,
    )

    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return JsonResponse({'id': task.pk, 'title': task.title})

    if parent:
        return redirect('task_detail', task_id=parent.pk)
    if section:
        from django.urls import reverse
        return redirect(reverse('project', args=[project.pk]) + f'?section={section.pk}')
    if project.is_inbox:
        return redirect('inbox')
    return redirect('project', project_id=project.pk)


def task_detail(request, task_id):
    task = get_object_or_404(Task, pk=task_id)
    subtasks = task.subtasks.filter(completed=False)
    back_url = request.GET.get('back', '')
    if not back_url.startswith('/'):
        back_url = ''
    if not back_url and task.project.is_inbox and task.parent is None:
        ids = list(
            Task.objects.filter(project=task.project, completed=False, parent__isnull=True)
            .order_by('order', 'created_at')
            .values_list('pk', flat=True)
        )
        try:
            idx = ids.index(task.pk)
            back_url = f'/task/{ids[idx + 1]}/' if idx + 1 < len(ids) else '/inbox/'
        except ValueError:
            back_url = '/inbox/'
    ctx = _sidebar_context()
    ctx.update({
        'task': task,
        'subtasks': subtasks,
        'projects': Project.objects.filter(is_inbox=False),
        'sections': Section.objects.filter(project=task.project),
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
    task = get_object_or_404(Task, pk=task_id)
    old_section_id = task.section_id
    old_parent_id = task.parent_id
    old_completed = task.completed

    task.title = request.POST.get('title', task.title).strip()
    task.description = request.POST.get('description', task.description)
    task.priority = int(request.POST.get('priority', task.priority))

    label_id = request.POST.get('label_id') or None
    task.label = get_object_or_404(Label, pk=label_id) if label_id else None

    project_id = request.POST.get('project_id')
    if project_id:
        task.project = get_object_or_404(Project, pk=project_id)

    section_id = request.POST.get('section_id') or None
    task.section = get_object_or_404(Section, pk=section_id) if section_id else None

    parent_id = request.POST.get('parent_id') or None
    task.parent = get_object_or_404(Task, pk=parent_id) if parent_id else None

    task.save()
    if old_section_id and old_parent_id is None and not old_completed:
        _move_section_to_end_if_empty(old_section_id)

    back = request.POST.get('back', '')
    if back and back.startswith('/'):
        return redirect(back)
    if task.parent_id:
        return redirect('task_detail', task_id=task.parent_id)
    return redirect('project', project_id=task.project_id)


@require_POST
def task_complete(request, task_id):
    task = get_object_or_404(Task, pk=task_id)
    old_section_id = task.section_id if task.parent_id is None else None

    task.completed = True
    task.completed_at = timezone.now()
    task.save()
    task.subtasks.filter(completed=False).update(completed=True, completed_at=timezone.now())
    _move_section_to_end_if_empty(old_section_id)
    return JsonResponse({'status': 'ok'})


@require_POST
def task_delete(request, task_id):
    task = get_object_or_404(Task, pk=task_id)
    project_id = task.project.pk
    parent_id = task.parent.pk if task.parent else None
    old_section_id = task.section_id if task.parent_id is None and not task.completed else None

    back = request.POST.get('back', '')
    task.delete()
    _move_section_to_end_if_empty(old_section_id)

    if back and back.startswith('/'):
        return redirect(back)
    if parent_id:
        return redirect('task_detail', task_id=parent_id)
    return redirect('project', project_id=project_id)


@require_POST
def task_reorder(request):
    data = json.loads(request.body)
    task_ids = [item['id'] for item in data]
    old_tasks = {
        task.pk: task
        for task in Task.objects.filter(pk__in=task_ids)
    }
    sections_to_check = set()

    # data = [{id: x, order: y, section_id: z|null, parent_id: z|null}, ...]
    for item in data:
        old_task = old_tasks.get(item['id'])
        new_section_id = item.get('section_id')
        new_parent_id = item.get('parent_id')
        if (
            old_task
            and old_task.section_id
            and old_task.parent_id is None
            and not old_task.completed
            and (old_task.section_id != new_section_id or new_parent_id is not None)
        ):
            sections_to_check.add(old_task.section_id)

        Task.objects.filter(pk=item['id']).update(
            order=item['order'],
            section_id=new_section_id,
            parent_id=new_parent_id,
        )

    for section_id in sections_to_check:
        _move_section_to_end_if_empty(section_id)

    return JsonResponse({'status': 'ok'})


# --- Labels CRUD ---

@require_POST
def label_create(request):
    name = request.POST.get('name', '').strip()
    color = request.POST.get('color', '#6c757d')
    if name:
        order = Label.objects.count()
        label = Label.objects.create(name=name, color=color, order=order)
        return JsonResponse({'id': label.pk, 'name': label.name, 'color': label.color})
    return JsonResponse({'error': 'name required'}, status=400)


@require_POST
def label_edit(request, label_id):
    label = get_object_or_404(Label, pk=label_id)
    label.name = request.POST.get('name', label.name).strip()
    label.color = request.POST.get('color', label.color)
    label.save()
    return JsonResponse({'id': label.pk, 'name': label.name, 'color': label.color})


@require_POST
def label_delete(request, label_id):
    label = get_object_or_404(Label, pk=label_id)
    label.delete()
    return JsonResponse({'status': 'ok'})


def get_sections_for_project(request, project_id):
    sections = Section.objects.filter(project_id=project_id).values('id', 'name')
    return JsonResponse({'sections': list(sections)})


def get_tasks_for_parent(request, project_id):
    tasks = Task.objects.filter(
        project_id=project_id, parent__isnull=True, completed=False
    ).values('id', 'title')
    return JsonResponse({'tasks': list(tasks)})


def app_revision(request):
    db_path = str(django_settings.DATABASES['default']['NAME'])
    paths = [db_path, f'{db_path}-wal', f'{db_path}-journal']

    parts = []
    for path in paths:
        try:
            stat = os.stat(path)
        except FileNotFoundError:
            continue
        parts.append(f'{os.path.basename(path)}:{stat.st_mtime_ns}:{stat.st_size}')

    response = JsonResponse({'revision': '|'.join(parts) or 'missing'})
    response['Cache-Control'] = 'no-store'
    return response


# --- Settings ---

def settings_view(request):
    settings = AppSettings.load()
    if request.method == 'POST':
        settings.default_view_type = request.POST.get('default_view_type', AppSettings.VIEW_FIRST_PROJECT)
        pid = request.POST.get('default_project_id') or None
        lid = request.POST.get('default_label_id') or None
        settings.default_project = get_object_or_404(Project, pk=pid) if pid else None
        settings.default_label = get_object_or_404(Label, pk=lid) if lid else None
        settings.save()
        return redirect('settings')
    db = _db_size()
    media = _media_size()
    ctx = _sidebar_context()
    ctx.update({
        'settings': settings,
        'db_size': _format_size(db),
        'media_size': _format_size(media),
        'total_size': _format_size(db + media),
        'task_count': Task.objects.filter(completed=False).count(),
        'completed_count': Task.objects.filter(completed=True).count(),
        'image_count': TaskImage.objects.count(),
    })
    return render(request, 'tasks/settings.html', ctx)


@require_POST
def purge_completed(request):
    tasks = Task.objects.filter(completed=True)
    # Supprimer les fichiers images avant la suppression en cascade
    for img in TaskImage.objects.filter(task__in=tasks):
        img.image.delete(save=False)
    count, _ = tasks.delete()
    return JsonResponse({'deleted': count})


# ── Images ──

ALLOWED_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif'}


@require_POST
def task_image_upload(request, task_id):
    task = get_object_or_404(Task, pk=task_id)
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
    img = get_object_or_404(TaskImage, pk=image_id)
    img.image.delete(save=False)
    img.delete()
    return JsonResponse({'status': 'ok'})


# ── Taille BDD + médias ──

def _format_size(n):
    if n < 1024:       return f'{n} o'
    if n < 1024**2:    return f'{n/1024:.1f} Ko'
    return             f'{n/1024**2:.1f} Mo'

def _db_size():
    p = django_settings.DATABASES['default']['NAME']
    return os.path.getsize(str(p)) if os.path.exists(str(p)) else 0

def _media_size():
    root = str(django_settings.MEDIA_ROOT)
    total = 0
    if os.path.exists(root):
        for dp, _, files in os.walk(root):
            for f in files:
                fp = os.path.join(dp, f)
                if os.path.isfile(fp):
                    total += os.path.getsize(fp)
    return total


@require_POST
def label_task_reorder(request, label_id):
    for item in json.loads(request.body):
        Task.objects.filter(pk=item['id']).update(label_order=item['order'])
    return JsonResponse({'status': 'ok'})


@require_POST
def project_reorder(request):
    for item in json.loads(request.body):
        Project.objects.filter(pk=item['id']).update(order=item['order'])
    return JsonResponse({'status': 'ok'})


@require_POST
def label_reorder(request):
    for item in json.loads(request.body):
        Label.objects.filter(pk=item['id']).update(order=item['order'])
    return JsonResponse({'status': 'ok'})


@require_POST
def section_reorder(request):
    for item in json.loads(request.body):
        Section.objects.filter(pk=item['id']).update(order=item['order'])
    return JsonResponse({'status': 'ok'})


@require_POST
def section_favorite_reorder(request):
    for order, item in enumerate(json.loads(request.body)):
        Section.objects.filter(pk=item['id'], is_favorite=True).update(favorite_order=order)
    _normalize_favorite_order()
    return JsonResponse({'status': 'ok'})


def login_view(request):
    error = None
    if request.method == 'POST':
        token = request.POST.get('token', '')
        if token == django_settings.ACCESS_TOKEN:
            next_url = request.GET.get('next', '/')
            if not next_url.startswith('/'):
                next_url = '/'
            response = redirect(next_url)
            response.set_cookie(
                'access_token', token,
                max_age=365 * 24 * 3600,
                httponly=True,
                samesite='Lax',
            )
            return response
        error = 'Token incorrect.'
    return render(request, 'tasks/login.html', {'error': error})


def logout_view(request):
    response = redirect('/login/')
    response.delete_cookie('access_token')
    return response


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
