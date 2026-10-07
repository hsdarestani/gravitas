from django.db import migrations


def clear_legacy_operating_tasks(apps, schema_editor):
    OperatingTask = apps.get_model('core', 'OperatingTask')
    OperatingTask.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0031_research_intelligence_history'),
    ]

    operations = [
        migrations.RunPython(
            clear_legacy_operating_tasks,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
