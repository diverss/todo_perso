from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0009_task_due_date'),
    ]

    operations = [
        migrations.AddField(
            model_name='section',
            name='has_recurring_tasks',
            field=models.BooleanField(default=False),
        ),
    ]
