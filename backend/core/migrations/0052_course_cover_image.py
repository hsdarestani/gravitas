from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0051_merge_sprint_backlog_branches'),
    ]

    operations = [
        migrations.AddField(
            model_name='course',
            name='cover_image',
            field=models.TextField(blank=True, default=''),
        ),
    ]
