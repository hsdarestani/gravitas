"""Produce a private, read-only task/project merge-candidate report.

This command NEVER merges, deletes, re-parents or rewrites tasks/projects/logs.
Candidates are not proof of duplicate identities. Canonical DAV readback and
human-reviewed plans are mandatory before any production mutation.

Usage:
    python manage.py audit_work_graph --output /private/report-new.json
    python manage.py audit_work_graph --workspace-id 3 --output /private/report-new.json
"""
import json
import os
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.models import Count
from django.core.serializers.json import DjangoJSONEncoder

from core.layer_models import ActivityEvent
from core.task_reconciliation_export import snapshot
from core.work_report_models import DailyWorkReport


def normalize(text):
    return ' '.join(re.findall(r'\w+', unicodedata.normalize('NFKC', str(text or '')).casefold()))


def candidate_groups(rows, *, key_fields, cap=100):
    groups = defaultdict(list)
    for row in rows:
        key = tuple(row[field] for field in key_fields) + (normalize(row.get('title')),)
        if key[-1]:
            groups[key].append(row)
    matches = []
    for key, group in groups.items():
        if len(group) < 2:
            continue
        matches.append({
            'ids': [row['id'] for row in group],
            'title': group[0]['title'],
            'owner_ids': sorted({row.get('owner_id') for row in group if row.get('owner_id') is not None}),
            'project_ids': sorted({row.get('project_id') for row in group if row.get('project_id') is not None}),
            'statuses': {str(row['id']): row.get('status') for row in group},
            'reason': 'same_normalized_title_and_scope_review_only',
        })
    matches.sort(key=lambda item: (-len(item['ids']), str(item['title'])))
    return matches[:cap], max(0, len(matches) - cap)


def report_for(snapshot_data, activity_counts=None, daily_report_counts=None):
    tasks = snapshot_data['tasks']
    projects = snapshot_data['projects']
    activity_counts = activity_counts or {}
    daily_report_counts = daily_report_counts or {}
    initiatives = {item['id']: item for item in snapshot_data.get('initiatives', [])}
    project_ids = {item['id'] for item in projects}
    counts = Counter(str(task['status']) for task in tasks)
    project_counts = Counter(task.get('project_id') for task in tasks if task.get('project_id'))
    unlinked = [
        task['id'] for task in tasks
        if not task.get('initiative_id') or not (initiatives.get(task['initiative_id']) or {}).get('key_result_id')
    ]
    out_of_scope_projects = [
        task['id'] for task in tasks if task.get('project_id') and task['project_id'] not in project_ids
    ]
    task_candidates, omitted_tasks = candidate_groups(
        tasks, key_fields=('owner_id', 'project_id'),
    )
    # Project identity includes collaboration, canonical DAV state and files,
    # so title-only project matching never initiates a merge.
    project_candidates, omitted_projects = candidate_groups(
        projects, key_fields=('workspace_id',),
    )
    titles = defaultdict(list)
    for task in tasks:
        title = normalize(task.get('title'))
        if title:
            titles[(task.get('owner_id'), task.get('project_id'))].append(task)
    near_matches = []
    for (_, _), group in titles.items():
        # Bound worst-case comparisons; report likely collisions, not brute-force
        # similarity across every task and project at production scale.
        if len(group) > 120:
            continue
        for index, left in enumerate(group):
            for right in group[index + 1:]:
                a, b = normalize(left['title']), normalize(right['title'])
                if a == b or not a or not b:
                    continue
                similarity = SequenceMatcher(None, a, b, autojunk=False).ratio()
                if similarity >= .90:
                    near_matches.append({
                        'ids': [left['id'], right['id']],
                        'similarity': round(similarity, 3),
                        'reason': 'similar_titles_same_owner_and_project_manual_review',
                    })
                if len(near_matches) >= 100:
                    break
            if len(near_matches) >= 100:
                break
        if len(near_matches) >= 100:
            break

    log_totals = {}
    for task in tasks:
        task_id = task['id']
        log_totals[str(task_id)] = {
            'activity_events': int(activity_counts.get(str(task_id), 0)),
            'board_comments': len(task['comments']),
            'checklist_items': len(task['checklist']),
            'attachments': len(task['attachments']),
            'daily_reports': int(daily_report_counts.get(task_id, 0)),
        }
    project_notes = Counter(item['project_id'] for item in snapshot_data.get('notes', []))
    canonical_files = Counter(
        item['project_id'] for item in snapshot_data.get('canonical_files', []) if not item['deleted']
    )
    return {
        'schema': 1, 'generated_at': datetime.now(timezone.utc).isoformat(),
        'read_only': True,
        'workspace': snapshot_data['workspace'],
        'tasks': {
            'total': len(tasks),
            'by_status': dict(sorted(counts.items())),
            'with_project': sum(bool(t.get('project_id')) for t in tasks),
            'without_kr': len(unlinked), 'without_kr_ids': unlinked,
            'project_outside_report_scope_ids': out_of_scope_projects,
            'duplicates_exact_review_only': task_candidates,
            'duplicates_exact_omitted': omitted_tasks,
            'similar_title_review_only': near_matches,
        },
        'projects': {
            'total': len(projects),
            'duplicate_title_review_only': project_candidates,
            'duplicate_title_omitted': omitted_projects,
            'summaries': [
                {
                    'id': p['id'], 'title': p['title'], 'owner_id': p['owner_id'],
                    'linked_tasks': project_counts[p['id']],
                    'notes': project_notes[p['id']],
                    'canonical_file_projections': canonical_files[p['id']],
                    'canonical_enabled': bool((p.get('canonical') or {}).get('enabled')),
                    'canonical_last_error_present': bool((p.get('canonical') or {}).get('last_error')),
                } for p in projects
            ],
        },
        'task_log_counts_by_id': log_totals,
        'logs': {
            'activity_events': sum(x['activity_events'] for x in log_totals.values()),
            'board_comments': sum(x['board_comments'] for x in log_totals.values()),
            'checklist_items': sum(x['checklist_items'] for x in log_totals.values()),
            'attachments': sum(x['attachments'] for x in log_totals.values()),
            'daily_report_links': sum(x['daily_reports'] for x in log_totals.values()),
        },
        'limitations': [
            'Database projection only: not proof of canonical Nextcloud DAV parity.',
            'A candidate match is not permission to merge; owners/projects/status/history may differ.',
            'Activity events, comments, attachments and daily reports remain immutable and separate.',
            'No full project audit event, external app, time log or DAV content comparison.',
            'No task or project has been modified by this audit.',
        ],
    }


class Command(BaseCommand):
    help = 'Private read-only Core task/project duplicate and log coverage report (JSON).'

    def add_arguments(self, parser):
        parser.add_argument('--workspace-id', type=int, default=None)
        parser.add_argument('--output', required=True, type=Path)

    def handle(self, *args, **options):
        dest = options['output'].expanduser()
        if not dest.is_absolute():
            raise CommandError('An absolute private --output path is required.')
        if not dest.parent.is_dir():
            raise CommandError('Output parent directory does not exist.')
        try:
            with transaction.atomic():
                if connection.vendor == 'postgresql':
                    with connection.cursor() as cursor:
                        cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
                data = snapshot(options['workspace_id'])
                task_ids = [str(task['id']) for task in data['tasks']]
                events = {
                    item['object_id']: item['total']
                    for item in ActivityEvent.objects.filter(
                        layer=ActivityEvent.Layer.CORE, object_type='operating_task',
                        object_id__in=task_ids,
                    ).values('object_id').annotate(total=Count('id'))
                }
                reports = {
                    item['task_id']: item['total']
                    for item in DailyWorkReport.tasks.through.objects.filter(
                        task_id__in=[task['id'] for task in data['tasks']]
                    ).values('task_id').annotate(total=Count('id'))
                }
                result = report_for(data, events, reports)
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

        # Exclusive create, no follow-symlink, no stdout of private content,
        # and never overwrite an earlier evidence report.
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, 'O_NOFOLLOW'):
            flags |= os.O_NOFOLLOW
        try:
            fd = os.open(dest, flags, 0o600)
        except OSError as exc:
            raise CommandError('Cannot create a new private report: ' + str(exc)) from exc
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                json.dump(result, stream, cls=DjangoJSONEncoder, ensure_ascii=False, indent=2)
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
        except Exception:
            dest.unlink(missing_ok=True)
            raise
        self.stdout.write('Read-only report saved privately: %s' % dest)
