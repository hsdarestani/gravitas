"""Operational adapters for the first three Research project tools.

Git: explicit read-only connection to a *public* GitHub repository. No user
supplied outbound URLs, private token handling, shell commands or git clones.
Database: project-private structured tables inside the existing Django database.
Lab Journal: an append-only log of existing ResearchExperiment records.

The adapters deliberately keep external provisioning and arbitrary SQL out of
the web request path. Every endpoint enforces the project's ACL.
"""
import json
import math
import re
from datetime import date
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .platform_access import can_edit, can_manage, can_view
from .platform_models import ProjectAuditEvent
from .models import ResearchProject
from .research_models import (
    ExperimentJournalEntry, ProjectDataRow, ProjectDataTable,
    ProjectGitConnection, ResearchExperiment,
)

REPO_PATTERN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$')
COLUMN_PATTERN = re.compile(r'^[a-z][a-z0-9_]{0,39}$')
VALID_TYPES = {'text', 'number', 'boolean', 'date'}
MAX_ROW_COUNT = 1000
MAX_TABLE_COUNT = 25
MAX_COLUMNS = 20


def _fail(code, status=400):
    return JsonResponse({'ok': False, 'error': code}, status=status)


def _body(request):
    if len(request.body) > 20000:
        return None
    try:
        parsed = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _project(request, project_id, role='view'):
    if not request.user.is_authenticated:
        return None
    obj = ResearchProject.objects.select_related('platform_profile').filter(pk=project_id, archived=False).first()
    check = {'view': can_view, 'edit': can_edit, 'manage': can_manage}[role]
    return obj if obj and check(request.user, obj) else None


def _enabled(project, tool):
    profile = getattr(project, 'platform_profile', None)
    return tool in (getattr(profile, 'selected_integrations', None) or [])


def _audit(project, user, action, obj, **detail):
    ProjectAuditEvent.objects.create(
        project=project, actor=user, action=action,
        object_type=type(obj).__name__, object_id=str(obj.pk), detail=detail,
    )


def _git_repo(value):
    """Only normalized public GitHub owner/repo names; no URL forwarding."""
    if not isinstance(value, str) or len(value) > 210:
        raise ValueError('invalid_github_repository')
    value = value.strip()
    if value.startswith('https://github.com/'):
        value = value[len('https://github.com/'):]
    if value.endswith('.git'):
        value = value[:-4]
    if not REPO_PATTERN.fullmatch(value):
        raise ValueError('invalid_github_repository')
    owner, name = value.split('/')
    if owner in {'.', '..'} or name in {'.', '..'} or '..' in owner or '..' in name:
        raise ValueError('invalid_github_repository')
    return value


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def _github_public(path):
    """Fixed-host, bounded public API request with redirects disabled."""
    if not re.fullmatch(r'/repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:/commits\?per_page=8)?', path):
        raise ValueError('invalid_git_path')
    opener = build_opener(_NoRedirect)
    req = Request('https://api.github.com' + path, headers={
        'User-Agent': 'GraviQuest-Research/1.0',
        'Accept': 'application/vnd.github+json',
    })
    try:
        with opener.open(req, timeout=4) as response:
            data = response.read(65537)
            if len(data) > 65536:
                raise ValueError('github_response_too_large')
            return json.loads(data.decode('utf-8'))
    except (HTTPError, URLError, OSError, TimeoutError, ValueError):
        raise ValueError('github_unavailable')


@require_http_methods(['GET'])
def operational_tool_status(request, project_id):
    if not request.user.is_authenticated:
        return _fail('authentication_required', 401)
    project = _project(request, project_id)
    if not project:
        return _fail('not_found', 404)
    git = ProjectGitConnection.objects.filter(project=project).first()
    selected = list(getattr(project.platform_profile, 'selected_integrations', []) or [])
    states = {}
    for tool in selected:
        if tool == 'git':
            states[tool] = {
                'state': 'last_verified' if git and git.last_verified_at else 'setup_required',
                'repository': git.repository if git else None,
                'verified_at': git.last_verified_at.isoformat() if git and git.last_verified_at else None,
                'default_branch': git.default_branch if git else None,
                'mode': 'public_read_only',
            }
        elif tool == 'database':
            states[tool] = {'state': 'ready', 'mode': 'managed_private_tables', 'table_count': project.data_tables.count()}
        elif tool == 'lab_journal':
            states[tool] = {'state': 'ready', 'mode': 'append_only', 'experiment_count': project.experiments.count()}
        else:
            states[tool] = {'state': 'setup_required'}
    return JsonResponse({'ok': True, 'integrations': states})


@require_http_methods(['GET', 'POST', 'DELETE'])
def project_git(request, project_id):
    if not request.user.is_authenticated:
        return _fail('authentication_required', 401)
    project = _project(request, project_id, 'view' if request.method == 'GET' else 'manage')
    if not project:
        return _fail('not_found', 404)
    conn = ProjectGitConnection.objects.filter(project=project).first()
    if request.method == 'GET':
        if not conn:
            return JsonResponse({'ok': True, 'connection': None})
        return JsonResponse({'ok': True, 'connection': {
            'repository': conn.repository,
            'default_branch': conn.default_branch,
            'last_verified_at': conn.last_verified_at.isoformat() if conn.last_verified_at else None,
            'mode': 'public_read_only',
        }})
    if request.method == 'DELETE':
        if conn:
            _audit(project, request.user, 'git.disconnected', conn, repository=conn.repository)
            conn.delete()
        return JsonResponse({'ok': True})
    if not _enabled(project, 'git'):
        return _fail('tool_not_selected', 409)
    data = _body(request)
    if data is None:
        return _fail('invalid_json')
    try:
        repository = _git_repo(data.get('repository'))
        remote = _github_public(f'/repos/{repository}')
        if not isinstance(remote, dict) or remote.get('private') is not False or not remote.get('full_name'):
            raise ValueError('public_repository_required')
    except ValueError as exc:
        return _fail(str(exc), 422)
    conn, _ = ProjectGitConnection.objects.update_or_create(
        project=project,
        defaults={
            'repository': str(remote['full_name'])[:210],
            'default_branch': str(remote.get('default_branch') or '')[:160],
            'last_verified_at': timezone.now(),
            'created_by': request.user,
        },
    )
    _audit(project, request.user, 'git.verified', conn, repository=conn.repository)
    return JsonResponse({'ok': True, 'connection': {
        'repository': conn.repository, 'default_branch': conn.default_branch,
        'last_verified_at': conn.last_verified_at.isoformat(), 'mode': 'public_read_only',
    }})


@require_http_methods(['GET'])
def project_git_commits(request, project_id):
    if not request.user.is_authenticated:
        return _fail('authentication_required', 401)
    project = _project(request, project_id)
    if not project:
        return _fail('not_found', 404)
    conn = ProjectGitConnection.objects.filter(project=project).first()
    if not conn or not _enabled(project, 'git'):
        return _fail('git_not_configured', 409)
    try:
        repository = _git_repo(conn.repository)
        raw = _github_public(f'/repos/{repository}/commits?per_page=8')
        if not isinstance(raw, list):
            raise ValueError('github_unavailable')
        commits = [{
            'sha': str(item.get('sha') or '')[:40],
            'message': str((item.get('commit') or {}).get('message') or '').split('\n')[0][:220],
            'date': ((item.get('commit') or {}).get('author') or {}).get('date'),
            'author': str(((item.get('commit') or {}).get('author') or {}).get('name') or '')[:100],
        } for item in raw[:8] if isinstance(item, dict)]
    except ValueError as exc:
        return _fail(str(exc), 502)
    ProjectGitConnection.objects.filter(pk=conn.pk).update(last_verified_at=timezone.now())
    return JsonResponse({'ok': True, 'repository': repository, 'commits': commits})


def _columns(value):
    if not isinstance(value, list) or not (1 <= len(value) <= MAX_COLUMNS):
        raise ValueError('invalid_columns')
    result = []
    seen = set()
    for column in value:
        if not isinstance(column, dict):
            raise ValueError('invalid_columns')
        key = column.get('key')
        kind = column.get('type')
        if not isinstance(key, str) or not COLUMN_PATTERN.fullmatch(key) or key in seen or kind not in VALID_TYPES:
            raise ValueError('invalid_columns')
        seen.add(key)
        result.append({'key': key, 'type': kind})
    return result


def _values(value, columns):
    if not isinstance(value, dict) or len(value) > MAX_COLUMNS:
        raise ValueError('invalid_values')
    kinds = {c['key']: c['type'] for c in columns}
    if any(key not in kinds for key in value):
        raise ValueError('unknown_column')
    clean = {}
    for key, entry in value.items():
        if entry is None:
            clean[key] = None
            continue
        kind = kinds[key]
        if kind == 'text':
            if not isinstance(entry, str) or len(entry) > 2000:
                raise ValueError('invalid_text')
        elif kind == 'number':
            if isinstance(entry, bool) or not isinstance(entry, (int, float)) or not math.isfinite(entry):
                raise ValueError('invalid_number')
        elif kind == 'boolean':
            if not isinstance(entry, bool):
                raise ValueError('invalid_boolean')
        elif kind == 'date':
            if not isinstance(entry, str):
                raise ValueError('invalid_date')
            try:
                if date.fromisoformat(entry).isoformat() != entry:
                    raise ValueError('invalid_date')
            except ValueError:
                raise ValueError('invalid_date')
        clean[key] = entry
    return clean


def _table_json(table):
    return {'id': table.pk, 'name': table.name, 'columns': table.columns, 'row_count': table.rows.count()}


def _row_json(item):
    return {'id': item.pk, 'values': item.values, 'revision': item.revision,
            'created_at': item.created_at.isoformat(), 'updated_at': item.updated_at.isoformat()}


@require_http_methods(['GET', 'POST'])
def project_data_tables(request, project_id):
    if not request.user.is_authenticated:
        return _fail('authentication_required', 401)
    project = _project(request, project_id, 'view' if request.method == 'GET' else 'edit')
    if not project:
        return _fail('not_found', 404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'tables': [
            _table_json(item) for item in project.data_tables.all()[:MAX_TABLE_COUNT]
        ]})
    if not _enabled(project, 'database'):
        return _fail('tool_not_selected', 409)
    data = _body(request)
    if data is None:
        return _fail('invalid_json')
    name = data.get('name')
    if not isinstance(name, str) or not (1 <= len(name.strip()) <= 120):
        return _fail('invalid_table_name')
    try:
        columns = _columns(data.get('columns'))
    except ValueError as exc:
        return _fail(str(exc))
    with transaction.atomic():
        if ProjectDataTable.objects.filter(project=project).count() >= MAX_TABLE_COUNT:
            return _fail('table_limit_reached', 409)
        table = ProjectDataTable.objects.create(
            project=project, name=name.strip(), columns=columns, created_by=request.user,
        )
    _audit(project, request.user, 'database.table_created', table, name=table.name)
    return JsonResponse({'ok': True, 'table': _table_json(table)}, status=201)


@require_http_methods(['DELETE'])
def project_data_table_detail(request, project_id, table_id):
    if not request.user.is_authenticated:
        return _fail('authentication_required', 401)
    project = _project(request, project_id, 'manage')
    if not project:
        return _fail('not_found', 404)
    table = ProjectDataTable.objects.filter(project=project, pk=table_id).first()
    if not table:
        return _fail('not_found', 404)
    _audit(project, request.user, 'database.table_deleted', table, name=table.name)
    table.delete()
    return JsonResponse({'ok': True})


@require_http_methods(['GET', 'POST'])
def project_data_rows(request, project_id, table_id):
    if not request.user.is_authenticated:
        return _fail('authentication_required', 401)
    project = _project(request, project_id, 'view' if request.method == 'GET' else 'edit')
    if not project:
        return _fail('not_found', 404)
    table = ProjectDataTable.objects.filter(project=project, pk=table_id).first()
    if not table:
        return _fail('not_found', 404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'rows': [
            _row_json(row) for row in table.rows.all()[:MAX_ROW_COUNT]
        ]})
    if not _enabled(project, 'database'):
        return _fail('tool_not_selected', 409)
    data = _body(request)
    if data is None:
        return _fail('invalid_json')
    try:
        values = _values(data.get('values'), table.columns)
    except ValueError as exc:
        return _fail(str(exc))
    with transaction.atomic():
        locked = ProjectDataTable.objects.select_for_update().get(pk=table.pk)
        if ProjectDataRow.objects.filter(table=locked).count() >= MAX_ROW_COUNT:
            return _fail('row_limit_reached', 409)
        item = ProjectDataRow.objects.create(table=locked, values=values, created_by=request.user)
    _audit(project, request.user, 'database.row_created', item, table_id=table.pk)
    return JsonResponse({'ok': True, 'row': _row_json(item)}, status=201)


@require_http_methods(['PATCH', 'DELETE'])
def project_data_row_detail(request, project_id, table_id, row_id):
    if not request.user.is_authenticated:
        return _fail('authentication_required', 401)
    project = _project(request, project_id, 'edit')
    if not project:
        return _fail('not_found', 404)
    table = ProjectDataTable.objects.filter(project=project, pk=table_id).first()
    if not table:
        return _fail('not_found', 404)
    if request.method == 'PATCH':
        if not _enabled(project, 'database'):
            return _fail('tool_not_selected', 409)
        data = _body(request)
        if data is None:
            return _fail('invalid_json')
        try:
            values = _values(data.get('values'), table.columns)
        except ValueError as exc:
            return _fail(str(exc))
        revision = data.get('expected_revision')
        if type(revision) is not int or revision < 1:
            return _fail('revision_required')
        with transaction.atomic():
            item = ProjectDataRow.objects.select_for_update().filter(table=table, pk=row_id).first()
            if not item:
                return _fail('not_found', 404)
            if item.revision != revision:
                return _fail('row_conflict', 409)
            item.values = values
            item.revision += 1
            item.save(update_fields=['values', 'revision', 'updated_at'])
        _audit(project, request.user, 'database.row_updated', item, table_id=table.pk, revision=item.revision)
        return JsonResponse({'ok': True, 'row': _row_json(item)})
    with transaction.atomic():
        item = ProjectDataRow.objects.select_for_update().filter(table=table, pk=row_id).first()
        if not item:
            return _fail('not_found', 404)
        _audit(project, request.user, 'database.row_deleted', item, table_id=table.pk)
        item.delete()
    return JsonResponse({'ok': True})


@require_http_methods(['GET', 'POST'])
def project_experiment_journal(request, project_id, experiment_id):
    if not request.user.is_authenticated:
        return _fail('authentication_required', 401)
    project = _project(request, project_id, 'view' if request.method == 'GET' else 'edit')
    if not project:
        return _fail('not_found', 404)
    experiment = ResearchExperiment.objects.filter(project=project, pk=experiment_id).first()
    if not experiment:
        return _fail('not_found', 404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'entries': [{
            'id': entry.pk, 'kind': entry.kind, 'body': entry.body,
            'author': entry.author.get_full_name() or entry.author.get_username(),
            'created_at': entry.created_at.isoformat(),
        } for entry in experiment.journal_entries.select_related('author').all()[:250]]})
    if not _enabled(project, 'lab_journal'):
        return _fail('tool_not_selected', 409)
    data = _body(request)
    if data is None:
        return _fail('invalid_json')
    kind = data.get('kind', 'note')
    body = data.get('body')
    if kind not in ExperimentJournalEntry.Kind.values:
        return _fail('invalid_journal_kind')
    if not isinstance(body, str) or not (1 <= len(body.strip()) <= 10000):
        return _fail('invalid_journal_body')
    entry = ExperimentJournalEntry.objects.create(
        experiment=experiment, author=request.user, kind=kind, body=body.strip()
    )
    _audit(project, request.user, 'lab_journal.entry_added', entry, experiment_id=experiment.pk)
    return JsonResponse({'ok': True, 'entry': {
        'id': entry.pk, 'kind': entry.kind, 'body': entry.body,
        'author': request.user.get_full_name() or request.user.get_username(),
        'created_at': entry.created_at.isoformat(),
    }}, status=201)
