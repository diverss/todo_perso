from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0005_project_is_inbox'),
    ]

    operations = [
        migrations.AddField(
            model_name='section',
            name='favorite_order',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='section',
            name='is_favorite',
            field=models.BooleanField(default=False),
        ),
    ]
