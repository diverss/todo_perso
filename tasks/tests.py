import json
from datetime import timedelta

from django.urls import resolve
from django.test import RequestFactory, TestCase, override_settings
from django.utils import timezone

from .models import Project, Section, Task
from .views import (
    project_view,
    section_favorite_reorder,
    section_toggle_favorite,
    search_view,
    task_complete,
    task_delete,
    task_detail,
    task_edit,
    task_reorder,
)


class EmptySectionOrderingTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.project = Project.objects.create(name='Projet')
        self.alpha = Section.objects.create(name='Alpha', project=self.project, order=0)
        self.beta = Section.objects.create(name='Beta', project=self.project, order=1)
        self.gamma = Section.objects.create(name='Gamma', project=self.project, order=2)

    def section_order(self):
        return list(
            Section.objects
            .filter(project=self.project)
            .order_by('order', 'name', 'pk')
            .values_list('name', flat=True)
        )

    def test_completing_last_visible_task_moves_section_to_end(self):
        task = Task.objects.create(title='A faire', project=self.project, section=self.alpha)

        request = self.factory.post(f'/task/{task.pk}/complete/')
        task_complete(request, task.pk)

        self.assertEqual(self.section_order(), ['Beta', 'Gamma', 'Alpha'])

    def test_completing_task_keeps_section_in_place_when_another_task_remains(self):
        first = Task.objects.create(title='Un', project=self.project, section=self.alpha, order=0)
        Task.objects.create(title='Deux', project=self.project, section=self.alpha, order=1)

        request = self.factory.post(f'/task/{first.pk}/complete/')
        task_complete(request, first.pk)

        self.assertEqual(self.section_order(), ['Alpha', 'Beta', 'Gamma'])

    def test_deleting_last_visible_task_moves_section_to_end(self):
        task = Task.objects.create(title='A supprimer', project=self.project, section=self.alpha)

        request = self.factory.post(f'/task/{task.pk}/delete/')
        task_delete(request, task.pk)

        self.assertEqual(self.section_order(), ['Beta', 'Gamma', 'Alpha'])

    def test_editing_last_visible_task_to_another_section_moves_old_section_to_end(self):
        task = Task.objects.create(title='A deplacer', project=self.project, section=self.alpha)

        request = self.factory.post(f'/task/{task.pk}/edit/', data={
            'title': task.title,
            'description': '',
            'priority': task.priority,
            'project_id': self.project.pk,
            'section_id': self.beta.pk,
            'parent_id': '',
        })
        task_edit(request, task.pk)

        task.refresh_from_db()
        self.assertEqual(task.section_id, self.beta.pk)
        self.assertEqual(self.section_order(), ['Beta', 'Gamma', 'Alpha'])

    def test_dragging_last_visible_task_to_another_section_moves_old_section_to_end(self):
        moved = Task.objects.create(title='A deplacer', project=self.project, section=self.alpha)
        existing = Task.objects.create(title='Deja la', project=self.project, section=self.beta)
        payload = [
            {'id': existing.pk, 'order': 0, 'section_id': self.beta.pk, 'parent_id': None},
            {'id': moved.pk, 'order': 1, 'section_id': self.beta.pk, 'parent_id': None},
        ]

        request = self.factory.post(
            '/task/reorder/',
            data=json.dumps(payload),
            content_type='application/json',
        )
        task_reorder(request)

        moved.refresh_from_db()
        self.assertEqual(moved.section_id, self.beta.pk)
        self.assertEqual(self.section_order(), ['Beta', 'Gamma', 'Alpha'])


class SectionFavoriteTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.project = Project.objects.create(name='Projet')
        self.alpha = Section.objects.create(name='Alpha', project=self.project, order=0)
        self.beta = Section.objects.create(name='Beta', project=self.project, order=1)
        self.gamma = Section.objects.create(name='Gamma', project=self.project, order=2)

    def favorite_order(self):
        return list(
            Section.objects
            .filter(is_favorite=True)
            .order_by('favorite_order', 'project__order', 'project__name', 'order', 'name', 'pk')
            .values_list('name', flat=True)
        )

    def test_toggle_marks_section_as_favorite_at_end(self):
        self.alpha.is_favorite = True
        self.alpha.favorite_order = 0
        self.alpha.save()

        request = self.factory.post(f'/section/{self.beta.pk}/favorite/')
        section_toggle_favorite(request, self.beta.pk)

        self.beta.refresh_from_db()
        self.assertTrue(self.beta.is_favorite)
        self.assertEqual(self.beta.favorite_order, 1)
        self.assertEqual(self.favorite_order(), ['Alpha', 'Beta'])

    def test_toggle_removes_favorite_and_normalizes_remaining_order(self):
        self.alpha.is_favorite = True
        self.alpha.favorite_order = 0
        self.alpha.save()
        self.beta.is_favorite = True
        self.beta.favorite_order = 1
        self.beta.save()
        self.gamma.is_favorite = True
        self.gamma.favorite_order = 2
        self.gamma.save()

        request = self.factory.post(f'/section/{self.beta.pk}/favorite/')
        section_toggle_favorite(request, self.beta.pk)

        self.beta.refresh_from_db()
        self.gamma.refresh_from_db()
        self.assertFalse(self.beta.is_favorite)
        self.assertEqual(self.gamma.favorite_order, 1)
        self.assertEqual(self.favorite_order(), ['Alpha', 'Gamma'])

    def test_favorites_can_be_reordered(self):
        for order, section in enumerate([self.alpha, self.beta, self.gamma]):
            section.is_favorite = True
            section.favorite_order = order
            section.save()

        payload = [
            {'id': self.gamma.pk, 'order': 0},
            {'id': self.alpha.pk, 'order': 1},
            {'id': self.beta.pk, 'order': 2},
        ]
        request = self.factory.post(
            '/section/favorites/reorder/',
            data=json.dumps(payload),
            content_type='application/json',
        )
        section_favorite_reorder(request)

        self.assertEqual(self.favorite_order(), ['Gamma', 'Alpha', 'Beta'])

    @override_settings(STATICFILES_STORAGE='django.contrib.staticfiles.storage.StaticFilesStorage')
    def test_project_view_renders_favorite_sidebar_and_section_menu(self):
        self.beta.is_favorite = True
        self.beta.favorite_order = 0
        self.beta.save()

        request = self.factory.get(f'/project/{self.project.pk}/?section={self.beta.pk}')
        request.resolver_match = resolve(f'/project/{self.project.pk}/')
        response = project_view(request, self.project.pk)
        html = response.content.decode()

        self.assertContains(response, 'Favoris')
        self.assertIn(f'/project/{self.project.pk}/?section={self.beta.pk}', html)
        self.assertContains(response, 'Retirer des favoris')
        self.assertContains(response, 'Ajouter aux favoris')


class TaskDetailInboxTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.inbox = Project.objects.create(name='A trier', is_inbox=True)
        self.project = Project.objects.create(name='Projet')

    @override_settings(STATICFILES_STORAGE='django.contrib.staticfiles.storage.StaticFilesStorage')
    def test_inbox_task_edit_form_keeps_inbox_selected(self):
        task = Task.objects.create(title='A classer', project=self.inbox)

        request = self.factory.get(f'/task/{task.pk}/')
        request.resolver_match = resolve(f'/task/{task.pk}/')
        response = task_detail(request, task.pk)

        self.assertContains(
            response,
            f'<option value="{self.inbox.pk}" selected>A trier</option>',
            html=True,
        )
        self.assertContains(response, f'<option value="{self.project.pk}">Projet</option>', html=True)


class SearchViewTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.project = Project.objects.create(name='Projet')

    @override_settings(STATICFILES_STORAGE='django.contrib.staticfiles.storage.StaticFilesStorage')
    def test_search_returns_active_matching_tasks_only(self):
        Task.objects.create(title='Garage actif', description='Verifier la porte', project=self.project)
        Task.objects.create(title='Archive garage', project=self.project, completed=True)

        request = self.factory.get('/search/?q=garage')
        request.resolver_match = resolve('/search/')
        response = search_view(request)

        self.assertContains(response, 'Garage actif')
        self.assertNotContains(response, 'Archive garage')
        self.assertContains(response, 'Recherche : garage')
        self.assertContains(response, 'value="garage"')


class OfflineTaskConflictTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.project = Project.objects.create(name='Projet')

    def _ms(self, dt):
        return int(dt.timestamp() * 1000)

    def test_older_offline_complete_is_skipped(self):
        task = Task.objects.create(title='Pain', project=self.project)
        server_dt = timezone.now()
        task.updated_at = server_dt
        task.save(update_fields=['updated_at'])

        request = self.factory.post(
            f'/task/{task.pk}/complete/',
            data={'offline_ts': self._ms(server_dt - timedelta(minutes=1))},
        )
        response = task_complete(request, task.pk)

        task.refresh_from_db()
        self.assertJSONEqual(response.content, {'status': 'skipped', 'reason': 'newer_server_version'})
        self.assertFalse(task.completed)

    def test_newer_offline_complete_is_applied(self):
        task = Task.objects.create(title='Pain', project=self.project)
        server_dt = timezone.now()
        task.updated_at = server_dt
        task.save(update_fields=['updated_at'])
        op_ms = self._ms(server_dt + timedelta(minutes=1))

        request = self.factory.post(
            f'/task/{task.pk}/complete/',
            data={'offline_ts': op_ms},
        )
        task_complete(request, task.pk)

        task.refresh_from_db()
        self.assertTrue(task.completed)
        self.assertEqual(self._ms(task.updated_at), op_ms)

    def test_older_offline_edit_is_skipped(self):
        task = Task.objects.create(title='Pain', project=self.project)
        server_dt = timezone.now()
        task.updated_at = server_dt
        task.save(update_fields=['updated_at'])

        request = self.factory.post(f'/task/{task.pk}/edit/', data={
            'offline_ts': self._ms(server_dt - timedelta(minutes=1)),
            'title': 'Pain modifié',
            'description': '',
            'priority': task.priority,
            'project_id': self.project.pk,
            'section_id': '',
            'parent_id': '',
        })
        response = task_edit(request, task.pk)

        task.refresh_from_db()
        self.assertJSONEqual(response.content, {'status': 'skipped', 'reason': 'newer_server_version'})
        self.assertEqual(task.title, 'Pain')
