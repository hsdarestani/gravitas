"""Versioned, isolated builtin Research analysis plugins.

Plugins are vetted Python callables registered by deployment code, never
downloaded or evaluated from user content. Every execution is read-only,
bounded, project-scoped and uses an allowlisted algorithm, not arbitrary code.
"""
import json
import math
from statistics import fmean

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .project_provider_api import _project
from .research_models import ProjectDataTable

MANIFESTS = {
    'data_analysis': {
        'id': 'data_analysis', 'name': 'Descriptive statistics', 'version': '1.0.0',
        'operation': 'summary', 'required': ['table_id', 'column'],
        'note': 'Read-only summary of up to 500 numerical observations.',
    },
    'compute': {
        'id': 'compute', 'name': 'Numeric calculation', 'version': '1.0.0',
        'operation': 'scale', 'required': ['table_id', 'column', 'factor'],
        'note': 'Bounded per-row multiply operation; data is not modified.',
    },
    'machine_learning': {
        'id': 'machine_learning', 'name': 'Linear regression', 'version': '1.0.0',
        'operation': 'fit_linear', 'required': ['table_id', 'feature', 'target'],
        'note': 'Deterministic single-feature least squares. Not an arbitrary training runtime.',
    },
}


def _err(msg, status=400):
    return JsonResponse({'ok': False, 'error': msg}, status=status)


def _select_table(project, table_id):
    if type(table_id) is not int or table_id <= 0:
        raise ValueError('invalid_table_id')
    table = ProjectDataTable.objects.filter(pk=table_id, project=project).first()
    if not table:
        raise ValueError('table_not_found')
    return table


def _numeric(table, key):
    if (not isinstance(key, str) or key not in {
        c['key'] for c in table.columns if c.get('type') == 'number'
    }):
        raise ValueError('numeric_column_required')
    values = []
    for row in table.rows.order_by('pk')[:501]:
        if len(values) >= 500:
            raise ValueError('plugin_row_limit')
        value = row.values.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError('invalid_number')
        values.append((row.pk, float(value)))
    if not values:
        raise ValueError('no_numeric_data')
    return values


def _run(project, plugin, data):
    table = _select_table(project, data.get('table_id'))
    if plugin == 'data_analysis':
        values = [value for _, value in _numeric(table, data.get('column'))]
        count = len(values)
        return {'count': count, 'mean': fmean(values), 'minimum': min(values),
                'maximum': max(values), 'sum': math.fsum(values)}
    if plugin == 'compute':
        factor = data.get('factor')
        if isinstance(factor, bool) or not isinstance(factor, (int, float)) or not math.isfinite(factor) or abs(factor) > 1e6:
            raise ValueError('invalid_factor')
        items = _numeric(table, data.get('column'))
        if any(not math.isfinite(val * factor) for _, val in items):
            raise ValueError('numeric_overflow')
        return {'count': len(items), 'result': [
            {'row_id': row_id, 'value': round(val * factor, 8)} for row_id, val in items[:100]
        ], 'truncated': len(items) > 100}
    if plugin == 'machine_learning':
        xs, ys = (dict(_numeric(table, key)) for key in (data.get('feature'), data.get('target')))
        shared = list(xs.keys() & ys.keys())
        if len(shared) < 3:
            raise ValueError('insufficient_samples')
        x = [xs[i] for i in shared]
        y = [ys[i] for i in shared]
        avg_x, avg_y = fmean(x), fmean(y)
        numerator = math.fsum((a - avg_x) * (b - avg_y) for a, b in zip(x, y))
        denominator = math.fsum((a - avg_x) ** 2 for a in x)
        if not denominator or not math.isfinite(denominator):
            raise ValueError('zero_feature_variance')
        slope = numerator / denominator
        intercept = avg_y - slope * avg_x
        variance = math.fsum((b - avg_y) ** 2 for b in y)
        residual = math.fsum((b - (slope * a + intercept)) ** 2 for a, b in zip(x, y))
        if any(not math.isfinite(n) for n in (slope, intercept, residual)):
            raise ValueError('numeric_overflow')
        return {'samples': len(shared), 'slope': slope, 'intercept': intercept,
                'r_squared': 1 - residual / variance if variance else 1.0,
                'disclaimer': 'Exploratory model; validate independently before scientific use.'}
    raise ValueError('unknown_plugin')


@require_http_methods(['GET'])
def builtin_plugin_catalog(request, project_id):
    if not request.user.is_authenticated:
        return _err('authentication_required', 401)
    project = _project(request, project_id)
    if not project:
        return _err('not_found', 404)
    selected = getattr(getattr(project, 'platform_profile', None), 'selected_integrations', []) or []
    return JsonResponse({'ok': True, 'plugins': [
        {**manifest, 'selected': name in selected, 'state': 'ready' if name in selected else 'not_selected'}
        for name, manifest in MANIFESTS.items()
    ]})


@require_http_methods(['POST'])
def run_builtin_plugin(request, project_id, plugin_id):
    if not request.user.is_authenticated:
        return _err('authentication_required', 401)
    project = _project(request, project_id)
    if not project:
        return _err('not_found', 404)
    if plugin_id not in MANIFESTS:
        return _err('plugin_not_installed', 404)
    if plugin_id not in (getattr(getattr(project, 'platform_profile', None), 'selected_integrations', []) or []):
        return _err('plugin_not_selected', 409)
    if len(request.body) > 3000:
        return _err('invalid_payload')
    try:
        data = json.loads(request.body.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return _err('invalid_payload')
    if not isinstance(data, dict) or set(data) - {'table_id', 'column', 'feature', 'target', 'factor'}:
        return _err('invalid_payload')
    try:
        result = _run(project, plugin_id, data)
    except ValueError as exc:
        return _err(str(exc))
    return JsonResponse({'ok': True, 'plugin': plugin_id,
                         'version': MANIFESTS[plugin_id]['version'], 'result': result})
