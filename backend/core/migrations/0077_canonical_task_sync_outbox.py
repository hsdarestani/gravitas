"""Queue accepted task edits for durable, deferred Canonical DAV synchronization."""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0076_google_task_delete_outbox')]
    operations = [
        migrations.CreateModel(
            name='CanonicalTaskSyncOutbox',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False, auto_created=True, verbose_name='ID')),
                ('task_id', models.PositiveBigIntegerField()),
                ('generation', models.PositiveBigIntegerField(default=0)),
                ('attempts', models.PositiveIntegerField(default=0)),
                ('next_attempt_at', models.DateTimeField(db_index=True)),
                ('state', models.CharField(max_length=16, default='pending')),
                ('last_error', models.CharField(max_length=128, blank=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='core.researchproject')),
            ],
            options={'constraints': [
                models.UniqueConstraint(fields=['project','task_id'], name='canonical_task_sync_unique')
            ]},
        ),
    ]
