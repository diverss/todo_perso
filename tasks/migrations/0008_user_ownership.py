from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.db import migrations, models
import django.db.models.deletion


def assign_existing_items_to_owner(apps, schema_editor):
    user_app_label, user_model_name = settings.AUTH_USER_MODEL.split('.')
    User = apps.get_model(user_app_label, user_model_name)
    Label = apps.get_model('tasks', 'Label')
    Project = apps.get_model('tasks', 'Project')
    Section = apps.get_model('tasks', 'Section')
    Task = apps.get_model('tasks', 'Task')
    AppSettings = apps.get_model('tasks', 'AppSettings')

    owner = (
        User.objects.filter(is_superuser=True).order_by('id').first()
        or User.objects.order_by('id').first()
    )
    if owner is None:
        owner = User.objects.create(
            username='todo_owner',
            password=make_password(None),
            is_active=True,
            is_staff=True,
            is_superuser=True,
        )

    Project.objects.filter(user__isnull=True).update(user_id=owner.pk)
    Label.objects.filter(user__isnull=True).update(user_id=owner.pk)

    for section in Section.objects.filter(user__isnull=True).select_related('project'):
        section.user_id = section.project.user_id if section.project_id else owner.pk
        section.save(update_fields=['user'])

    for task in Task.objects.filter(user__isnull=True).select_related('project'):
        task.user_id = task.project.user_id if task.project_id else owner.pk
        task.save(update_fields=['user'])

    for index, item in enumerate(AppSettings.objects.filter(user__isnull=True).order_by('id')):
        if index > 0:
            item.delete()
            continue
        item.user_id = owner.pk
        item.save(update_fields=['user'])


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('tasks', '0007_task_updated_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='label',
            name='user',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='labels', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='project',
            name='user',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='projects', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='section',
            name='user',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='sections', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='task',
            name='user',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='tasks', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='appsettings',
            name='user',
            field=models.OneToOneField(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='todo_settings', to=settings.AUTH_USER_MODEL),
        ),
        migrations.RunPython(assign_existing_items_to_owner, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='label',
            name='user',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='labels', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AlterField(
            model_name='project',
            name='user',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='projects', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AlterField(
            model_name='section',
            name='user',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sections', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AlterField(
            model_name='task',
            name='user',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='tasks', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AlterField(
            model_name='appsettings',
            name='user',
            field=models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='todo_settings', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddIndex(
            model_name='label',
            index=models.Index(fields=['user', 'order', 'name'], name='label_user_order_name_idx'),
        ),
        migrations.AddIndex(
            model_name='project',
            index=models.Index(fields=['user', 'is_inbox', 'order', 'name'], name='project_user_inbox_order_idx'),
        ),
        migrations.AddIndex(
            model_name='section',
            index=models.Index(fields=['user', 'project', 'order', 'name'], name='section_user_project_order_idx'),
        ),
        migrations.AddIndex(
            model_name='section',
            index=models.Index(fields=['user', 'is_favorite', 'favorite_order'], name='section_user_favorite_idx'),
        ),
        migrations.AddIndex(
            model_name='task',
            index=models.Index(fields=['user', 'project', 'completed', 'parent', 'section', 'order'], name='task_user_project_vis_idx'),
        ),
        migrations.AddIndex(
            model_name='task',
            index=models.Index(fields=['user', 'label', 'completed', 'label_order', 'order'], name='task_user_label_vis_idx'),
        ),
    ]
