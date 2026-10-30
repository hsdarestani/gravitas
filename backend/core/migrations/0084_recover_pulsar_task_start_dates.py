from django.db import migrations


def recover(apps, schema_editor):
    from core.task_dates import recover_task_dates
    print('Task source date recovery:', recover_task_dates(
        apps=apps, using=schema_editor.connection.alias, apply=True))


class Migration(migrations.Migration):
    dependencies = [('core', '0083_task_lifecycle_dates')]
    operations = [migrations.RunPython(recover, migrations.RunPython.noop)]
