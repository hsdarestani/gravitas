"""Public anonymous prelaunch feedback and Core-only review/export."""
import csv
import io
import json
from collections import Counter

from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods

from .layer_admin_api import _core_admin, _deny
from .models import PrelaunchFeedback

SURVEY_VERSION = 'prelaunch-2026-v1'
TEXT_FIELDS = {
    'video_feedback': 2000,
    'visual_feedback': 2000,
    'scientific_content_feedback': 2000,
    'first_impression': 2000,
    'persona_other': 160,
}
RATINGS = {'overall_rating': 10, 'usability': 5, 'expectations_difference': 5}
SECTIONS = ('video', 'essay', 'sources', 'viewpoints', 'pulsar', 'forum')
PERSONAS = ('a1', 'a2', 'a3', 'other')


def _parse_submission(data):
    if not isinstance(data, dict) or set(data) - {'name', 'answers', 'website'}:
        raise ValueError('invalid_payload')
    if data.get('website'):
        raise ValueError('invalid_payload')
    name = data.get('name', '')
    if not isinstance(name, str) or len(name) > 120:
        raise ValueError('invalid_name')
    answers = data.get('answers', {})
    if not isinstance(answers, dict):
        raise ValueError('invalid_answers')
    if set(answers) - set(TEXT_FIELDS) - set(RATINGS) - {'persona', 'section_ratings'}:
        raise ValueError('unknown_answer_field')
    clean = {}
    for key, maximum_length in TEXT_FIELDS.items():
        value = answers.get(key)
        if value is None or value == '':
            continue
        if not isinstance(value, str) or len(value) > maximum_length:
            raise ValueError('invalid_' + key)
        if value.strip():
            clean[key] = value.strip()
    persona = answers.get('persona')
    if persona not in (None, ''):
        if not isinstance(persona, str) or persona not in PERSONAS:
            raise ValueError('invalid_persona')
        clean['persona'] = persona
    for key, maximum in RATINGS.items():
        value = answers.get(key)
        if value is None or value == '':
            continue
        if type(value) is not int or not (1 <= value <= maximum):
            raise ValueError('invalid_' + key)
        clean[key] = value
    section_ratings = answers.get('section_ratings')
    if section_ratings is not None:
        if not isinstance(section_ratings, dict) or set(section_ratings) - set(SECTIONS):
            raise ValueError('invalid_section_ratings')
        section_clean = {}
        for section, score in section_ratings.items():
            if score in (None, ''):
                continue
            if type(score) is not int or not 1 <= score <= 10:
                raise ValueError('invalid_section_ratings')
            section_clean[section] = score
        if section_clean:
            clean['section_ratings'] = section_clean
    return name.strip(), clean


def _serialize(item):
    return {
        'name': item.name,
        'answers': item.answers,
        'created_at': item.created_at.isoformat(),
        'updated_at': item.updated_at.isoformat(),
    }


@ensure_csrf_cookie
@require_http_methods(['GET', 'POST'])
def prelaunch_feedback(request):
    """Anonymous access; editing a response is scoped to this browser's session."""
    current = None
    saved_id = request.session.get('prelaunch_feedback_id')
    if saved_id:
        current = PrelaunchFeedback.objects.filter(pk=saved_id, survey_version=SURVEY_VERSION).first()
    if request.method == 'GET':
        response = JsonResponse({'ok': True, 'submission': _serialize(current) if current else None})
        response['Cache-Control'] = 'no-store'
        return response

    try:
        data = json.loads(request.body.decode('utf-8'))
        name, answers = _parse_submission(data)
    except (TypeError, ValueError, UnicodeDecodeError) as exc:
        return JsonResponse({'ok': False, 'error': str(exc) or 'invalid_payload'}, status=400)

    if current is None:
        current = PrelaunchFeedback.objects.create(
            survey_version=SURVEY_VERSION, name=name, answers=answers
        )
        request.session['prelaunch_feedback_id'] = str(current.pk)
    else:
        current.name = name
        current.answers = answers
        current.save(update_fields=['name', 'answers', 'updated_at'])
    response = JsonResponse({'ok': True, 'submission': _serialize(current)})
    response['Cache-Control'] = 'no-store'
    return response


def _safe_csv(value):
    """Guard against spreadsheet formula injection in open-ended answers."""
    value = str(value if value is not None else '')
    if value.lstrip().startswith(('=', '+', '-', '@')):
        return "'" + value
    return value


@require_http_methods(['GET'])
def admin_prelaunch_feedback(request):
    if not _core_admin(request):
        return _deny(request)
    base = PrelaunchFeedback.objects.filter(survey_version=SURVEY_VERSION).order_by('-created_at', '-id')
    if request.GET.get('format') == 'csv':
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        fields = [
            'id', 'name', 'created_at', 'updated_at', 'persona', 'persona_other',
            'video_feedback', 'overall_rating', 'visual_feedback',
            'scientific_content_feedback', 'usability', 'first_impression',
            'expectations_difference',
        ] + ['rating_' + section for section in SECTIONS]
        writer.writerow(fields)
        for submission in base.iterator(chunk_size=200):
            a = submission.answers or {}
            values = [
                str(submission.pk), submission.name, submission.created_at.isoformat(),
                submission.updated_at.isoformat(), a.get('persona', ''),
                a.get('persona_other', ''), a.get('video_feedback', ''),
                a.get('overall_rating', ''), a.get('visual_feedback', ''),
                a.get('scientific_content_feedback', ''), a.get('usability', ''),
                a.get('first_impression', ''), a.get('expectations_difference', ''),
            ] + [a.get('section_ratings', {}).get(section, '') for section in SECTIONS]
            writer.writerow([_safe_csv(value) for value in values])
        response = HttpResponse(buffer.getvalue(), content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="graviquest-prelaunch-feedback.csv"'
        response['Cache-Control'] = 'no-store'
        return response

    persona = str(request.GET.get('persona', '')).lower()
    if persona in PERSONAS:
        filtered = base.filter(answers__persona=persona)
    elif persona == 'unspecified':
        filtered = base.exclude(answers__has_key='persona')
    else:
        filtered = base

    try:
        page = max(1, min(10000, int(request.GET.get('page', '1'))))
    except (TypeError, ValueError):
        page = 1
    per_page = 50
    rows = list(filtered[(page - 1) * per_page:page * per_page])

    # Prelaunch cohorts are intentionally small. Aggregate from the original
    # unfiltered group so navigating pages/filters never changes headline metrics.
    all_answers = list(base.values_list('answers', flat=True))
    counts = Counter((a or {}).get('persona') or 'unspecified' for a in all_answers)
    keys = list(RATINGS) + ['section:' + s for s in SECTIONS]
    metrics = {}
    for key in keys:
        values = []
        for answer in all_answers:
            answer = answer or {}
            value = answer.get('section_ratings', {}).get(key[8:]) if key.startswith('section:') else answer.get(key)
            if type(value) is int:
                values.append(value)
        metrics[key] = round(sum(values) / len(values), 2) if values else None

    response = JsonResponse({
        'ok': True,
        'total': len(all_answers),
        'filtered_total': filtered.count(),
        'page': page,
        'per_page': per_page,
        'persona_counts': dict(counts),
        'averages': metrics,
        'responses': [
            {'id': str(item.pk), **_serialize(item)}
            for item in rows
        ],
    })
    response['Cache-Control'] = 'no-store'
    return response
