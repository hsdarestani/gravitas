from django.db import migrations
from django.db.models import Q


AUTO_DESCRIPTIONS = (
    'Roadmap execution task for ',
    'Roadmap kickoff task for ',
)


def purge_legacy_auto_roadmap_tasks(apps, schema_editor):
    OperatingTask = apps.get_model('core', 'OperatingTask')
    db_alias = schema_editor.connection.alias

    predicate = Q()
    for prefix in AUTO_DESCRIPTIONS:
        predicate |= Q(description__startswith=prefix)

    qs = OperatingTask.objects.using(db_alias).filter(predicate)
    count = qs.count()
    qs.delete()
    print(f'Removed {count} legacy auto-generated Roadmap task(s); manager-defined tasks preserved.')


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0037_improve_sprint_one_task_descriptions'),
    ]

    operations = [
        migrations.RunPython(
            purge_legacy_auto_roadmap_tasks,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
