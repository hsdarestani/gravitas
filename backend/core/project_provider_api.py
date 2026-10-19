"""Server-governed Research provider adapters.

No arbitrary URLs, SQL, DSNs, private-key material, or tokens are accepted
from project members. Operators configure approved aliases through Django
settings. Users can only bind an alias already approved by the operator.
Private GitHub integration is read-only and uses a fixed GitHub API host.
"""
import json
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from django.conf import settings
from django.db import connections
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import ResearchProject
from .platform_access import can_view, can_manage
from .platform_models import ProjectAuditEvent
from .project_next_phase_models import ProjectProviderBinding
from .project_operational_tools import _git_repo

MAX_RESPONSE = 65536
KINDS = {'private_git': 'git', 'remote_db': 'database'}


def _err(code, status=400):
    return JsonResponse({'ok': False, 'error': code}, status=status)


def _project(request, project_id, manage=False):
    if not request.user.is_authenticated:
        return None
    p = ResearchProject.objects.filter(pk=project_id, archived=False).select_related('platform_profile').first()
    checker = can_manage if manage else can_view
    return p if p and checker(request.user, p) else None


def _aliases(kind):
    key = 'GRAVITAS_PROJECT_GITHUB_TOKENS' if kind == 'private_git' else 'GRAVITAS_PROJECT_DATABASE_ALIASES'
    mapping = getattr(settings, key, {})
    if not isinstance(mapping, dict):
        return {}
    # Only alias keys, never values, are sent to the frontend.
    return {key: value for key, value in mapping.items()
            if isinstance(key, str) and key.isidentifier() and 1 <= len(key) <= 80 and isinstance(value, str) and value}


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def _private_github(path, token):
    """Fixed-host GET; redirect disabled to avoid leaking an auth header."""
    if not isinstance(token, str) or not token:
        raise ValueError('private_git_not_configured')
    if not isinstance(path, str) or not path.startswith('/repos/') or len(path) > 260:
        raise ValueError('invalid_github_path')
    rest = path[len('/repos/'):]
    repo, sep, suffix = rest.partition('/commits?per_page=8')
    if sep and suffix:
        raise ValueError('invalid_github_path')
    if not sep:
        repo = rest
    if _git_repo(repo) != repo:
        raise ValueError('invalid_github_path')
    opener = build_opener(_NoRedirect)
    req = Request('https://api.github.com' + path, headers={
        'User-Agent': 'GraviQuest-Research/1.0',
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
    })
    try:
        with opener.open(req, timeout=4) as response:
            data = response.read(MAX_RESPONSE + 1)
            if len(data) > MAX_RESPONSE:
                raise ValueError('github_response_too_large')
            return json.loads(data.decode('utf-8'))
    except (HTTPError, URLError, OSError, TimeoutError, ValueError) as exc:
        raise ValueError('private_github_unavailable') from exc


def _ping_database(alias):
    db_key = _aliases('remote_db').get(alias)
    if not db_key or db_key == 'default' or db_key not in connections.databases:
        raise ValueError('database_alias_not_configured')
    try:
        with connections[db_key].cursor() as cursor:
            cursor.execute('SELECT 1')
            row = cursor.fetchone()
            if not row or row[0] != 1:
                raise ValueError('database_unavailable')
    except Exception as exc:
        raise ValueError('database_unavailable') from exc
    return True


def _record(project, actor, action, binding):
    ProjectAuditEvent.objects.create(
        project=project, actor=actor, action=action,
        object_type='ProjectProviderBinding', object_id=str(binding.pk),
        detail={'kind': binding.kind, 'alias': binding.credential_alias},
    )


@require_http_methods(['GET'])
def project_provider_catalog(request, project_id):
    if not request.user.is_authenticated:
        return _err('authentication_required', 401)
    project = _project(request, project_id, manage=True)
    if not project:
        return _err('not_found', 404)
    return JsonResponse({'ok': True, 'providers': {
        kind: sorted(_aliases(kind)) for kind in KINDS
    }, 'note': 'Provider credentials and databases are provisioned by the server administrator.'})


@require_http_methods(['GET', 'POST', 'DELETE'])
def project_provider(request, project_id, kind):
    if kind not in KINDS:
        return _err('unsupported_provider', 404)
    if not request.user.is_authenticated:
        return _err('authentication_required', 401)
    project = _project(request, project_id, manage=request.method != 'GET')
    if not project:
        return _err('not_found', 404)
    binding = ProjectProviderBinding.objects.filter(project=project, kind=kind).first()
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'binding': {
            'alias': binding.credential_alias,
            'repository': binding.resource if kind == 'private_git' else '',
            'verified_at': binding.last_verified_at.isoformat() if binding.last_verified_at else None,
            'mode': 'private_read_only' if kind == 'private_git' else 'external_connection_check_only',
        } if binding else None})
    if request.method == 'DELETE':
        if binding:
            _record(project, request.user, 'provider.disconnected', binding)
            binding.delete()
        return JsonResponse({'ok': True})
    if KINDS[kind] not in (getattr(project.platform_profile, 'selected_integrations', []) or []):
        return _err('tool_not_selected', 409)
    if len(request.body) > 2048:
        return _err('invalid_payload')
    try:
        data = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        return _err('invalid_payload')
    if not isinstance(data, dict) or set(data) - {'alias', 'repository'}:
        return _err('invalid_payload')
    alias = data.get('alias')
    if not isinstance(alias, str) or alias not in _aliases(kind):
        return _err('provider_alias_not_configured', 422)
    resource = ''
    try:
        if kind == 'private_git':
            resource = _git_repo(data.get('repository'))
            approved = getattr(settings, 'GRAVITAS_PROJECT_GITHUB_ALLOWED_REPOS', {})
            if not isinstance(approved, dict) or resource not in approved.get(alias, []):
                return _err('repository_not_approved_for_alias', 403)
            remote = _private_github(f'/repos/{resource}', _aliases(kind)[alias])
            if not isinstance(remote, dict) or remote.get('private') is not True or remote.get('full_name') != resource:
                return _err('private_repository_required', 422)
        else:
            if data.get('repository'):
                return _err('invalid_payload')
            _ping_database(alias)
    except ValueError as exc:
        return _err(str(exc), 422)
    binding, _ = ProjectProviderBinding.objects.update_or_create(
        project=project, kind=kind,
        defaults={'credential_alias': alias, 'resource': resource,
                  'last_verified_at': timezone.now(), 'configured_by': request.user},
    )
    _record(project, request.user, 'provider.verified', binding)
    return JsonResponse({'ok': True, 'binding': {
        'alias': alias, 'repository': resource,
        'mode': 'private_read_only' if kind == 'private_git' else 'external_connection_check_only',
        'verified_at': binding.last_verified_at.isoformat(),
    }})


@require_http_methods(['GET'])
def project_private_git_commits(request, project_id):
    if not request.user.is_authenticated:
        return _err('authentication_required', 401)
    project = _project(request, project_id)
    if not project:
        return _err('not_found', 404)
    if 'git' not in (getattr(project.platform_profile, 'selected_integrations', []) or []):
        return _err('tool_not_selected', 409)
    binding = ProjectProviderBinding.objects.filter(project=project, kind='private_git').first()
    if not binding:
        return _err('private_git_not_configured', 409)
    token = _aliases('private_git').get(binding.credential_alias)
    if not token:
        return _err('private_git_not_configured', 503)
    try:
        repository = _git_repo(binding.resource)
        allowlist = getattr(settings, 'GRAVITAS_PROJECT_GITHUB_ALLOWED_REPOS', {})
        if not isinstance(allowlist, dict) or repository not in allowlist.get(binding.credential_alias, []):
            return _err('repository_not_approved_for_alias', 403)
        rows = _private_github(f'/repos/{repository}/commits?per_page=8', token)
        if not isinstance(rows, list):
            raise ValueError('private_github_unavailable')
        commits = [{'sha': str(x.get('sha') or '')[:40],
                    'message': str((x.get('commit') or {}).get('message') or '').split('\n')[0][:220]}
                   for x in rows[:8] if isinstance(x, dict)]
    except ValueError as exc:
        return _err(str(exc), 502)
    ProjectProviderBinding.objects.filter(pk=binding.pk).update(last_verified_at=timezone.now())
    return JsonResponse({'ok': True, 'commits': commits, 'repository': repository})


@require_http_methods(['GET'])
def project_plugin_states(request, project_id):
    if not request.user.is_authenticated:
        return _err('authentication_required', 401)
    project = _project(request, project_id)
    if not project:
        return _err('not_found', 404)
    selected = getattr(project.platform_profile, 'selected_integrations', []) or []
    bindings = {b.kind: b for b in ProjectProviderBinding.objects.filter(project=project)}
    plugins = []
    for item in selected:
        if item == 'git':
            mode = 'private_read_only' if 'private_git' in bindings else 'public_or_setup'
        elif item == 'database':
            mode = 'external_connection_check_only' if 'remote_db' in bindings else 'managed_private_tables'
        elif item == 'lab_journal':
            mode = 'append_only'
        else:
            mode = 'not_installed'
        plugins.append({'id': item, 'mode': mode,
                        'state': 'setup_required' if mode == 'not_installed' or mode == 'public_or_setup' else 'ready'})
    return JsonResponse({'ok': True, 'plugins': plugins})
