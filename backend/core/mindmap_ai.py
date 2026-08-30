import json
import logging
import math
import urllib.error
import urllib.request
from collections import defaultdict, deque

from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .platform_access import can_edit, can_view
from .platform_models import MindMap, MindMapEdge, MindMapNode


logger = logging.getLogger(__name__)

ALLOWED_KINDS = set(MindMapNode.Kind.values)
ALLOWED_RELATIONS = {
    'related',
    'supports',
    'contradicts',
    'depends-on',
    'derived-from',
    'contains',
    'causes',
    'evidence-for',
    'question-for',
}


def _error(code, status=400, **extra):
    return JsonResponse({'ok': False, 'error': code, **extra}, status=status)


def _body(request):
    try:
        return json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _node_json(node):
    return {
        'id': node.pk,
        'key': node.key,
        'title': node.title,
        'body': node.body,
        'kind': node.kind,
        'x': node.x,
        'y': node.y,
    }


def _edge_json(edge):
    return {
        'id': edge.pk,
        'source_id': edge.source_id,
        'target_id': edge.target_id,
        'relation': edge.relation,
        'label': edge.label,
    }


def _map_json(item):
    return {
        'id': item.pk,
        'title': item.title,
        'description': item.description,
        'project_id': item.project_id,
        'nodes': [_node_json(node) for node in item.nodes.all()],
        'edges': [_edge_json(edge) for edge in item.edges.select_related('source', 'target').all()],
        'updated_at': item.updated_at.isoformat(),
    }


def _schema(max_nodes):
    return {
        'type': 'object',
        'properties': {
            'title': {'type': 'string'},
            'summary': {'type': 'string'},
            'nodes': {
                'type': 'array',
                'minItems': 3,
                'maxItems': max_nodes,
                'items': {
                    'type': 'object',
                    'properties': {
                        'key': {'type': 'string'},
                        'title': {'type': 'string'},
                        'body': {'type': 'string'},
                        'kind': {
                            'type': 'string',
                            'enum': sorted(ALLOWED_KINDS),
                        },
                    },
                    'required': ['key', 'title', 'body', 'kind'],
                },
            },
            'edges': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'source': {'type': 'string'},
                        'target': {'type': 'string'},
                        'relation': {'type': 'string'},
                        'label': {'type': 'string'},
                    },
                    'required': ['source', 'target', 'relation', 'label'],
                },
            },
        },
        'required': ['title', 'summary', 'nodes', 'edges'],
    }


def _cloudflare_graph(prompt, *, max_nodes):
    account_id = str(getattr(settings, 'CLOUDFLARE_AI_ACCOUNT_ID', '') or '').strip()
    api_token = str(getattr(settings, 'CLOUDFLARE_AI_API_TOKEN', '') or '').strip()
    model = str(
        getattr(
            settings,
            'CLOUDFLARE_AI_MODEL',
            '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        )
        or '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
    ).strip()
    timeout = int(getattr(settings, 'CLOUDFLARE_AI_TIMEOUT', 45) or 45)

    if not account_id or not api_token:
        raise RuntimeError('cloudflare_ai_not_configured')

    endpoint = f'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}'
    system_prompt = (
        'You create concise, useful research mind maps. Return only the requested structured JSON. '
        'Use the same language as the user prompt unless the prompt explicitly asks for another language. '
        'Create one clear central/root concept, then meaningful branches and cross-links. '
        'Keep node titles short, put explanation in body, avoid duplicate concepts, and make relations semantically useful. '
        'Node keys must be simple unique ASCII identifiers such as root, branch-1, evidence-2. '
        'Every edge source and target must reference an existing node key. Do not create self-links.'
    )
    body = {
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': prompt},
        ],
        'temperature': 0.25,
        'max_tokens': 3200,
        'response_format': {
            'type': 'json_schema',
            'json_schema': _schema(max_nodes),
        },
    }
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(body).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {api_token}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        detail = ''
        try:
            detail = exc.read().decode('utf-8', errors='replace')[:500]
        except Exception:
            pass
        logger.warning('Cloudflare Workers AI HTTP %s: %s', exc.code, detail)
        raise RuntimeError('cloudflare_ai_failed') from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        logger.warning('Cloudflare Workers AI request failed: %s', exc)
        raise RuntimeError('cloudflare_ai_failed') from exc

    if not payload.get('success', False):
        logger.warning('Cloudflare Workers AI returned unsuccessful response: %s', payload.get('errors'))
        raise RuntimeError('cloudflare_ai_failed')

    result = payload.get('result') or {}
    graph = result.get('response') if isinstance(result, dict) else None
    if isinstance(graph, str):
        try:
            graph = json.loads(graph)
        except json.JSONDecodeError as exc:
            raise RuntimeError('cloudflare_ai_invalid_json') from exc
    if not isinstance(graph, dict):
        raise RuntimeError('cloudflare_ai_invalid_json')
    return graph


def _clean_key(value, fallback):
    raw = ''.join(ch.lower() if ch.isalnum() else '-' for ch in str(value or '').strip())
    raw = '-'.join(part for part in raw.split('-') if part)[:70]
    return raw or fallback


def _normalise_graph(graph, max_nodes):
    raw_nodes = graph.get('nodes') if isinstance(graph.get('nodes'), list) else []
    nodes = []
    used = set()
    key_map = {}
    for index, raw in enumerate(raw_nodes[:max_nodes], start=1):
        if not isinstance(raw, dict):
            continue
        original = str(raw.get('key') or f'node-{index}')
        key = _clean_key(original, f'node-{index}')
        base = key
        suffix = 2
        while key in used:
            key = f'{base[:62]}-{suffix}'
            suffix += 1
        used.add(key)
        key_map[original] = key
        key_map[_clean_key(original, key)] = key
        title = str(raw.get('title') or '').strip()[:240]
        if not title:
            continue
        kind = str(raw.get('kind') or 'concept').strip().lower()
        if kind not in ALLOWED_KINDS:
            kind = 'concept'
        nodes.append({
            'key': key,
            'title': title,
            'body': str(raw.get('body') or '').strip()[:5000],
            'kind': kind,
        })

    if len(nodes) < 2:
        raise RuntimeError('cloudflare_ai_invalid_graph')

    valid_keys = {node['key'] for node in nodes}
    edges = []
    seen_edges = set()
    raw_edges = graph.get('edges') if isinstance(graph.get('edges'), list) else []
    for raw in raw_edges[: max_nodes * 3]:
        if not isinstance(raw, dict):
            continue
        source_raw = str(raw.get('source') or '')
        target_raw = str(raw.get('target') or '')
        source = key_map.get(source_raw) or key_map.get(_clean_key(source_raw, source_raw))
        target = key_map.get(target_raw) or key_map.get(_clean_key(target_raw, target_raw))
        if source not in valid_keys or target not in valid_keys or source == target:
            continue
        relation = str(raw.get('relation') or 'related').strip().lower()[:60]
        if relation not in ALLOWED_RELATIONS:
            relation = 'related'
        signature = (source, target, relation)
        if signature in seen_edges:
            continue
        seen_edges.add(signature)
        edges.append({
            'source': source,
            'target': target,
            'relation': relation,
            'label': str(raw.get('label') or '').strip()[:160],
        })

    if not edges:
        root = nodes[0]['key']
        edges = [
            {'source': root, 'target': node['key'], 'relation': 'related', 'label': ''}
            for node in nodes[1:]
        ]

    return nodes, edges


def _layout(nodes, edges, *, x_offset=80.0, y_offset=80.0):
    keys = [node['key'] for node in nodes]
    if not keys:
        return {}
    outgoing = defaultdict(list)
    incoming = defaultdict(int)
    for edge in edges:
        outgoing[edge['source']].append(edge['target'])
        incoming[edge['target']] += 1

    root = next((key for key in keys if incoming[key] == 0), keys[0])
    depth = {root: 0}
    queue = deque([root])
    while queue:
        source = queue.popleft()
        for target in outgoing.get(source, []):
            if target not in depth:
                depth[target] = depth[source] + 1
                queue.append(target)
    for key in keys:
        if key not in depth:
            depth[key] = max(depth.values(), default=0) + 1

    levels = defaultdict(list)
    for key in keys:
        levels[depth[key]].append(key)

    positions = {}
    for level in sorted(levels):
        level_keys = levels[level]
        count = len(level_keys)
        spacing = 150.0
        total = (count - 1) * spacing
        for index, key in enumerate(level_keys):
            positions[key] = (
                x_offset + level * 310.0,
                y_offset + index * spacing - total / 2.0 + max(total / 2.0, 0),
            )
    return positions


@require_POST
def generate_mindmap_ai(request, map_id):
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)

    item = MindMap.objects.select_related('project', 'workspace', 'owner').filter(pk=map_id).first()
    if not item or not can_view(request.user, item):
        return _error('not_found', 404)
    if not can_edit(request.user, item):
        return _error('permission_denied', 403)

    data = _body(request)
    mode = str(data.get('mode') or 'append').strip().lower()
    if mode not in {'append', 'replace'}:
        return _error('invalid_mode')
    try:
        max_nodes = int(data.get('max_nodes') or 14)
    except (TypeError, ValueError):
        max_nodes = 14
    max_nodes = max(5, min(max_nodes, 28))

    prompt = str(data.get('prompt') or '').strip()
    if not prompt:
        project_context = ''
        if item.project:
            project_context = f' Project: {item.project.title}. {item.project.description or ""}'
        prompt = f'Create a research mind map for “{item.title}”. {item.description or ""}{project_context}'.strip()
    prompt = prompt[:8000]

    if mode == 'append' and item.nodes.exists():
        existing = '; '.join(node.title for node in item.nodes.all()[:20])
        prompt += f'\nExisting map concepts (avoid needless duplication): {existing}'

    try:
        graph = _cloudflare_graph(prompt, max_nodes=max_nodes)
        nodes, edges = _normalise_graph(graph, max_nodes)
    except RuntimeError as exc:
        code = str(exc)
        status = 503 if code in {'cloudflare_ai_not_configured', 'cloudflare_ai_failed'} else 502
        return _error(code, status)

    with transaction.atomic():
        if mode == 'replace':
            item.nodes.all().delete()
            x_offset = 80.0
        else:
            current_max_x = max((node.x for node in item.nodes.all()), default=-220.0)
            x_offset = max(80.0, current_max_x + 320.0)

        positions = _layout(nodes, edges, x_offset=x_offset, y_offset=90.0)
        created = {}
        existing_keys = set(item.nodes.values_list('key', flat=True))
        for index, node_data in enumerate(nodes, start=1):
            key = node_data['key']
            if key in existing_keys:
                base = f'ai-{key}'[:70]
                key = base
                suffix = 2
                while key in existing_keys:
                    key = f'{base[:62]}-{suffix}'
                    suffix += 1
                # Update generated edge references to the final persisted key.
                for edge in edges:
                    if edge['source'] == node_data['key']:
                        edge['source'] = key
                    if edge['target'] == node_data['key']:
                        edge['target'] = key
                node_data['key'] = key
            existing_keys.add(key)
            x, y = positions.get(node_data['key'], (x_offset, 90.0 + index * 150.0))
            node = MindMapNode.objects.create(
                mind_map=item,
                key=key,
                title=node_data['title'],
                body=node_data['body'],
                kind=node_data['kind'],
                x=x,
                y=y,
            )
            created[key] = node

        for edge_data in edges:
            source = created.get(edge_data['source'])
            target = created.get(edge_data['target'])
            if not source or not target or source.pk == target.pk:
                continue
            MindMapEdge.objects.get_or_create(
                mind_map=item,
                source=source,
                target=target,
                relation=edge_data['relation'],
                defaults={'label': edge_data['label']},
            )

        if not item.description and str(graph.get('summary') or '').strip():
            item.description = str(graph.get('summary') or '').strip()[:2000]
        item.save(update_fields=['description', 'updated_at'])

    item.refresh_from_db()
    return JsonResponse({
        'ok': True,
        'provider': 'cloudflare-workers-ai',
        'model': str(getattr(settings, 'CLOUDFLARE_AI_MODEL', '') or '@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
        'item': _map_json(item),
    })
