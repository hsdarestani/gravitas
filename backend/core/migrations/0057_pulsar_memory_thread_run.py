from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0056_pulsar_user_memory_profile'),
    ]

    operations = [
        migrations.CreateModel(
            name='PulsarThread',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('thread_key', models.CharField(max_length=160)),
                ('title', models.CharField(blank=True, max_length=240)),
                ('current_surface', models.CharField(default='unknown', max_length=32)),
                ('current_skill', models.CharField(default='general', max_length=40)),
                ('status', models.CharField(choices=[('active', 'Active'), ('waiting', 'Waiting'), ('completed', 'Completed')], default='active', max_length=16)),
                ('state', models.JSONField(blank=True, default=dict)),
                ('context_snapshot', models.JSONField(blank=True, default=dict)),
                ('last_run_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_pulsar_threads', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-updated_at']},
        ),
        migrations.CreateModel(
            name='PulsarMemoryEntry',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(choices=[('episodic', 'Episodic'), ('semantic', 'Semantic'), ('preference', 'Preference')], db_index=True, max_length=16)),
                ('content', models.TextField()),
                ('scope', models.JSONField(blank=True, default=dict)),
                ('source_kind', models.CharField(default='user', max_length=40)),
                ('source_ref', models.CharField(blank=True, max_length=240)),
                ('source_url', models.URLField(blank=True, max_length=1000)),
                ('confidence', models.FloatField(default=1.0)),
                ('fingerprint', models.CharField(max_length=64)),
                ('is_active', models.BooleanField(db_index=True, default=True)),
                ('last_verified_at', models.DateTimeField(blank=True, null=True)),
                ('expires_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_pulsar_memories', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-updated_at']},
        ),
        migrations.CreateModel(
            name='PulsarRun',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('run_id', models.CharField(max_length=32, unique=True)),
                ('surface', models.CharField(default='unknown', max_length=32)),
                ('skill', models.CharField(default='general', max_length=40)),
                ('status', models.CharField(choices=[('running', 'Running'), ('waiting_user', 'Waiting for user'), ('waiting_time', 'Waiting for time'), ('completed', 'Completed'), ('failed', 'Failed'), ('cancelled', 'Cancelled')], default='running', max_length=20)),
                ('input_text', models.TextField(blank=True)),
                ('output_text', models.TextField(blank=True)),
                ('state', models.JSONField(blank=True, default=dict)),
                ('provider', models.CharField(blank=True, max_length=120)),
                ('model_name', models.CharField(blank=True, max_length=240)),
                ('wait_until', models.DateTimeField(blank=True, null=True)),
                ('error_code', models.CharField(blank=True, max_length=240)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('thread', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='runs', to='core.pulsarthread')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_pulsar_runs', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.AddConstraint(
            model_name='pulsarthread',
            constraint=models.UniqueConstraint(fields=('user', 'thread_key'), name='unique_pulsar_thread_user_key'),
        ),
        migrations.AddConstraint(
            model_name='pulsarmemoryentry',
            constraint=models.UniqueConstraint(fields=('user', 'fingerprint'), name='unique_pulsar_memory_fingerprint'),
        ),
        migrations.AddIndex(
            model_name='pulsarmemoryentry',
            index=models.Index(fields=['user', 'kind', 'is_active', '-updated_at'], name='pulsar_mem_user_kind'),
        ),
        migrations.AddIndex(
            model_name='pulsarrun',
            index=models.Index(fields=['user', 'status', '-created_at'], name='pulsar_run_user_status'),
        ),
    ]
