"""Index Core task activity without locking production event writes on PostgreSQL."""

from django.db import migrations, models


INDEX_NAME = 'grav_activity_task_recent'


def create_task_history_index(apps, schema_editor):
    model = apps.get_model('core', 'ActivityEvent')
    index = models.Index(
        fields=['layer', 'object_type', 'object_id', '-created_at'],
        name=INDEX_NAME,
    )
    if schema_editor.connection.vendor == 'postgresql':
        table = schema_editor.quote_name(model._meta.db_table)
        name = schema_editor.quote_name(INDEX_NAME)
        schema_editor.execute(
            f'CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} '
            '("layer", "object_type", "object_id", "created_at" DESC)'
        )
    else:
        schema_editor.add_index(model, index)


def drop_task_history_index(apps, schema_editor):
    model = apps.get_model('core', 'ActivityEvent')
    index = models.Index(
        fields=['layer', 'object_type', 'object_id', '-created_at'],
        name=INDEX_NAME,
    )
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute(
            f'DROP INDEX CONCURRENTLY IF EXISTS {schema_editor.quote_name(INDEX_NAME)}'
        )
    else:
        schema_editor.remove_index(model, index)


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ('core', '0070_project_private_providers_and_drafts'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(
                    create_task_history_index,
                    drop_task_history_index,
                    atomic=False,
                ),
            ],
            state_operations=[
                migrations.AddIndex(
                    model_name='activityevent',
                    index=models.Index(
                        fields=['layer', 'object_type', 'object_id', '-created_at'],
                        name=INDEX_NAME,
                    ),
                ),
            ],
        ),
    ]
