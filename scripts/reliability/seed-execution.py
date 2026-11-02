"""Isolated acceptance data for the real UI, never permitted in production.

Run after seed-browser.py, using gravitas_backend.test_settings. This creates
the lifecycle in acceptance B, a nested blocked milestone, and 1,000 rows.
All names explicitly identify test fixtures; production analytics are unseeded.
"""
import os
from datetime import datetime, timezone, timedelta

assert os.environ.get('DJANGO_SETTINGS_MODULE') == 'gravitas_backend.test_settings'
import django
django.setup()
from django.conf import settings
from django.contrib.auth import get_user_model
from core.layer_models import ActivityEvent
from core.models import ResearchProject
from core.operating_models import OperatingTask, OperatingMilestone, OperatingProcess, StrategicObjective, KeyResult, Initiative
from core.platform_runtime_v3 import ensure_platform_workspaces

assert settings.DATABASES['default']['ENGINE'] == 'django.db.backends.sqlite3'
user = get_user_model().objects.get(username='workspace-reliability-local')
core = ensure_platform_workspaces(user)['core']
project = ResearchProject.objects.get(title='Workspace reliability browser fixture', owner=user)
process, _ = OperatingProcess.objects.get_or_create(workspace=core, key='research', defaults={'name': 'Research'})
objective, _ = StrategicObjective.objects.get_or_create(workspace=core, title='Execution QA objective', defaults={'owner': user})
kr, _ = KeyResult.objects.get_or_create(objective=objective, title='Execution QA evidence', defaults={'owner': user})
initiative, _ = Initiative.objects.get_or_create(workspace=core, key_result=kr, title='Execution QA initiative', defaults={'owner': user, 'process': process})
milestone, _ = OperatingMilestone.objects.get_or_create(workspace=core, initiative=initiative, title='Acceptance fixture · release readiness', defaults={
    'project': project, 'owner': user, 'due_date': (datetime.now(timezone.utc) + timedelta(days=10)).date()})
parent, _ = OperatingTask.objects.get_or_create(source_key='execution-qa-parent', defaults={
    'workspace': core, 'project': project, 'owner': user, 'milestone': milestone,
    'title': 'Acceptance fixture · evidence review', 'definition_of_done': 'All test evidence reviewed.', 'status': 'active', 'created_at': datetime(2026, 9, 1, tzinfo=timezone.utc)})
for key, title, status, weight in [('lifecycle', 'Acceptance fixture · segmented lifecycle', 'done', 1),
                                    ('blocker', 'Acceptance fixture · blocked validation', 'blocked', 9)]:
    row, _ = OperatingTask.objects.get_or_create(source_key='execution-qa-' + key, defaults={
        'workspace': core, 'project': project, 'owner': user, 'parent': parent,
        'title': title, 'definition_of_done': 'Verified fixture.', 'status': status, 'execution_weight': weight,
        'created_at': datetime(2026, 9, 1, tzinfo=timezone.utc), 'blocked_reason': 'Fixture: awaiting validation evidence' if status == 'blocked' else ''})
    OperatingTask.objects.filter(pk=row.pk).update(started_at=datetime(2026, 9, 3, tzinfo=timezone.utc),
        completed_at=datetime(2026, 9, 18, tzinfo=timezone.utc) if status == 'done' else None,
        date_provenance={'started_at': {'source': 'recorded', 'confidence': 'recorded'}})
    # Only the fixture's own audit events are reset in the isolated database.
    ActivityEvent.objects.filter(object_type='operating_task', object_id=str(row.pk)).delete()
    changes = [(1, None, 'draft'), (3, 'draft', 'active'), (8, 'active', 'blocked')]
    if status == 'done': changes += [(13, 'blocked', 'active'), (18, 'active', 'done')]
    for day, before, after in changes:
        event = ActivityEvent.objects.create(layer='core', action='task.lifecycle', actor=user,
            object_type='operating_task', object_id=str(row.pk), detail={'source': 'human', 'changes': {'status': {'from': before, 'to': after}}})
        ActivityEvent.objects.filter(pk=event.pk).update(created_at=datetime(2026, 9, day, tzinfo=timezone.utc))
blocker = OperatingTask.objects.get(source_key='execution-qa-blocker')
successor, _ = OperatingTask.objects.get_or_create(source_key='execution-qa-successor', defaults={
    'workspace': core, 'project': project, 'owner': user, 'parent': parent, 'dependency': blocker,
    'title': 'Acceptance fixture · deliver validated results', 'definition_of_done': 'Fixture ready.', 'status': 'waiting'})
existing = set(OperatingTask.objects.filter(source_key__startswith='execution-qa-large-').values_list('source_key', flat=True))
OperatingTask.objects.bulk_create([OperatingTask(source_key=f'execution-qa-large-{i}', workspace=core, project=project,
    owner=user, title=f'Acceptance fixture · task {i:04d}', definition_of_done='Fixture only.', status='draft',
    created_at=datetime(2026, 9, 1, tzinfo=timezone.utc)) for i in range(1000) if f'execution-qa-large-{i}' not in existing])
print('Execution acceptance fixtures ready: nested lifecycle, blocked weighted milestone, and 1,000 task rows.')
