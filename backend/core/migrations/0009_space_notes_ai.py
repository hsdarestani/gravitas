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
                ('kind', models.CharField(choices=[('subspace', 'Subspace'), ('category', 'Category')], db_index=True, max_length=16)),
                ('title', models.CharField(max_length=220)),
                ('filesystem_name', models.CharField(max_length=240)),
                ('nextcloud_path', models.CharField(max_length=1000)),
                ('content_hash', models.CharField(blank=True, max_length=80)),
                ('sync_state', models.CharField(db_index=True, default='pending', max_length=24)),
                ('sync_error', models.CharField(blank=True, max_length=240)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_space_nodes', to=settings.AUTH_USER_MODEL)),
                ('parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='children', to='core.spacenode')),
            ],
            options={'ordering': ['nextcloud_path']},
        ),
        migrations.CreateModel(
            name='ProjectSpaceLink',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('folder_path', models.CharField(max_length=1000)),
                ('metadata_path', models.CharField(max_length=1000)),
                ('content_hash', models.CharField(blank=True, max_length=80)),
                ('sync_state', models.CharField(db_index=True, default='pending', max_length=24)),
                ('sync_error', models.CharField(blank=True, max_length=240)),
                ('last_synced_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('category', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='projects', to='core.spacenode')),
                ('project', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='space_link', to='core.researchproject')),
            ],
        ),
        migrations.CreateModel(
            name='NoteSpaceLink',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('note_path', models.CharField(max_length=1000)),
                ('attachments_path', models.CharField(blank=True, max_length=1000)),
                ('content_hash', models.CharField(blank=True, max_length=80)),
                ('sync_state', models.CharField(db_index=True, default='pending', max_length=24)),
                ('sync_error', models.CharField(blank=True, max_length=240)),
                ('last_synced_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('category', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='notes', to='core.spacenode')),
                ('parent_note', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='nested_space_notes', to='core.knowledgeresource')),
                ('resource', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='space_link', to='core.knowledgeresource')),
            ],
        ),
        migrations.CreateModel(
            name='AIProviderCredential',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('provider', models.CharField(choices=[('openai', 'OpenAI'), ('anthropic', 'Anthropic'), ('gemini', 'Google Gemini'), ('openai_compatible', 'OpenAI-compatible')], db_index=True, max_length=32)),
                ('label', models.CharField(max_length=120)),
                ('model', models.CharField(max_length=220)),
                ('base_url', models.URLField(blank=True, max_length=1000)),
                ('encrypted_api_key', models.TextField()),
                ('is_default', models.BooleanField(db_index=True, default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_ai_credentials', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-is_default', 'provider', 'label']},
        ),
        migrations.AddConstraint(
            model_name='spacenode',
            constraint=models.UniqueConstraint(fields=('owner', 'nextcloud_path'), name='unique_gravitas_space_path'),
        ),
        migrations.AddConstraint(
            model_name='spacenode',
            constraint=models.CheckConstraint(condition=models.Q(models.Q(('kind', 'subspace'), ('parent__isnull', True)), ('kind', 'category'), _connector='OR'), name='gravitas_subspace_is_top_level'),
        ),
        migrations.AddConstraint(
            model_name='aiprovidercredential',
            constraint=models.UniqueConstraint(fields=('user', 'provider', 'label'), name='unique_gravitas_ai_provider_label'),
        ),
    ]
