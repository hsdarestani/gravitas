"""External task bookmarks; separate from attachments and imported provenance."""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0074_operating_task_consolidation'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='OperatingTaskExternalLink',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=200)),
                ('url', models.URLField(max_length=2000)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('added_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='gravitas_task_external_links_added',
                    to=settings.AUTH_USER_MODEL)),
                ('task', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='external_links',
                    to='core.operatingtask')),
            ],
            options={
                'ordering': ['created_at', 'id'],
                'constraints': [
                    models.UniqueConstraint(fields=['task', 'url'], name='grav_task_link_unique_url'),
                ],
            },
        ),
    ]
