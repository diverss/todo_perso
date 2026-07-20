from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0008_user_ownership'),
    ]

    operations = [
        migrations.AddField(
            model_name='task',
            name='due_date',
            field=models.DateField(blank=True, null=True),
        ),
    ]
