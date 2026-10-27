"""Allow a child task to inherit its parent's KR without a fake due date.

Production task 858 has an existing initiative but no schedule; before this
migration, PostgreSQL rejected a new unscheduled child with HTTP 500.
Root initiative tasks must still have a cycle, due date, or provenance key.
"""
from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0080_repair_workspace_redesign_task_copy'),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='operatingtask',
            name='grav_task_cycle_or_due',
        ),
        migrations.AddConstraint(
            model_name='operatingtask',
            constraint=models.CheckConstraint(
                condition=(Q(initiative__isnull=True) | Q(cycle__isnull=False)
                           | Q(due_date__isnull=False) | Q(source_key__isnull=False)
                           | Q(parent__isnull=False)),
                name='grav_task_cycle_or_due',
            ),
        ),
    ]
