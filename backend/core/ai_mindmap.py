from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .ai_providers import AIProviderError, provider_graph, selected_credential
from .mindmap_ai import (
    GENERIC_TITLES,
    _body,
    _edge_json,
    _error,
    _layout,
    _map_json,
    _normalise_graph,
    generate_mindmap_ai as generate_managed_mindmap_ai,
)
from .platform_access import can_edit, can_view
from .platform_models import MindMap, MindMapEdge, MindMapNode


@require_POST
def generate_mindmap_ai(request, map_id):
    """Keep managed Workers AI as the default, but honor a user's BYOK selection."""
    if not request.user.is_authenticated:
        return _error('authentication_required', 401)
    if selected_credential(request.user) is None:
        return generate_managed_mindmap_ai(request, map_id)

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

    user_prompt = str(data.get('prompt') or '').strip()
    if user_prompt and len(user_prompt) < 12:
        return _error('prompt_too_vague')

    prompt = user_prompt
    if not prompt:
        title = str(item.title or '').strip()
        if title.lower() in GENERIC_TITLES and not str(item.description or '').strip() and not item.project:
            return _error('prompt_too_vague')
        project_context = ''
        if item.project:
            project_context = f' Project: {item.project.title}. {item.project.description or ""}'
        prompt = f'Create a research mind map for “{title}”. {item.description or ""}{project_context}'.strip()

    prompt = (
        f'{prompt[:8000]}\n\n'
        f'Output target: about {max_nodes} nodes. Use one concrete root, several direct primary branches, '
        'then secondary concepts. Avoid generic placeholder wording and avoid a single long chain.'
    )
    if mode == 'append' and item.nodes.exists():
        existing = '; '.join(node.title for node in item.nodes.all()[:20])
        prompt += f'\nExisting map concepts (avoid needless duplication): {existing}'

    try:
        graph, provider = provider_graph(request.user, prompt, timeout=60)
        nodes, edges = _normalise_graph(graph, max_nodes)
    except AIProviderError as exc:
        return _error(str(exc), 502)
    except RuntimeError as exc:
        return _error(str(exc), 502)

    with transaction.atomic():
        if mode == 'replace':
            item.nodes.all().delete()
            x_offset = 80.0
        else:
            current_max_x = max((node.x for node in item.nodes.all()), default=-220.0)
            x_offset = max(80.0, current_max_x + 360.0)

        positions = _layout(nodes, edges, x_offset=x_offset, y_offset=90.0)
        created = {}
        existing_keys = set(item.nodes.values_list('key', flat=True))
        for index, node_data in enumerate(nodes, start=1):
            original_key = node_data['key']
            key = original_key
            if key in existing_keys:
                base, suffix = f'ai-{key}'[:70], 2
                key = base
                while key in existing_keys:
                    key = f'{base[:62]}-{suffix}'
                    suffix += 1
                for edge in edges:
                    if edge['source'] == original_key:
                        edge['source'] = key
                    if edge['target'] == original_key:
                        edge['target'] = key
                node_data['key'] = key
                if original_key in positions:
                    positions[key] = positions.pop(original_key)
            existing_keys.add(key)
            x, y = positions.get(key, (x_offset, 90.0 + index * 176.0))
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
            source, target = created.get(edge_data['source']), created.get(edge_data['target'])
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
        'provider': provider.provider,
        'provider_label': provider.label,
        'model': provider.model,
        'item': _map_json(item),
    })
