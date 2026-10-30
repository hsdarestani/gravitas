from django.db import migrations, models
import django.utils.timezone


def recover(apps, schema_editor):
    from core.task_dates import recover_task_dates
    result = recover_task_dates(apps=apps, using=schema_editor.connection.alias, apply=True)
    print('Task date recovery:', result)


class Migration(migrations.Migration):
    dependencies = [('core', '0082_lab_studio_snapshots')]
    operations = [
        migrations.AlterField(model_name='operatingtask', name='created_at',
            field=models.DateTimeField(default=django.utils.timezone.now)),
        migrations.AddField(model_name='operatingtask', name='started_at',
            field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name='operatingtask', name='date_provenance',
            field=models.JSONField(blank=True, default=dict)),
        migrations.RunPython(recover, migrations.RunPython.noop),
    ]
