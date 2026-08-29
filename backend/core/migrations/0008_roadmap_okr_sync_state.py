from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0007_dual_workspace_collaboration'),
    ]

    operations = [
        migrations.CreateModel(
            name='RoadmapOKRSyncState',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('source_url', models.URLField(blank=True, max_length=500)),
                ('source_revision', models.CharField(blank=True, max_length=64)),
                ('bindings', models.JSONField(blank=True, default=dict)),
                ('last_attempted_at', models.DateTimeField(blank=True, null=True)),
                ('last_synced_at', models.DateTimeField(blank=True, null=True)),
                ('last_error', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('workspace', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='roadmap_okr_sync_state', to='core.workspace')),
            ],
            options={
                'verbose_name': 'Roadmap OKR sync state',
                'verbose_name_plural': 'Roadmap OKR sync states',
            },
        ),
    ]
