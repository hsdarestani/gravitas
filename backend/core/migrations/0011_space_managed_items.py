from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0010_oidc_sso'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='SpaceManagedItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(choices=[('subproject', 'Subproject'), ('task', 'Task'), ('subtask', 'Subtask'), ('repository', 'Repository')], db_index=True, max_length=20)),
                ('title', models.CharField(max_length=240)),
                ('body', models.TextField(blank=True)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('file_path', models.CharField(max_length=1000)),
                ('folder_path', models.CharField(max_length=1000)),
                ('content_hash', models.CharField(blank=True, max_length=80)),
                ('sync_state', models.CharField(db_index=True, default='pending', max_length=24)),
                ('sync_error', models.CharField(blank=True, max_length=240)),
                ('last_synced_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('category', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='managed_items', to='core.spacenode')),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_space_managed_items', to=settings.AUTH_USER_MODEL)),
                ('parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='children', to='core.spacemanageditem')),
                ('project', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='space_managed_items', to='core.researchproject')),
            ],
            options={'ordering': ['file_path']},
        ),
        migrations.AddConstraint(
            model_name='spacemanageditem',
            constraint=models.UniqueConstraint(fields=('owner', 'file_path'), name='unique_gravitas_managed_space_path'),
        ),
        migrations.AddConstraint(
            model_name='spacemanageditem',
            constraint=models.CheckConstraint(condition=models.Q(('project__isnull', False), ('category__isnull', False), ('parent__isnull', False), _connector='OR'), name='gravitas_managed_item_has_parent'),
        ),
    ]
