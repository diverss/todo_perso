from django.contrib import admin
from .models import AppSettings, Label, Project, Section, Task, TaskImage


@admin.register(Label)
class LabelAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'color', 'order']
    list_filter = ['user']
    search_fields = ['name', 'user__username']


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'is_inbox', 'order']
    list_filter = ['user', 'is_inbox']
    search_fields = ['name', 'user__username']


@admin.register(Section)
class SectionAdmin(admin.ModelAdmin):
    list_display = ['name', 'project', 'user', 'is_favorite', 'has_recurring_tasks', 'order']
    list_filter = ['user', 'project', 'is_favorite', 'has_recurring_tasks']
    search_fields = ['name', 'project__name', 'user__username']


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ['title', 'user', 'project', 'section', 'parent', 'priority', 'label', 'completed', 'completed_at']
    list_filter = ['user', 'project', 'priority', 'completed', 'label']
    search_fields = ['title', 'user__username']


@admin.register(TaskImage)
class TaskImageAdmin(admin.ModelAdmin):
    list_display = ['original_filename', 'task', 'uploaded_at']
    search_fields = ['original_filename', 'task__title', 'task__user__username']


@admin.register(AppSettings)
class AppSettingsAdmin(admin.ModelAdmin):
    list_display = ['user', 'default_view_type', 'default_project', 'default_label']
    list_filter = ['default_view_type']
    search_fields = ['user__username']
