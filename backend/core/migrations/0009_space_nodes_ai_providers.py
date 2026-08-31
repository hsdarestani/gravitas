from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '0008_roadmap_okr_sync_state'),
    ]

    operations = [
        migrations.CreateModel(
            name='SpaceNode',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(choices=[('subspace', 'Subspace'), ('category', 'Category')], max_length=16)),
                ('title', models.CharField(max_length=180)),
                ('storage_name', models.CharField(max_length=240)),
                ('folder_path', models.CharField(max_length=1000)),
                ('markdown_path', models.CharField(max_length=1000)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('sync_state', models.CharField(choices=[('synced', 'Synced'), ('pending', 'Pending'), ('conflict', 'Conflict'), ('error', 'Error')], default='pending', max_length=16)),
                ('sync_hash', models.CharField(blank=True, max_length=128)),
                ('last_synced_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_space_nodes', to=settings.AUTH_USER_MODEL)),
                ('parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='children', to='core.spacenode')),
            ],
            options={'ordering': ['folder_path']},
        ),
        migrations.CreateModel(
            name='ProjectSpacePlacement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('storage_name', models.CharField(max_length=240)),
                ('folder_path', models.CharField(max_length=1000)),
                ('markdown_path', models.CharField(max_length=1000)),
                ('sync_state', models.CharField(choices=[('synced', 'Synced'), ('pending', 'Pending'), ('conflict', 'Conflict'), ('error', 'Error')], default='pending', max_length=16)),
                ('sync_hash', models.CharField(blank=True, max_length=128)),
                ('last_synced_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_project_space_placements', to=settings.AUTH_USER_MODEL)),
                ('parent', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='projects', to='core.spacenode')),
                ('project', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='space_placement', to='core.researchproject')),
            ],
        ),
        migrations.CreateModel(
            name='NoteSpacePlacement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('storage_name', models.CharField(max_length=240)),
                ('markdown_path', models.CharField(max_length=1000)),
                ('attachments_path', models.CharField(max_length=1000)),
                ('sync_state', models.CharField(choices=[('synced', 'Synced'), ('pending', 'Pending'), ('conflict', 'Conflict'), ('error', 'Error')], default='pending', max_length=16)),
                ('sync_hash', models.CharField(blank=True, max_length=128)),
                ('last_synced_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_note_space_placements', to=settings.AUTH_USER_MODEL)),
                ('parent_note', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='children', to='core.notespaceplacement')),
                ('project', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='space_notes', to='core.researchproject')),
                ('resource', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='space_placement', to='core.knowledgeresource')),
                ('space_parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='notes', to='core.spacenode')),
            ],
            options={'ordering': ['markdown_path']},
        ),
        migrations.CreateModel(
            name='AIProviderAccount',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('provider', models.CharField(choices=[('nextcloud', 'Nextcloud AI'), ('gravitas', 'Gravitas AI'), ('openai', 'OpenAI'), ('anthropic', 'Anthropic'), ('gemini', 'Google Gemini'), ('openai_compatible', 'OpenAI-compatible')], max_length=32)),
                ('label', models.CharField(max_length=120)),
                ('model', models.CharField(blank=True, max_length=180)),
                ('base_url', models.URLField(blank=True, max_length=1000)),
                ('encrypted_api_key', models.TextField(blank=True)),
                ('enabled', models.BooleanField(default=True)),
                ('is_default', models.BooleanField(default=False)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_ai_providers', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-is_default', 'label']},
        ),
        migrations.AddConstraint(
            model_name='spacenode',
            constraint=models.UniqueConstraint(fields=('owner', 'parent', 'storage_name'), name='unique_space_node_sibling'),
        ),
        migrations.AddConstraint(
            model_name='aiprovideraccount',
            constraint=models.UniqueConstraint(fields=('user', 'label'), name='unique_user_ai_provider_label'),
        ),
    ]
