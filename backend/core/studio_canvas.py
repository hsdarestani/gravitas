"""Presentation metadata for the existing project and its canonical tasks."""

import re

from django.core.exceptions import ValidationError


ID = re.compile(r'^[a-z0-9-]{1,80}$')


def visible_canvas(canvas, task_ids, project_ids=None):
    groups = [group for group in canvas.get('groups', []) if set(group['members']) <= task_ids]
    frames = canvas.get('frames', [])
    nodes = [node for node in canvas.get('nodes', []) if project_ids is None or node['targetProjectId'] in project_ids]
    node_ids = {node['id'] for node in nodes}
    endpoints = task_ids | node_ids | {f"frame:{frame['id']}" for frame in frames} | {f"group:{group['id']}" for group in groups}
    return {
        'positions': {pk: point for pk, point in canvas.get('positions', {}).items() if pk in task_ids},
        'frames': frames,
        'groups': groups,
        'arrows': [arrow for arrow in canvas.get('arrows', []) if {arrow['from'], arrow['to']} <= endpoints],
        'start_date': canvas.get('start_date', ''),
        **({'nodes': nodes} if 'nodes' in canvas else {}),
        **({'handoffs': [edge for edge in canvas['handoffs'] if set(edge) <= task_ids | node_ids]} if 'handoffs' in canvas else {}),
        **({'loops': [loop for loop in canvas['loops'] if {loop['from'], loop['to']} <= task_ids]} if 'loops' in canvas else {}),
        **({'end_time': canvas['end_time']} if 'end_time' in canvas else {}),
    }


def _number(value):
    return type(value) is int and 0 <= value <= 100_000


def _shapes(value, keys):
    if not isinstance(value, list) or len(value) > 300:
        raise ValidationError('invalid_canvas_shapes')
    seen = set()
    for shape in value:
        if not isinstance(shape, dict) or set(shape) != keys or not isinstance(shape.get('id'), str):
            raise ValidationError('invalid_canvas_shapes')
        name = shape['id']
        if not ID.fullmatch(name) or name in seen:
            raise ValidationError('invalid_canvas_shapes')
        title = shape.get('title')
        if 'title' in shape and (not isinstance(title, str) or not title.strip() or len(title) > 100):
            raise ValidationError('invalid_canvas_shapes')
        seen.add(name)
    return seen


def validate_canvas(canvas, task_ids, project_ids=frozenset()):
    from datetime import date

    required = {'positions', 'frames', 'groups', 'arrows', 'start_date'}
    if not isinstance(canvas, dict) or not required <= set(canvas) or set(canvas) - required - {'nodes', 'handoffs', 'loops', 'end_time'}:
        raise ValidationError('invalid_canvas')
    positions = canvas['positions']
    if not isinstance(positions, dict) or not set(positions) <= task_ids:
        raise ValidationError('invalid_canvas_positions')
    for point in positions.values():
        if not isinstance(point, dict) or set(point) != {'x', 'y'} or not all(map(_number, point.values())):
            raise ValidationError('invalid_canvas_positions')
    frames = _shapes(canvas['frames'], {'id', 'title', 'x', 'y', 'width', 'height'})
    for frame in canvas['frames']:
        if not all(_number(frame[key]) for key in ('x', 'y', 'width', 'height')) or not frame['width'] or not frame['height']:
            raise ValidationError('invalid_canvas_frame')
    groups = _shapes(canvas['groups'], {'id', 'title', 'members'})
    for group in canvas['groups']:
        members = group['members']
        if (not isinstance(members, list) or not 2 <= len(members) <= 100
                or any(not isinstance(pk, str) for pk in members) or len(set(members)) != len(members)
                or not set(members) <= task_ids):
            raise ValidationError('invalid_canvas_group')
    nodes = _shapes(canvas.get('nodes', []), {'id','targetProjectId','milestoneId','x','y'})
    for node in canvas.get('nodes', []):
        target, milestone = node['targetProjectId'], node['milestoneId']
        if (not _number(node['x']) or not _number(node['y']) or not node['id'].startswith('project-link-')
                or not isinstance(target, str) or target not in project_ids
                or not isinstance(milestone, str) or milestone and not milestone.isdecimal()):
            raise ValidationError('invalid_project_node')
    handoffs = canvas.get('handoffs', [])
    if not isinstance(handoffs, list) or len(handoffs) > 1200:
        raise ValidationError('invalid_project_handoff')
    for edge in handoffs:
        if (not isinstance(edge, list) or len(edge) != 2 or any(not isinstance(item, str) for item in edge)
                or edge[0] == edge[1] or not set(edge) <= task_ids | nodes or not set(edge) & nodes):
            raise ValidationError('invalid_project_handoff')
    loops = canvas.get('loops', [])
    _shapes(loops, {'id','from','to','target','count','optional'})
    for loop in loops:
        if (not isinstance(loop['from'], str) or not isinstance(loop['to'], str)
                or not {loop['from'],loop['to']} <= task_ids or type(loop['target']) is not int
                or not 1 <= loop['target'] <= 9_999 or type(loop['count']) is not int
                or not 0 <= loop['count'] <= loop['target'] or type(loop['optional']) is not bool):
            raise ValidationError('invalid_review_loop')
    end_time = canvas.get('end_time', '23:59')
    if not isinstance(end_time, str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', end_time):
        raise ValidationError('invalid_canvas_end_time')
    _shapes(canvas['arrows'], {'id', 'from', 'to'})
    endpoints = task_ids | nodes | {f'frame:{pk}' for pk in frames} | {f'group:{pk}' for pk in groups}
    for arrow in canvas['arrows']:
        start, end = arrow['from'], arrow['to']
        if (not isinstance(start, str) or not isinstance(end, str) or start == end
                or start not in endpoints or end not in endpoints
                or not (start.startswith('frame:') or end.startswith('frame:'))):
            raise ValidationError('invalid_canvas_arrow')
    if canvas['start_date'] != '':
        try:
            if date.fromisoformat(canvas['start_date']).isoformat() != canvas['start_date']:
                raise ValueError
        except (TypeError, ValueError):
            raise ValidationError('invalid_canvas_start_date') from None


def validate_links(project, workspace, canvas, rows, previous):
    from .models import WorkspaceStudioCanvas
    from .operating_models import OperatingMilestone, OperatingTaskPredecessor, WorkStatus

    root = str(project.pk)
    graph = {str(layout.project_id): [node['targetProjectId'] for node in layout.canvas.get('nodes', [])]
             for layout in WorkspaceStudioCanvas.objects.filter(project__workspace__organization=workspace.organization)}
    targets = [node['targetProjectId'] for node in canvas.get('nodes', [])]
    pending, seen = list(targets), set()
    while pending:
        target = pending.pop()
        if target == root:
            raise ValidationError('project_node_cycle')
        if target not in seen:
            seen.add(target)
            pending.extend(graph.get(target, ()))
    for node in canvas.get('nodes', []):
        if node['milestoneId'] and not OperatingMilestone.objects.filter(
            workspace=workspace, project_id=node['targetProjectId'], pk=node['milestoneId'],
        ).exists():
            raise ValidationError('invalid_project_node_milestone')

    ids = {str(row.pk): row for row in rows}
    edges = [(str(row.dependency_id), str(row.pk)) for row in rows if str(row.dependency_id) in ids]
    edges += [(str(source), str(target)) for source, target in OperatingTaskPredecessor.objects.filter(
        task_id__in=ids, predecessor_id__in=ids,
    ).values_list('predecessor_id', 'task_id')]
    plain = list(edges)
    edges += [tuple(edge) for edge in canvas.get('handoffs', [])]
    outgoing = {}
    for source, target in edges:
        outgoing.setdefault(source, set()).add(target)

    def reachable(start, target, all_edges):
        pending, seen = [start], set()
        while pending:
            node = pending.pop()
            if node == target:
                return True
            if node not in seen:
                seen.add(node)
                pending.extend(all_edges.get(node, ()))
        return False

    if any(reachable(target, source, outgoing) for source, target in edges):
        raise ValidationError('dependency_cycle')
    ordinary = {}
    for source, target in plain:
        ordinary.setdefault(source, set()).add(target)
    prior_loops = {loop['id']:loop for loop in previous.get('loops', [])}
    current = {loop['id']:loop for loop in canvas.get('loops', [])}
    if any(loop['count'] and pk not in current for pk, loop in prior_loops.items()):
        raise ValidationError('review_history_exists')
    if len({(loop['from'],loop['to']) for loop in current.values()}) != len(current):
        raise ValidationError('duplicate_review_loop')
    for loop in current.values():
        earlier = prior_loops.get(loop['id'])
        if loop['count'] != (earlier['count'] if earlier else 0):
            raise ValidationError('review_pass_requires_findings')
        if earlier and earlier['count'] and any(loop[field] != earlier[field] for field in ('from','to')):
            raise ValidationError('review_history_exists')
        if not reachable(loop['to'], loop['from'], ordinary):
            raise ValidationError('invalid_review_path')
        if not loop['optional'] and loop['count'] < loop['target'] and ids[loop['from']].status == WorkStatus.DONE:
            raise ValidationError('review_task_already_done')


def incomplete_project_handoff(task):
    from .models import WorkspaceStudioCanvas, ResearchProject
    from .operating_models import OperatingMilestone, WorkStatus

    canvas = WorkspaceStudioCanvas.objects.filter(project_id=task.project_id).values_list('canvas', flat=True).first() or {}
    incoming = {}
    for source, target in canvas.get('handoffs', []):
        incoming.setdefault(target, []).append(source)
    nodes = {node['id']:node for node in canvas.get('nodes', [])}
    for source in incoming.get(str(task.pk), []):
        node = nodes[source]
        project = ResearchProject.objects.filter(pk=node['targetProjectId']).select_related('studio_project').first()
        if not project:
            return True
        metadata = getattr(project, 'studio_project', None)
        if metadata and metadata.outcome == 'failed':
            return True
        if node['milestoneId']:
            if not OperatingMilestone.objects.filter(project=project, pk=node['milestoneId'], status=WorkStatus.DONE).exists():
                return True
        elif not project.archived:
            return True
    return False
