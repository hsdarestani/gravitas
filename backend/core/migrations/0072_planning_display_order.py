"""Deterministic, reversible, low-volume ordering for the OKR planning board."""
from django.db import migrations, models


def seed_positions(apps, schema_editor):
    Objective = apps.get_model('core', 'StrategicObjective')
    KR = apps.get_model('core', 'KeyResult')
    objectives = Objective.objects.order_by('workspace_id', 'due_date', 'id')
    last_workspace = None
    position = 0
    for obj in objectives.iterator(chunk_size=200):
        if obj.workspace_id != last_workspace:
            position = 0
            last_workspace = obj.workspace_id
        position += 100
        Objective.objects.filter(pk=obj.pk).update(sort_order=position)

    last_objective = None
    position = 0
    for kr in KR.objects.order_by('objective_id', 'due_date', 'id').iterator(chunk_size=200):
        if kr.objective_id != last_objective:
            position = 0
            last_objective = kr.objective_id
        position += 100
        KR.objects.filter(pk=kr.pk).update(sort_order=position)


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0071_index_task_activity'),
    ]

    operations = [
        migrations.AddField(
            model_name='strategicobjective',
            name='source_locked',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='keyresult',
            name='source_locked',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='strategicobjective',
            name='sort_order',
            field=models.PositiveIntegerField(default=0, db_index=True),
        ),
        migrations.AddField(
            model_name='keyresult',
            name='sort_order',
            field=models.PositiveIntegerField(default=0, db_index=True),
        ),
        migrations.RunPython(seed_positions, migrations.RunPython.noop),
    ]
