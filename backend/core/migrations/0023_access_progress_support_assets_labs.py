from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0022_account_identity_fields'),
    ]

    operations = [
        migrations.CreateModel(
            name='InteractiveLab',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('slug', models.SlugField(max_length=180, unique=True)),
                ('title', models.CharField(max_length=240)),
                ('summary', models.TextField(blank=True)),
                ('description', models.TextField(blank=True)),
                ('duration_text', models.CharField(blank=True, max_length=80)),
                ('status', models.CharField(choices=[('draft', 'Draft'), ('published', 'Published')], db_index=True, default='draft', max_length=16)),
                ('files', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_interactive_labs', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-updated_at']},
        ),
        migrations.CreateModel(
            name='NewsletterCampaign',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('subject', models.CharField(max_length=240)),
                ('body', models.TextField()),
                ('sent_count', models.PositiveIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_newsletter_campaigns', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='SupportTicket',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('subject', models.CharField(max_length=240)),
                ('status', models.CharField(choices=[('open', 'Open'), ('waiting_member', 'Waiting for member'), ('waiting_team', 'Waiting for Gravitas+'), ('resolved', 'Resolved'), ('closed', 'Closed')], db_index=True, default='open', max_length=24)),
                ('priority', models.CharField(choices=[('normal', 'Normal'), ('high', 'High')], default='normal', max_length=16)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_support_tickets', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-updated_at'],
                'indexes': [models.Index(fields=['status', '-updated_at'], name='grav_ticket_status_recent')],
            },
        ),
        migrations.CreateModel(
            name='TopicProgress',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('video_viewed', models.BooleanField(default=False)),
                ('commented', models.BooleanField(default=False)),
                ('voted', models.BooleanField(default=False)),
                ('simulation_played', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('topic', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='member_progress', to='core.contentitem')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_topic_progress', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-updated_at'],
                'constraints': [models.UniqueConstraint(fields=('user', 'topic'), name='unique_gravitas_topic_progress')],
            },
        ),
        migrations.CreateModel(
            name='SupportMessage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('body', models.TextField(max_length=10000)),
                ('is_team_reply', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('author', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_support_messages', to=settings.AUTH_USER_MODEL)),
                ('ticket', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='messages', to='core.supportticket')),
            ],
            options={'ordering': ['created_at', 'id']},
        ),
        migrations.CreateModel(
            name='ContentWorkComment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('body', models.TextField(max_length=10000)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('author', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_content_work_comments', to=settings.AUTH_USER_MODEL)),
                ('item', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comments', to='core.contentworkitem')),
            ],
            options={'ordering': ['created_at', 'id']},
        ),
        migrations.CreateModel(
            name='ContentWorkAttachment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=255)),
                ('storage_path', models.CharField(max_length=1000)),
                ('mime_type', models.CharField(blank=True, max_length=160)),
                ('size', models.PositiveBigIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('item', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='attachments', to='core.contentworkitem')),
                ('uploader', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_content_work_attachments', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['created_at', 'id']},
        ),
        migrations.CreateModel(
            name='CoreAsset',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=240)),
                ('kind', models.CharField(choices=[('file', 'File'), ('url', 'URL')], db_index=True, default='file', max_length=16)),
                ('description', models.TextField(blank=True)),
                ('source_url', models.URLField(blank=True, max_length=1600)),
                ('storage_path', models.CharField(blank=True, max_length=1000)),
                ('original_name', models.CharField(blank=True, max_length=255)),
                ('mime_type', models.CharField(blank=True, max_length=160)),
                ('file_size', models.PositiveBigIntegerField(default=0)),
                ('visible_to_all_core', models.BooleanField(db_index=True, default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('uploader', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='gravitas_core_assets_uploaded', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-updated_at']},
        ),
        migrations.CreateModel(
            name='CoreAssetAccess',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('can_edit', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('asset', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='access_grants', to='core.coreasset')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_core_asset_access', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'constraints': [models.UniqueConstraint(fields=('asset', 'user'), name='unique_gravitas_core_asset_access')],
            },
        ),
    ]
