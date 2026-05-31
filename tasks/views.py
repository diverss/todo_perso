import json
import os
from django.shortcuts import render, get_object_or_404, redirect
from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_POST, require_http_methods
from django.utils import timezone
from django.db.models import Q
from django.conf import settings as django_settings

from .models import Project, Section, Task, Label, AppSettings, TaskImage


def _sidebar_context():
    return {
        'projects': Project.objects.all(),
        'labels': Label.objects.all(),
    }


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
    })
    return render(request, 'tasks/project.html', ctx)


def index(request):
    s = AppSettings.load()
    if s.default_view_type == AppSettings.VIEW_PROJECT and s.default_project_id:
        return redirect('project', project_id=s.default_project_id)
    if s.default_view_type == AppSettings.VIEW_LABEL and s.default_label_id:
        return redirect('label', label_id=s.default_label_id)
    first_project = Project.objects.first()
    if first_project:
        return redirect('project', project_id=first_project.pk)
    return render(request, 'tasks/empty.html', _sidebar_context())


def label_view(request, label_id):
    label = get_object_or_404(Label, pk=label_id)
    tasks = Task.objects.filter(
        label=label, completed=False, parent__isnull=True
    ).select_related('project', 'section')
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
    section.name = request.POST.get('name', section.name).strip()
    section.save()
    return redirect('project', project_id=section.project.pk)


@require_POST
def section_delete(request, section_id):
    section = get_object_or_404(Section, pk=section_id)
    project_id = section.project.pk
    section.delete()
    return redirect('project', project_id=project_id)


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
        return redirect('project', project_id=project.pk)
    return redirect('project', project_id=project.pk)


def task_detail(request, task_id):
    task = get_object_or_404(Task, pk=task_id)
    subtasks = task.subtasks.filter(completed=False)
    ctx = _sidebar_context()
    ctx.update({
        'task': task,
        'subtasks': subtasks,
        'projects': Project.objects.all(),
        'sections': Section.objects.filter(project=task.project),
    })
    return render(request, 'tasks/task_detail.html', ctx)


@require_POST
def task_edit(request, task_id):
    task = get_object_or_404(Task, pk=task_id)
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
    if task.parent_id:
        return redirect('task_detail', task_id=task.parent_id)
    return redirect('project', project_id=task.project_id)


@require_POST
def task_complete(request, task_id):
    task = get_object_or_404(Task, pk=task_id)
    task.completed = True
    task.completed_at = timezone.now()
    task.save()
    task.subtasks.filter(completed=False).update(completed=True, completed_at=timezone.now())
    return JsonResponse({'status': 'ok'})


@require_POST
def task_delete(request, task_id):
    task = get_object_or_404(Task, pk=task_id)
    project_id = task.project.pk
    parent_id = task.parent.pk if task.parent else None
    task.delete()
    if parent_id:
        return redirect('task_detail', task_id=parent_id)
    return redirect('project', project_id=project_id)


@require_POST
def task_reorder(request):
    data = json.loads(request.body)
    # data = [{id: x, order: y, section_id: z|null, parent_id: z|null}, ...]
    for item in data:
        Task.objects.filter(pk=item['id']).update(
            order=item['order'],
            section_id=item.get('section_id'),
            parent_id=item.get('parent_id'),
        )
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
    return HttpResponse(content, content_type='application/javascript',
                        headers={'Service-Worker-Allowed': '/'})


def manifest(request):
    path = os.path.join(django_settings.BASE_DIR, 'static', 'manifest.json')
    with open(path, 'r') as f:
        content = f.read()
    return HttpResponse(content, content_type='application/manifest+json')
