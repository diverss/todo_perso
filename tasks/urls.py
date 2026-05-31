from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('project/<int:project_id>/', views.project_view, name='project'),
    path('label/<int:label_id>/', views.label_view, name='label'),

    # Projects
    path('project/create/', views.project_create, name='project_create'),
    path('project/<int:project_id>/edit/', views.project_edit, name='project_edit'),
    path('project/<int:project_id>/delete/', views.project_delete, name='project_delete'),

    # Sections
    path('project/<int:project_id>/section/create/', views.section_create, name='section_create'),
    path('section/<int:section_id>/edit/', views.section_edit, name='section_edit'),
    path('section/<int:section_id>/delete/', views.section_delete, name='section_delete'),

    # Tasks
    path('task/create/', views.task_create, name='task_create'),
    path('task/<int:task_id>/', views.task_detail, name='task_detail'),
    path('task/<int:task_id>/edit/', views.task_edit, name='task_edit'),
    path('task/<int:task_id>/complete/', views.task_complete, name='task_complete'),
    path('task/<int:task_id>/delete/', views.task_delete, name='task_delete'),
    path('task/reorder/', views.task_reorder, name='task_reorder'),

    # Labels
    path('label/create/', views.label_create, name='label_create'),
    path('label/<int:label_id>/edit/', views.label_edit, name='label_edit'),
    path('label/<int:label_id>/delete/', views.label_delete, name='label_delete'),

    # API helpers
    path('api/project/<int:project_id>/sections/', views.get_sections_for_project, name='api_sections'),
    path('api/project/<int:project_id>/tasks/', views.get_tasks_for_parent, name='api_tasks'),

    # Images
    path('task/<int:task_id>/images/upload/', views.task_image_upload, name='task_image_upload'),
    path('task/images/<int:image_id>/delete/', views.task_image_delete, name='task_image_delete'),

    # Reorder
    path('project/reorder/', views.project_reorder, name='project_reorder'),
    path('label/reorder/', views.label_reorder, name='label_reorder'),
    path('section/reorder/', views.section_reorder, name='section_reorder'),

    # Settings & maintenance
    path('settings/', views.settings_view, name='settings'),
    path('purge-completed/', views.purge_completed, name='purge_completed'),
]
