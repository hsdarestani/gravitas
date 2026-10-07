from django.db import migrations


CANONICAL_MARKER = 'upcoming-sprint-backlog-20261001'
DUPLICATE_MARKER = 'sprint02-priority-backlog-20261001'


def reconcile_duplicate_sprint_backlog(apps, schema_editor):
    db_alias = schema_editor.connection.alias
    OperatingTask = apps.get_model('core', 'OperatingTask')

    # Both 0050 branches may run on an environment once the migration graph is
    # merged. Keep the canonical user-requested backlog and remove only the
    # concurrently seeded duplicate set.
    OperatingTask.objects.using(db_alias).filter(
        description__startswith=f'[{DUPLICATE_MARKER}]'
    ).delete()

    # Reassert the explicit user priority order for the canonical backlog.
    canonical = list(
        OperatingTask.objects.using(db_alias)
        .filter(description__startswith=f'[{CANONICAL_MARKER}]')
        .order_by('board_order', 'id')
    )
    for rank, task in enumerate(canonical, start=1):
        changed = []
        if task.status != 'draft':
            task.status = 'draft'
            changed.append('status')
        if task.board_order != rank:
            task.board_order = rank
            changed.append('board_order')
        if changed:
            task.save(using=db_alias, update_fields=changed + ['updated_at'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0050_seed_sprint_two_priority_backlog'),
        ('core', '0050_seed_upcoming_sprint_backlog'),
    ]

    operations = [
        migrations.RunPython(
            reconcile_duplicate_sprint_backlog,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
