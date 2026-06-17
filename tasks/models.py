import os
from django.db import models


class Label(models.Model):
    name = models.CharField(max_length=100)
    color = models.CharField(max_length=7, default='#6c757d')
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'name']

    def __str__(self):
        return self.name


class Project(models.Model):
    name = models.CharField(max_length=200)
    color = models.CharField(max_length=7, default='#5b8def')
    order = models.PositiveIntegerField(default=0)
    is_inbox = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'name']

    def __str__(self):
        return self.name


class Section(models.Model):
    name = models.CharField(max_length=200)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='sections')
    order = models.PositiveIntegerField(default=0)
    is_favorite = models.BooleanField(default=False)
    favorite_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'name']

    def __str__(self):
        return f'{self.project.name} / {self.name}'


class Task(models.Model):
    PRIORITY_CHOICES = [
        (1, 'Priorité 1'),
        (2, 'Priorité 2'),
        (3, 'Priorité 3'),
        (4, 'Priorité 4'),
    ]

    title = models.CharField(max_length=500)
    description = models.TextField(blank=True)
    priority = models.PositiveSmallIntegerField(choices=PRIORITY_CHOICES, default=4)
    label = models.ForeignKey(Label, on_delete=models.SET_NULL, null=True, blank=True, related_name='tasks')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='tasks')
    section = models.ForeignKey(Section, on_delete=models.SET_NULL, null=True, blank=True, related_name='tasks')
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='subtasks')
    order = models.PositiveIntegerField(default=0)
    label_order = models.PositiveIntegerField(null=True, blank=True)
    completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'created_at']

    def __str__(self):
        return self.title

    @property
    def priority_color(self):
        colors = {1: '#db4035', 2: '#ff9933', 3: '#4073ff', 4: ''}
        return colors.get(self.priority, '')


class AppSettings(models.Model):
    VIEW_FIRST_PROJECT = 'first_project'
    VIEW_PROJECT = 'project'
    VIEW_LABEL = 'label'
    VIEW_CHOICES = [
        (VIEW_FIRST_PROJECT, 'Premier projet'),
        (VIEW_PROJECT, 'Projet spécifique'),
        (VIEW_LABEL, 'Étiquette spécifique'),
    ]
    default_view_type = models.CharField(max_length=20, choices=VIEW_CHOICES, default=VIEW_FIRST_PROJECT)
    default_project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    default_label = models.ForeignKey(Label, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        verbose_name = 'Paramètres'

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


def _image_upload_path(instance, filename):
    return f'task_images/{instance.task_id}/{filename}'


class TaskImage(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='images')
    image = models.FileField(upload_to=_image_upload_path)
    original_filename = models.CharField(max_length=255, blank=True)
    file_size = models.PositiveIntegerField(default=0)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['uploaded_at']

    def __str__(self):
        return self.original_filename

    def delete(self, *args, **kwargs):
        self.image.delete(save=False)
        super().delete(*args, **kwargs)
