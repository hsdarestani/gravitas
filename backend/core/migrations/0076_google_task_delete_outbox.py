"""Durable asynchronous cleanup of Google Tasks after local task deletion."""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0075_operating_task_external_links'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='GoogleTaskDeleteOutbox',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('tasklist_id', models.CharField(default='@default', max_length=255)),
                ('google_task_id', models.CharField(max_length=1024)),
                ('task_id_at_deletion', models.BigIntegerField()),
                ('attempts', models.PositiveSmallIntegerField(default=0)),
                ('next_attempt_at', models.DateTimeField(default=django.utils.timezone.now, db_index=True)),
                ('last_error', models.CharField(max_length=160, blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='gravitas_google_task_delete_jobs',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['next_attempt_at', 'id'],
                'constraints': [
                    models.UniqueConstraint(
                        fields=['user', 'tasklist_id', 'google_task_id'],
                        name='unique_google_task_delete_job',
                    ),
                ],
            },
        ),
    ]
