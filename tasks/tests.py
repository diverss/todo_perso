import json
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.http import Http404
from django.urls import resolve
from django.test import RequestFactory, TestCase, override_settings
from django.utils import timezone

from .models import Label, Project, Section, Task
from .views import (
    label_view,
    project_view,
    section_favorite_reorder,
    section_toggle_favorite,
    search_view,
    task_create,
    task_complete,
    task_delete,
    task_detail,
    task_edit,
    task_reorder,
)


def make_user(username):
    return get_user_model().objects.create_user(username=username, password='secret')


def with_user(request, user):
    request.user = user
    return request


class EmptySectionOrderingTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.user = make_user('user-empty')
        self.project = Project.objects.create(user=self.user, name='Projet')
        self.alpha = Section.objects.create(user=self.user, name='Alpha', project=self.project, order=0)
        self.beta = Section.objects.create(user=self.user, name='Beta', project=self.project, order=1)
        self.gamma = Section.objects.create(user=self.user, name='Gamma', project=self.project, order=2)

    def section_order(self):
        return list(
            Section.objects
            .filter(user=self.user, project=self.project)
            .order_by('order', 'name', 'pk')
            .values_list('name', flat=True)
        )

    def test_completing_last_visible_task_moves_section_to_end(self):
        task = Task.objects.create(user=self.user, title='A faire', project=self.project, section=self.alpha)

        request = with_user(self.factory.post(f'/task/{task.pk}/complete/'), self.user)
        task_complete(request, task.pk)

        self.assertEqual(self.section_order(), ['Beta', 'Gamma', 'Alpha'])

    def test_completing_task_keeps_section_in_place_when_another_task_remains(self):
        first = Task.objects.create(user=self.user, title='Un', project=self.project, section=self.alpha, order=0)
        Task.objects.create(user=self.user, title='Deux', project=self.project, section=self.alpha, order=1)

        request = with_user(self.factory.post(f'/task/{first.pk}/complete/'), self.user)
        task_complete(request, first.pk)

        self.assertEqual(self.section_order(), ['Alpha', 'Beta', 'Gamma'])

    def test_deleting_last_visible_task_moves_section_to_end(self):
        task = Task.objects.create(user=self.user, title='A supprimer', project=self.project, section=self.alpha)

        request = with_user(self.factory.post(f'/task/{task.pk}/delete/'), self.user)
        task_delete(request, task.pk)

        self.assertEqual(self.section_order(), ['Beta', 'Gamma', 'Alpha'])

    def test_editing_last_visible_task_to_another_section_moves_old_section_to_end(self):
        task = Task.objects.create(user=self.user, title='A deplacer', project=self.project, section=self.alpha)

        request = with_user(self.factory.post(f'/task/{task.pk}/edit/', data={
            'title': task.title,
            'description': '',
            'priority': task.priority,
            'project_id': self.project.pk,
            'section_id': self.beta.pk,
            'parent_id': '',
        }), self.user)
        task_edit(request, task.pk)

        task.refresh_from_db()
        self.assertEqual(task.section_id, self.beta.pk)
        self.assertEqual(self.section_order(), ['Beta', 'Gamma', 'Alpha'])

    def test_dragging_last_visible_task_to_another_section_moves_old_section_to_end(self):
        moved = Task.objects.create(user=self.user, title='A deplacer', project=self.project, section=self.alpha)
        existing = Task.objects.create(user=self.user, title='Deja la', project=self.project, section=self.beta)
        payload = [
            {'id': existing.pk, 'order': 0, 'section_id': self.beta.pk, 'parent_id': None},
            {'id': moved.pk, 'order': 1, 'section_id': self.beta.pk, 'parent_id': None},
        ]

        request = with_user(self.factory.post(
            '/task/reorder/',
            data=json.dumps(payload),
            content_type='application/json',
        ), self.user)
        task_reorder(request)

        moved.refresh_from_db()
        self.assertEqual(moved.section_id, self.beta.pk)
        self.assertEqual(self.section_order(), ['Beta', 'Gamma', 'Alpha'])


class SectionFavoriteTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.user = make_user('user-favorite')
        self.project = Project.objects.create(user=self.user, name='Projet')
        self.alpha = Section.objects.create(user=self.user, name='Alpha', project=self.project, order=0)
        self.beta = Section.objects.create(user=self.user, name='Beta', project=self.project, order=1)
        self.gamma = Section.objects.create(user=self.user, name='Gamma', project=self.project, order=2)

    def favorite_order(self):
        return list(
            Section.objects
            .filter(user=self.user, is_favorite=True)
            .order_by('favorite_order', 'project__order', 'project__name', 'order', 'name', 'pk')
            .values_list('name', flat=True)
        )

    def test_toggle_marks_section_as_favorite_at_end(self):
        self.alpha.is_favorite = True
        self.alpha.favorite_order = 0
        self.alpha.save()

        request = with_user(self.factory.post(f'/section/{self.beta.pk}/favorite/'), self.user)
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

        request = with_user(self.factory.post(f'/section/{self.beta.pk}/favorite/'), self.user)
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
        request = with_user(self.factory.post(
            '/section/favorites/reorder/',
            data=json.dumps(payload),
            content_type='application/json',
        ), self.user)
        section_favorite_reorder(request)

        self.assertEqual(self.favorite_order(), ['Gamma', 'Alpha', 'Beta'])

    @override_settings(STATICFILES_STORAGE='django.contrib.staticfiles.storage.StaticFilesStorage')
    def test_project_view_renders_favorite_sidebar_and_section_menu(self):
        self.beta.is_favorite = True
        self.beta.favorite_order = 0
        self.beta.save()

        request = with_user(self.factory.get(f'/project/{self.project.pk}/?section={self.beta.pk}'), self.user)
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
        self.user = make_user('user-inbox')
        self.inbox = Project.objects.create(user=self.user, name='A trier', is_inbox=True)
        self.project = Project.objects.create(user=self.user, name='Projet')

    @override_settings(STATICFILES_STORAGE='django.contrib.staticfiles.storage.StaticFilesStorage')
    def test_inbox_task_edit_form_keeps_inbox_selected(self):
        task = Task.objects.create(user=self.user, title='A classer', project=self.inbox)

        request = with_user(self.factory.get(f'/task/{task.pk}/'), self.user)
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
        self.user = make_user('user-search')
        self.project = Project.objects.create(user=self.user, name='Projet')

    @override_settings(STATICFILES_STORAGE='django.contrib.staticfiles.storage.StaticFilesStorage')
    def test_search_returns_active_matching_tasks_only(self):
        Task.objects.create(user=self.user, title='Garage actif', description='Verifier la porte', project=self.project)
        Task.objects.create(user=self.user, title='Archive garage', project=self.project, completed=True)

        request = with_user(self.factory.get('/search/?q=garage'), self.user)
        request.resolver_match = resolve('/search/')
        response = search_view(request)

        self.assertContains(response, 'Garage actif')
        self.assertNotContains(response, 'Archive garage')
        self.assertContains(response, 'Recherche : garage')
        self.assertContains(response, 'value="garage"')


class UserIsolationTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.user = make_user('owner')
        self.other = make_user('other')
        self.project = Project.objects.create(user=self.user, name='Projet owner')
        self.other_project = Project.objects.create(user=self.other, name='Projet other')

    def test_project_view_rejects_another_users_project(self):
        request = with_user(self.factory.get(f'/project/{self.other_project.pk}/'), self.user)

        with self.assertRaises(Http404):
            project_view(request, self.other_project.pk)

    @override_settings(STATICFILES_STORAGE='django.contrib.staticfiles.storage.StaticFilesStorage')
    def test_search_only_returns_current_users_tasks(self):
        Task.objects.create(user=self.user, title='Garage perso', project=self.project)
        Task.objects.create(user=self.other, title='Garage autre', project=self.other_project)

        request = with_user(self.factory.get('/search/?q=garage'), self.user)
        request.resolver_match = resolve('/search/')
        response = search_view(request)

        self.assertContains(response, 'Garage perso')
        self.assertNotContains(response, 'Garage autre')

    def test_task_complete_rejects_another_users_task(self):
        task = Task.objects.create(user=self.other, title='Autre tâche', project=self.other_project)
        request = with_user(self.factory.post(f'/task/{task.pk}/complete/'), self.user)

        with self.assertRaises(Http404):
            task_complete(request, task.pk)


class AuthFlowTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='login-user', password='secret')

    def test_anonymous_user_is_redirected_to_login(self):
        response = self.client.get('/settings/')

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response['Location'].startswith('/login/?next='))

    def test_username_password_login_sets_session(self):
        response = self.client.post('/login/', {
            'username': 'login-user',
            'password': 'secret',
        })

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], '/')
        self.assertEqual(int(self.client.session['_auth_user_id']), self.user.pk)


class TaskDueDateTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.user = make_user('user-date')
        self.project = Project.objects.create(user=self.user, name='Projet')
        self.label = Label.objects.create(user=self.user, name='Courses')

    def test_task_create_saves_optional_due_date(self):
        request = with_user(self.factory.post('/task/create/', data={
            'title': 'Acheter du pain',
            'description': '',
            'priority': 4,
            'project_id': self.project.pk,
            'section_id': '',
            'parent_id': '',
            'label_id': '',
            'due_date': '2026-08-05',
        }), self.user)

        task_create(request)

        task = Task.objects.get(title='Acheter du pain')
        self.assertEqual(task.due_date, date(2026, 8, 5))

    def test_task_edit_updates_and_clears_due_date(self):
        task = Task.objects.create(
            user=self.user,
            title='Acheter du pain',
            project=self.project,
            due_date=date(2026, 8, 5),
        )

        request = with_user(self.factory.post(f'/task/{task.pk}/edit/', data={
            'title': task.title,
            'description': '',
            'priority': task.priority,
            'project_id': self.project.pk,
            'section_id': '',
            'parent_id': '',
            'label_id': '',
            'due_date': '',
        }), self.user)
        task_edit(request, task.pk)

        task.refresh_from_db()
        self.assertIsNone(task.due_date)

    @override_settings(STATICFILES_STORAGE='django.contrib.staticfiles.storage.StaticFilesStorage')
    def test_project_and_label_views_render_due_date_after_title(self):
        Task.objects.create(
            user=self.user,
            title='Acheter du pain',
            project=self.project,
            label=self.label,
            due_date=date(2026, 8, 5),
        )

        project_request = with_user(self.factory.get(f'/project/{self.project.pk}/'), self.user)
        project_request.resolver_match = resolve(f'/project/{self.project.pk}/')
        project_response = project_view(project_request, self.project.pk)

        label_request = with_user(self.factory.get(f'/label/{self.label.pk}/'), self.user)
        label_request.resolver_match = resolve(f'/label/{self.label.pk}/')
        label_response = label_view(label_request, self.label.pk)

        self.assertContains(project_response, '<span class="task-due-date">05/08/2026</span>', html=True)
        self.assertContains(label_response, '<span class="task-due-date">05/08/2026</span>', html=True)


class OfflineTaskConflictTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.user = make_user('user-conflict')
        self.project = Project.objects.create(user=self.user, name='Projet')

    def _ms(self, dt):
        return int(dt.timestamp() * 1000)

    def test_older_offline_complete_is_skipped(self):
        task = Task.objects.create(user=self.user, title='Pain', project=self.project)
        server_dt = timezone.now()
        task.updated_at = server_dt
        task.save(update_fields=['updated_at'])

        request = with_user(self.factory.post(
            f'/task/{task.pk}/complete/',
            data={'offline_ts': self._ms(server_dt - timedelta(minutes=1))},
        ), self.user)
        response = task_complete(request, task.pk)

        task.refresh_from_db()
        self.assertJSONEqual(response.content, {'status': 'skipped', 'reason': 'newer_server_version'})
        self.assertFalse(task.completed)

    def test_newer_offline_complete_is_applied(self):
        task = Task.objects.create(user=self.user, title='Pain', project=self.project)
        server_dt = timezone.now()
        task.updated_at = server_dt
        task.save(update_fields=['updated_at'])
        op_ms = self._ms(server_dt + timedelta(minutes=1))

        request = with_user(self.factory.post(
            f'/task/{task.pk}/complete/',
            data={'offline_ts': op_ms},
        ), self.user)
        task_complete(request, task.pk)

        task.refresh_from_db()
        self.assertTrue(task.completed)
        self.assertEqual(self._ms(task.updated_at), op_ms)

    def test_older_offline_edit_is_skipped(self):
        task = Task.objects.create(user=self.user, title='Pain', project=self.project)
        server_dt = timezone.now()
        task.updated_at = server_dt
        task.save(update_fields=['updated_at'])

        request = with_user(self.factory.post(f'/task/{task.pk}/edit/', data={
            'offline_ts': self._ms(server_dt - timedelta(minutes=1)),
            'title': 'Pain modifié',
            'description': '',
            'priority': task.priority,
            'project_id': self.project.pk,
            'section_id': '',
            'parent_id': '',
        }), self.user)
        response = task_edit(request, task.pk)

        task.refresh_from_db()
        self.assertJSONEqual(response.content, {'status': 'skipped', 'reason': 'newer_server_version'})
        self.assertEqual(task.title, 'Pain')
