"""
Importe projets, sections, tâches, étiquettes et commentaires depuis Todoist API v1.

Usage :
    python3 manage.py import_todoist --token <TOKEN_API>
    python3 manage.py import_todoist --token <TOKEN_API> --no-images

Priorité : Todoist API — 4=urgent(rouge), 1=normal
           Notre app   — 1=urgent(rouge), 4=normal
           Remapping   : notre = 5 - todoist
"""

import time
import requests
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from tasks.models import Label, Project, Section, Task, TaskImage

API = 'https://api.todoist.com/api/v1'

TODOIST_COLORS = {
    'berry_red': '#b8256f', 'red': '#db4035', 'orange': '#ff9933',
    'yellow': '#fad000', 'olive_green': '#afb83b', 'lime_green': '#7ecc49',
    'green': '#299438', 'mint_green': '#6accbc', 'teal': '#158fad',
    'sky_blue': '#14aaf5', 'light_blue': '#96c3eb', 'blue': '#4073ff',
    'grape': '#884dff', 'violet': '#af38eb', 'lavender': '#eb96eb',
    'magenta': '#e05194', 'salmon': '#ff8d85', 'charcoal': '#808080',
    'grey': '#b8b8b8', 'taupe': '#ccac93',
}

LABEL_COLORS = [
    '#5b8def', '#db4035', '#ff9933', '#299438', '#a44bb3',
    '#e05194', '#4073ff', '#795548', '#158fad', '#6accbc',
]


class Command(BaseCommand):
    help = 'Importe les données depuis Todoist API v1'

    def add_arguments(self, parser):
        parser.add_argument('--token', required=True, help='Token API Todoist (Paramètres → Intégrations)')
        parser.add_argument('--no-images', action='store_true', help='Ignorer les images des commentaires')

    def handle(self, *args, **options):
        token = options['token']
        no_images = options['no_images']
        headers = {'Authorization': f'Bearer {token}'}

        def get_all(endpoint, params=None):
            """Récupère toutes les pages d'un endpoint paginé."""
            results = []
            cursor = None
            while True:
                p = dict(params or {})
                if cursor:
                    p['cursor'] = cursor
                r = requests.get(f'{API}/{endpoint}', headers=headers, params=p, timeout=15)
                if not r.ok:
                    self.stderr.write(f'Erreur {endpoint} : {r.status_code} — {r.text[:200]}')
                    r.raise_for_status()
                data = r.json()
                # Réponse simple (liste) ou paginée (dict avec results/items)
                if isinstance(data, list):
                    return data
                results.extend(data.get('results', data.get('items', [])))
                cursor = data.get('next_cursor') or data.get('cursor')
                if not cursor:
                    break
            return results

        # ── Projets ─────────────────────────────────────────────────
        self.stdout.write('Projets…')
        project_map = {}
        for p in get_all('projects'):
            if p.get('is_deleted') or p.get('is_archived'):
                continue
            c = p.get('color', '')
            color = c if c.startswith('#') else TODOIST_COLORS.get(c, '#5b8def')
            obj = Project.objects.create(
                name=p['name'],
                color=color,
                order=p.get('child_order', p.get('order', 0)),
            )
            project_map[p['id']] = obj
        self.stdout.write(f'  ✓ {len(project_map)} projet(s)')

        # ── Sections ────────────────────────────────────────────────
        self.stdout.write('Sections…')
        section_map = {}
        for s in get_all('sections'):
            if s.get('is_deleted'):
                continue
            if s['project_id'] not in project_map:
                continue
            obj = Section.objects.create(
                name=s['name'],
                project=project_map[s['project_id']],
                order=s.get('section_order', s.get('order', 0)),
            )
            section_map[s['id']] = obj
        self.stdout.write(f'  ✓ {len(section_map)} section(s)')

        # ── Tâches ──────────────────────────────────────────────────
        self.stdout.write('Tâches…')
        # Le champ "title" ou "content" selon la version
        raw_tasks = [
            t for t in get_all('tasks')
            if not t.get('is_deleted') and not t.get('is_completed') and not t.get('checked')
        ]
        # Parents avant enfants
        raw_tasks.sort(key=lambda t: (1 if t.get('parent_id') else 0,
                                      t.get('child_order', t.get('order', 0))))

        # Étiquettes extraites des tâches
        unique_names = sorted({n for t in raw_tasks for n in (t.get('labels') or [])})
        label_map = {}
        for i, name in enumerate(unique_names):
            obj = Label.objects.create(name=name, color=LABEL_COLORS[i % len(LABEL_COLORS)], order=i)
            label_map[name] = obj
        self.stdout.write(f'  ✓ {len(label_map)} étiquette(s)')

        task_map = {}
        for t in raw_tasks:
            pid = t.get('project_id')
            if pid not in project_map:
                continue

            label_names = t.get('labels') or []
            label = label_map.get(label_names[0]) if label_names else None

            # API v1 : priority 4=urgent → notre 1=urgent
            priority = max(1, min(4, 5 - t.get('priority', 1)))

            section_id = t.get('section_id') or None
            parent_id  = t.get('parent_id')  or None
            # Le titre peut être dans "content" ou "title"
            title = t.get('content') or t.get('title') or '(sans titre)'

            obj = Task.objects.create(
                title=title,
                description=t.get('description') or '',
                priority=priority,
                label=label,
                project=project_map[pid],
                section=section_map.get(section_id) if section_id else None,
                parent=task_map.get(parent_id)      if parent_id  else None,
                order=max(0, t.get('child_order', t.get('order', 0))),
            )
            task_map[t['id']] = obj

        self.stdout.write(f'  ✓ {len(task_map)} tâche(s)')

        # ── Commentaires + images ────────────────────────────────────
        self.stdout.write(f'Commentaires{"" if not no_images else " (images ignorées)"}…')
        n_comments = 0
        n_images = 0
        n_errors = 0
        total = len(task_map)

        for i, (todoist_id, task) in enumerate(task_map.items(), 1):
            if i % 50 == 0:
                self.stdout.write(f'  {i}/{total}…')
            try:
                comments = get_all('comments', params={'task_id': todoist_id})
            except Exception:
                continue
            if not comments:
                continue

            text_parts = []
            for c in comments:
                if c.get('content'):
                    date = (c.get('posted_at') or '')[:10]
                    text_parts.append(f'**{date}** : {c["content"]}')
                    n_comments += 1

                att = c.get('attachment') or c.get('file_attachment')
                if att and not no_images:
                    mime = att.get('file_type', att.get('resource_type', ''))
                    if 'image' in mime:
                        try:
                            resp = requests.get(att['file_url'], headers=headers, timeout=30)
                            resp.raise_for_status()
                            fname = att.get('file_name', 'image.jpg')
                            img = TaskImage(task=task, original_filename=fname, file_size=len(resp.content))
                            img.image.save(fname, ContentFile(resp.content), save=True)
                            n_images += 1
                        except Exception as e:
                            self.stderr.write(f'  Image ignorée ({att.get("file_name","?")}): {e}')
                            n_errors += 1

            if text_parts:
                block = '\n\n'.join(text_parts)
                sep = '\n\n---\n\n' if task.description.strip() else ''
                task.description += sep + block
                task.save(update_fields=['description'])

            time.sleep(0.05)

        self.stdout.write(f'  ✓ {n_comments} commentaire(s), {n_images} image(s)'
                          f'{f", {n_errors} erreur(s)" if n_errors else ""}')
        self.stdout.write(self.style.SUCCESS('\nImport terminé !'))
        self.stdout.write(f'  Projets  : {len(project_map)}')
        self.stdout.write(f'  Sections : {len(section_map)}')
        self.stdout.write(f'  Tâches   : {len(task_map)}')
        self.stdout.write(f'  Étiquett.: {len(label_map)}')
