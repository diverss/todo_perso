from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0004_task_label_order'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='is_inbox',
            field=models.BooleanField(default=False),
        ),
    ]
