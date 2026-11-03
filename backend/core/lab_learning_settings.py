"""Versioned editor settings shared by the published learning workspace."""
from copy import deepcopy
from functools import lru_cache
import json
from pathlib import Path


@lru_cache(maxsize=1)
def defaults():
    return json.loads((Path(__file__).parent / 'data/lab-learning-defaults.json').read_text())


def learning_settings(raw=None):
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ValueError('invalid_learning_workspace')
    clean = deepcopy(defaults())
    for key, maximum in (('guest_question_limit', 1000), ('lesson_days', 120)):
        value = raw.get(key, clean[key])
        if type(value) is not int or not 1 <= value <= maximum:
            raise ValueError('invalid_' + key)
        clean[key] = value
    value = raw.get('auto_start_guide', clean['auto_start_guide'])
    if type(value) is not bool:
        raise ValueError('invalid_auto_start_guide')
    clean['auto_start_guide'] = value
    lessons = raw.get('lessons', {})
    if not isinstance(lessons, dict) or set(lessons) - set(clean['lessons']):
        raise ValueError('invalid_guided_lessons')
    for key, fields in lessons.items():
        if not isinstance(fields, dict) or set(fields) - {'title', 'question', 'watch'}:
            raise ValueError('invalid_guided_lesson')
        for field, size in (('title', 140), ('question', 350), ('watch', 500)):
            text = fields.get(field, clean['lessons'][key][field])
            if not isinstance(text, str) or not text.strip() or len(text) > size:
                raise ValueError('invalid_lesson_' + field)
            clean['lessons'][key][field] = text.strip()
    return clean


def published_learning_settings(lab):
    return learning_settings((lab.published_config or {}).get('learning_workspace'))
