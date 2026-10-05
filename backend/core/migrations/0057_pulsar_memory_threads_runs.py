import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0056_pulsar_user_memory_profile'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='PulsarThread',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('public_id', models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ('title', models.CharField(blank=True, max_length=240)),
                ('status', models.CharField(choices=[('active', 'Active'), ('closed', 'Closed')], db_index=True, default='active', max_length=16)),
                ('primary_surface', models.CharField(blank=True, max_length=32)),
                ('resource_scope', models.JSONField(blank=True, default=dict)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('last_active_at', models.DateTimeField(auto_now=True, db_index=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_pulsar_threads', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-last_active_at']},
        ),
        migrations.CreateModel(
            name='PulsarTurn',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('role', models.CharField(choices=[('user', 'User'), ('assistant', 'Assistant'), ('system', 'System'), ('tool', 'Tool')], max_length=16)),
                ('surface', models.CharField(max_length=32)),
                ('skill', models.CharField(blank=True, max_length=48)),
                ('run_id', models.CharField(blank=True, db_index=True, max_length=64)),
                ('content', models.TextField()),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('thread', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='turns', to='core.pulsarthread')),
            ],
            options={'ordering': ['created_at', 'id']},
        ),
        migrations.CreateModel(
            name='PulsarMemoryItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(choices=[('working', 'Working'), ('episodic', 'Episodic'), ('semantic', 'Semantic')], db_index=True, max_length=16)),
                ('scope_type', models.CharField(db_index=True, default='global', max_length=32)),
                ('scope_key', models.CharField(blank=True, db_index=True, max_length=160)),
                ('memory_key', models.CharField(blank=True, max_length=200)),
                ('content', models.TextField()),
                ('source_type', models.CharField(blank=True, max_length=48)),
                ('source_id', models.CharField(blank=True, max_length=160)),
                ('confidence', models.FloatField(default=1.0)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('active', models.BooleanField(db_index=True, default=True)),
                ('last_verified_at', models.DateTimeField(blank=True, null=True)),
                ('stale_after', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True, db_index=True)),
                ('thread', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='memory_items', to='core.pulsarthread')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_pulsar_memories', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-updated_at']},
        ),
        migrations.CreateModel(
            name='PulsarRun',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('run_id', models.CharField(max_length=64, unique=True)),
                ('surface', models.CharField(max_length=32)),
                ('skill', models.CharField(max_length=48)),
                ('status', models.CharField(choices=[('running', 'Running'), ('waiting_user', 'Waiting for user'), ('waiting_time', 'Waiting for time'), ('waiting_event', 'Waiting for event'), ('completed', 'Completed'), ('failed', 'Failed'), ('cancelled', 'Cancelled')], db_index=True, default='running', max_length=24)),
                ('state', models.JSONField(blank=True, default=dict)),
                ('result_summary', models.TextField(blank=True)),
                ('error_code', models.CharField(blank=True, max_length=120)),
                ('wake_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('thread', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='runs', to='core.pulsarthread')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='gravitas_pulsar_runs', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-updated_at']},
        ),
        migrations.AddField(
            model_name='telegrampulsarsession',
            name='pulsar_thread',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='telegram_sessions', to='core.pulsarthread'),
        ),
        migrations.AddIndex(model_name='pulsarthread', index=models.Index(fields=['user', 'status', '-last_active_at'], name='pulsar_thread_user_active')),
        migrations.AddIndex(model_name='pulsarturn', index=models.Index(fields=['thread', '-created_at'], name='pulsar_turn_thread_recent')),
        migrations.AddIndex(model_name='pulsarmemoryitem', index=models.Index(fields=['user', 'kind', 'active', '-updated_at'], name='pulsar_memory_user_kind')),
        migrations.AddIndex(model_name='pulsarmemoryitem', index=models.Index(fields=['user', 'scope_type', 'scope_key'], name='pulsar_memory_scope')),
        migrations.AddIndex(model_name='pulsarrun', index=models.Index(fields=['user', 'status', '-updated_at'], name='pulsar_run_user_status')),
    ]
