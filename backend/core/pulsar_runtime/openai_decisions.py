"""Bounded OpenAI Decisions API matching for Pulsar daily reports.

Optional and fail-open for reporting: an unavailable decision service must never
lose a work log. This module never writes to OperatingTask or grants access.
Candidate task IDs come exclusively from the caller's ACL-filtered catalog.
"""
import json
import logging
import math
import os

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

DECISIONS_URL = 'https://api.openai.com/v1/decisions'
DECISIONS_MODEL = 'gpt-6-luna'


def _config(name, default=''):
    return getattr(settings, name, os.environ.get(name, default))


def enabled():
    flag = str(_config('PULSAR_REPORT_DECISIONS_ENABLED', 'false')).lower()
    return flag in {'1', 'true', 'yes', 'on'} and bool(_api_key())


def _api_key():
    return str(_config('PULSAR_REPORT_DECISIONS_API_KEY') or
               _config('PULSAR_OPENAI_API_KEY') or '').strip()


def _minimum(name, default):
    try:
        value = float(_config(name, default))
    except (TypeError, ValueError):
        return default
    return min(1.0, max(0.0, value)) if math.isfinite(value) else default


def choose_report_tasks(updates, available_tasks, candidate_picker):
    """Return {activity_index: permitted_task_id} for high-certainty matches.

    One batch request for multiple independent activities, with a mandatory
    'none' option for every question. API confidence is NOT task permission.
    """
    if not enabled():
        return {}

    tasks_by_id = {task.pk: task for task in available_tasks}
    questions, evidence = [], []
    for index, update in enumerate(updates[:20]):
        if update.get('task_id'):
            continue
        activity = ' '.join(filter(None, [
            str(update.get('title') or ''), str(update.get('progress') or ''),
            str(update.get('deliverable') or ''),
        ]))[:1200]
        candidates = candidate_picker(tasks_by_id.values(), activity, limit=6)
        choices = [{'value': 'none', 'description': (
            'No task has this exact deliverable, or the match is ambiguous. '
            'Generic website, social, research or video keywords are not sufficient.'
        )}]
        selected_ids = []
        for row in candidates:
            task = tasks_by_id.get(row['id'])
            if task is None:
                continue
            selected_ids.append(task.pk)
            choices.append({
                'value': str(task.pk),
                'description': (
                    f"Task: {task.title}; project: "
                    f"{task.project.title if task.project_id else 'Core'}; "
                    f"deliverable: {str(task.definition_of_done or '')[:170]}"
                )[:400],
            })
        if not selected_ids:
            continue
        questions.append({
            'type': 'choice',
            'name': f'activity_{index}',
            'instructions': (
                f'Which existing task exactly corresponds to reported activity #{index}? '
                'Only select a task if its *specific deliverable* matches the work, '
                'not simply because of a shared keyword or project. '
                'For different stages (creation vs approval vs publishing), choose none. '
                'If two candidates are similarly plausible, choose none.'
            ),
            'choices': choices,
        })
        evidence.append({'index': index, 'reported_activity': activity,
                         'allowed_task_ids': selected_ids})
    if not questions:
        return {}

    try:
        response = requests.post(
            DECISIONS_URL,
            headers={'Authorization': f'Bearer {_api_key()}',
                     'Content-Type': 'application/json'},
            json={'model': DECISIONS_MODEL,
                  'input': json.dumps({'reported_work': evidence}, ensure_ascii=False),
                  'questions': questions},
            timeout=(3, max(4, min(12, int(_config('PULSAR_REPORT_DECISIONS_TIMEOUT', 8))))),
        )
        response.raise_for_status()
        payload = response.json()
        answers = payload.get('answers')
        if not isinstance(answers, list):
            raise ValueError('invalid_decisions_answers')
    except (requests.RequestException, ValueError, TypeError) as exc:
        logger.warning('Pulsar report Decisions API unavailable (%s); preserving unmatched work',
                       exc.__class__.__name__)
        return {}

    allowed = {question['name']: {choice['value'] for choice in question['choices']}
               for question in questions}
    min_confidence = _minimum('PULSAR_REPORT_DECISIONS_MIN_CONFIDENCE', 0.88)
    min_probability = _minimum('PULSAR_REPORT_DECISIONS_MIN_PROBABILITY', 0.88)
    min_margin = _minimum('PULSAR_REPORT_DECISIONS_MIN_MARGIN', 0.25)
    decisions = {}
    used = set()
    for answer in answers:
        if not isinstance(answer, dict) or answer.get('type') != 'choice':
            continue
        name = str(answer.get('name') or '')
        choice = str(answer.get('choice') or '')
        if name not in allowed or choice not in allowed[name] or choice == 'none':
            continue
        try:
            index = int(name.removeprefix('activity_'))
            task_id = int(choice)
            confidence = float(answer['confidence'])
            probabilities = {str(row['value']): float(row['probability'])
                             for row in answer['probabilities']}
            chosen = probabilities[choice]
            runner_up = max((prob for key, prob in probabilities.items()
                             if key != choice), default=1)
        except (TypeError, ValueError, KeyError, OverflowError):
            continue
        if not all(math.isfinite(x) for x in (confidence, chosen, runner_up)):
            continue
        if (task_id in tasks_by_id and task_id not in used
                and 0 <= index < len(updates)
                and confidence >= min_confidence
                and chosen >= min_probability
                and chosen - runner_up >= min_margin):
            decisions[index] = task_id
            used.add(task_id)
    return decisions
