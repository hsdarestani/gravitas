"""Presentation metadata for the existing project and its canonical tasks."""

import re

from django.core.exceptions import ValidationError


ID = re.compile(r'^[a-z0-9-]{1,80}$')


def visible_canvas(canvas, task_ids):
    groups = [group for group in canvas.get('groups', []) if set(group['members']) <= task_ids]
    frames = canvas.get('frames', [])
    endpoints = task_ids | {f"frame:{frame['id']}" for frame in frames} | {f"group:{group['id']}" for group in groups}
    return {
        'positions': {pk: point for pk, point in canvas.get('positions', {}).items() if pk in task_ids},
        'frames': frames,
        'groups': groups,
        'arrows': [arrow for arrow in canvas.get('arrows', []) if {arrow['from'], arrow['to']} <= endpoints],
        'start_date': canvas.get('start_date', ''),
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


def validate_canvas(canvas, task_ids):
    from datetime import date

    if not isinstance(canvas, dict) or set(canvas) != {'positions', 'frames', 'groups', 'arrows', 'start_date'}:
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
    _shapes(canvas['arrows'], {'id', 'from', 'to'})
    endpoints = task_ids | {f'frame:{pk}' for pk in frames} | {f'group:{pk}' for pk in groups}
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
