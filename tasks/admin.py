from django.contrib import admin
from .models import Label, Project, Section, Task

admin.site.register(Label)
admin.site.register(Project)
admin.site.register(Section)

@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ['title', 'project', 'section', 'parent', 'priority', 'label', 'completed']
    list_filter = ['project', 'priority', 'completed', 'label']
    search_fields = ['title']
