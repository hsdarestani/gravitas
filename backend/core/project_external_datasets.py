"""Operator-allowlisted external PostgreSQL datasets.

No user SQL, table names, connection strings or arbitrary credentials. Project
membership is required on every access. The operator approves exact schemas,
tables, columns and an existing read-only Django connection alias.
"""
import re

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db import connections, transaction
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .project_provider_api import _project, _aliases
from .project_next_phase_models import ProjectProviderBinding

IDENT = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,62}$')


def _error(code, status=400):
    return JsonResponse({'ok': False, 'error': code}, status=status)


def _approved(binding):
    """Only operator-maintained datasets, never caller-provided identifiers."""
    definitions = getattr(settings, 'GRAVITAS_PROJECT_DATABASE_DATASETS', {})
    rows = definitions.get(binding.credential_alias, []) if isinstance(definitions, dict) else []
    approved = {}
    if not isinstance(rows, list) or len(rows) > 40:
        return approved
    for row in rows:
        if not isinstance(row, dict):
            continue
        slug, schema, table, columns = (row.get(k) for k in ('id', 'schema', 'table', 'columns'))
        if (not all(isinstance(x, str) and IDENT.fullmatch(x) for x in (slug, schema, table))
                or not isinstance(columns, list) or not columns or len(columns) > 30
                or any(not isinstance(c, str) or not IDENT.fullmatch(c) for c in columns)
                or len(set(columns)) != len(columns)):
            continue
        approved[slug] = {'id': slug, 'name': str(row.get('name') or slug)[:100],
                          'schema': schema, 'table': table, 'columns': columns}
    return approved


def _bound(request, project_id):
    p = _project(request, project_id)
    if not p:
        return None, None
    if 'database' not in (getattr(p.platform_profile, 'selected_integrations', []) or []):
        return p, None
    binding = ProjectProviderBinding.objects.filter(project=p, kind='remote_db').first()
    if not binding or binding.credential_alias not in _aliases('remote_db'):
        return p, None
    return p, binding


@require_http_methods(['GET'])
def external_datasets(request, project_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project, binding = _bound(request, project_id)
    if not project:
        return _error('not_found', 404)
    if not binding:
        return _error('external_database_not_configured', 409)
    return JsonResponse({'ok': True, 'datasets': [
        {'id': x['id'], 'name': x['name'], 'columns': x['columns']} for x in _approved(binding).values()
    ], 'query_policy': 'fixed_fields_read_only'})


@require_http_methods(['GET'])
def external_dataset_rows(request, project_id, dataset_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    project, binding = _bound(request, project_id)
    if not project:
        return _error('not_found', 404)
    if not binding:
        return _error('external_database_not_configured', 409)
    definition = _approved(binding).get(dataset_id)
    if not definition:
        return _error('dataset_not_approved', 404)
    key = _aliases('remote_db').get(binding.credential_alias)
    if not key or key == 'default' or key not in connections.databases:
        return _error('external_database_not_configured', 503)
    limit = request.GET.get('limit', '50')
    if not limit.isascii() or not limit.isdecimal() or not 1 <= int(limit) <= 100:
        return _error('invalid_limit')
    # Safe only because each identifier is operator supplied AND validated as
    # a plain SQL identifier. Values use DB parameter substitution.
    quote = lambda identifier: '"' + identifier + '"'
    selected = ', '.join(quote(c) for c in definition['columns'])
    source = quote(definition['schema']) + '.' + quote(definition['table'])
    query = f'SELECT {selected} FROM {source} LIMIT %s'
    try:
        if connections[key].vendor != 'postgresql':
            return _error('unsupported_database_driver', 503)
        with transaction.atomic(using=key):
            with connections[key].cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
                cursor.execute("SET LOCAL statement_timeout = '3000ms'")
                cursor.execute(query, [int(limit)])
                records = cursor.fetchall()
    except Exception:
        return _error('dataset_read_unavailable', 503)
    import json
    output = [dict(zip(definition['columns'], record)) for record in records]
    return JsonResponse({'ok': True, 'dataset': definition['id'],
                         'columns': definition['columns'], 'rows': output},
                        encoder=DjangoJSONEncoder)
