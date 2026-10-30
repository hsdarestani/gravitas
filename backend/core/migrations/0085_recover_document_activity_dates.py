from django.db import migrations


def recover(apps, schema_editor):
    from core.task_document_dates import recover_document_dates
    print('Document task date recovery:', recover_document_dates(
        apps=apps, using=schema_editor.connection.alias, apply=True))


class Migration(migrations.Migration):
    dependencies = [('core', '0084_recover_pulsar_task_start_dates')]
    operations = [migrations.RunPython(recover, migrations.RunPython.noop)]
