"""Public anonymous prelaunch feedback and Core-only review/export."""
import csv
import io
import json
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db.models import Q
from django.http import HttpResponse, JsonResponse
from django.utils import timezone as django_timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods

from .layer_admin_api import _core_admin, _deny
from .models import PrelaunchFeedback

SURVEY_VERSION = 'prelaunch-2026-v1'
# Keep the original answers valid; new fields share the same survey version
# so existing anonymous sessions and earlier admin responses remain intact.
TEXT_FIELDS = {
    'video_feedback': 2000, 'visual_feedback': 2000,
    'scientific_content_feedback': 2000, 'first_impression': 2000,
    'persona_other': 160,
    'site_purpose': 2000, 'target_audience': 2000,
    'broken_where': 2000, 'future_topics': 2000,
    'topic_best_part': 2000, 'topic_improvements': 2000,
    'video_stop_reason': 2000, 'forum_motivation': 2000,
    'lab_learn_expectations': 2000, 'one_change': 2000,
    'other_feedback': 2000,
}
RATINGS = {
    'overall_rating': (1, 10),  # Original survey: do not recast as /5.
    'usability': (1, 5),  # Original survey: lower = easier.
    'expectations_difference': (1, 5),
    'site_works': (1, 5), 'goals_clear': (1, 5),
    'trustworthy': (1, 5), 'findability': (1, 5),
    'page_speed': (1, 5), 'device_experience': (1, 5),
    'visual_attractiveness': (1, 5), 'text_readability': (1, 5),
    'topics_clarity': (1, 5), 'topic_interest': (1, 5),
    'topic_quality': (1, 5), 'explanations_clarity': (1, 5),
    'learning_gain': (1, 5), 'video_content_quality': (1, 5),
    'video_visuals': (1, 5), 'video_audio': (1, 5),
    'community_purpose': (1, 5), 'forum_usability': (1, 5),
    'forum_participation': (1, 5), 'return_likelihood': (1, 5),
    'recommend_likelihood': (0, 10),
}
CHOICES = {
    'anything_broken': ('yes', 'no'),
    'topic_difficulty': ('too_easy', 'about_right', 'too_hard'),
    'topic_length': ('too_short', 'about_right', 'too_long'),
    'video_watched': ('all', 'part', 'no'),
    'video_pace': ('too_slow', 'about_right', 'too_fast'),
    'community_visited': ('yes', 'no'),
}
EXPORT_FIELDS = [
    'persona', 'persona_other',
    'site_works', 'goals_clear', 'site_purpose', 'target_audience',
    'trustworthy', 'first_impression', 'expectations_difference',
    'findability', 'page_speed', 'anything_broken', 'broken_where',
    'device_experience', 'visual_attractiveness', 'text_readability',
    'visual_feedback', 'topics_clarity', 'future_topics',
    'topic_interest', 'topic_quality', 'topic_difficulty', 'topic_length',
    'explanations_clarity', 'learning_gain', 'video_watched',
    'video_content_quality', 'video_visuals', 'video_audio',
    'video_pace', 'video_stop_reason', 'topic_best_part',
    'topic_improvements', 'video_feedback', 'scientific_content_feedback',
    'community_visited', 'community_purpose', 'forum_usability',
    'forum_participation', 'forum_motivation', 'lab_learn_expectations',
    'return_likelihood', 'recommend_likelihood', 'one_change',
    'other_feedback', 'contact_email',
    # Original survey fields, kept for historical records.
    'overall_rating', 'usability',
]
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
    if set(answers) - set(TEXT_FIELDS) - set(RATINGS) - set(CHOICES) - {'persona', 'section_ratings', 'contact_email'}:
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
    for key, allowed in CHOICES.items():
        value = answers.get(key)
        if value is None or value == '':
            continue
        if not isinstance(value, str) or value not in allowed:
            raise ValueError('invalid_' + key)
        clean[key] = value
    for key, (minimum, maximum) in RATINGS.items():
        value = answers.get(key)
        if value is None or value == '':
            continue
        if type(value) is not int or not (minimum <= value <= maximum):
            raise ValueError('invalid_' + key)
        clean[key] = value
    email = answers.get('contact_email')
    if email not in (None, ''):
        if not isinstance(email, str) or len(email) > 254:
            raise ValueError('invalid_contact_email')
        email = email.strip()
        try:
            validate_email(email)
        except ValidationError:
            raise ValueError('invalid_contact_email')
        clean['contact_email'] = email

    # Follow-up branches are never stored when a respondent chooses 'No'.
    # Preserve old-version free-text video answers until the visitor explicitly
    # answers video_watched: otherwise an edit would silently erase old feedback.
    if clean.get('persona') != 'other':
        clean.pop('persona_other', None)
    if clean.get('anything_broken') != 'yes':
        clean.pop('broken_where', None)
    if clean.get('community_visited') != 'yes':
        for key in ('community_purpose', 'forum_usability',
                    'forum_participation', 'forum_motivation'):
            clean.pop(key, None)
    if clean.get('video_watched') not in ('all', 'part'):
        for key in ('video_content_quality', 'video_visuals', 'video_audio',
                    'video_pace', 'video_stop_reason'):
            clean.pop(key, None)
        if clean.get('video_watched') == 'no':
            clean.pop('video_feedback', None)
    elif clean.get('video_watched') != 'part':
        clean.pop('video_stop_reason', None)
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


# Analytics uses the stored answer contract, including branches and the original
# form. Both forms used the same survey_version, so only stored legacy scores
# establish membership of the historical cohort.
LEGACY_RATINGS = {
    'overall_rating': RATINGS['overall_rating'],
    'usability': RATINGS['usability'],
    **{'section:' + section: (1, 10) for section in SECTIONS},
}
CURRENT_RATINGS = {key: scale for key, scale in RATINGS.items() if key not in LEGACY_RATINGS}
CATEGORIES = {'persona': PERSONAS, **CHOICES}
COHORT_FILTERS = ('persona', 'video_watched', 'community_visited')
GATES = {
    'persona_other': ('persona', ('other',)),
    'broken_where': ('anything_broken', ('yes',)),
    **{key: ('video_watched', ('all', 'part')) for key in (
        'video_content_quality', 'video_visuals', 'video_audio', 'video_pace', 'video_feedback'
    )},
    'video_stop_reason': ('video_watched', ('part',)),
    **{key: ('community_visited', ('yes',)) for key in (
        'community_purpose', 'forum_usability', 'forum_participation', 'forum_motivation'
    )},
}
RATING_SCALES = {**CURRENT_RATINGS, **LEGACY_RATINGS}
OPTIONS = {
    **CATEGORIES,
    **{key: tuple(range(low, high + 1)) for key, (low, high) in RATING_SCALES.items()},
}
QUESTION_KEYS = (*OPTIONS, *TEXT_FIELDS, 'contact_email', 'name')
CURRENT_QUESTIONS = (*CATEGORIES, *CURRENT_RATINGS, *TEXT_FIELDS)


def _text_value(value):
    return value.strip() if isinstance(value, str) else ''


def _answer(answers, key):
    if key.startswith('section:'):
        sections = answers.get('section_ratings')
        return sections.get(key[8:]) if isinstance(sections, dict) else None
    return answers.get(key)


def _cohort(params):
    bounds = []
    for key in ('from', 'to'):
        value = params.get(key)
        try:
            parsed = date.fromisoformat(value) if value else None
            if parsed and parsed.isoformat() != value:
                raise ValueError
            bounds.append(parsed)
        except ValueError:
            raise ValueError('Enter dates in YYYY-MM-DD format.') from None
    start, end = bounds
    if start and end and start > end:
        raise ValueError('The end date must be on or after the start date.')

    filtered = PrelaunchFeedback.objects.filter(survey_version=SURVEY_VERSION)
    if start:
        filtered = filtered.filter(created_at__gte=datetime.combine(start, time.min, timezone.utc))
    if end:
        filtered = filtered.filter(created_at__lte=datetime.combine(end, time.max, timezone.utc))
    for key in COHORT_FILTERS:
        value = params.get(key)
        if not value:
            continue
        if value == 'unspecified':
            filtered = filtered.filter(
                ~Q(answers__has_key=key) | Q(**{f'answers__{key}': None}) | Q(**{f'answers__{key}': ''})
            )
        elif value in CATEGORIES[key]:
            filtered = filtered.filter(**{f'answers__{key}': value})
        else:
            raise ValueError('Choose a valid survey filter.')
    return filtered.order_by('-created_at', '-id'), start, end


def _csv_response(rows):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(['id', 'name', 'created_at', 'updated_at'] + EXPORT_FIELDS + [
        'rating_' + section for section in SECTIONS
    ])
    for submission in rows:
        answers = submission.answers or {}
        values = [
            submission.pk, submission.name, submission.created_at.isoformat(),
            submission.updated_at.isoformat(),
        ] + [answers.get(field) for field in EXPORT_FIELDS] + [
            _answer(answers, 'section:' + section) for section in SECTIONS
        ]
        writer.writerow([_safe_csv(value) for value in values])
    response = HttpResponse(buffer.getvalue(), content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = 'attachment; filename="graviquest-prelaunch-feedback.csv"'
    return response


def _participation(daily, start, end):
    if not daily:
        return []
    start, end = start or min(daily), end or max(daily)
    days = (end - start).days + 1
    # Use daily counts for short ranges and group by whole weeks for longer
    # ranges. Keep the final partial interval and all intervals with zero.
    step = 1 if days <= 28 else 7 * ((days + 195) // 196)
    counts = Counter()
    for day, count in daily.items():
        counts[(day - start).days // step] += count
    return [
        {
            'from': (start + timedelta(days=offset)).isoformat(),
            'to': (start + timedelta(days=min(offset + step, days) - 1)).isoformat(),
            'count': counts[index],
        }
        for index, offset in enumerate(range(0, days, step))
    ]


def _report(rows, start, end, page, per_page):
    daily = Counter()
    eligible = Counter()
    distributions = {key: Counter() for key in OPTIONS}
    answered = Counter()
    submissions = []
    total = 0

    for item in rows:
        total += 1
        daily[item.created_at.astimezone(timezone.utc).date()] += 1
        if (page - 1) * per_page < total <= page * per_page:
            submissions.append({'id': str(item.pk), **_serialize(item)})

        answers = item.answers or {}
        legacy_scores = {key: _answer(answers, key) for key in LEGACY_RATINGS}
        legacy = any(type(value) is int and value in OPTIONS[key] for key, value in legacy_scores.items())
        for key in QUESTION_KEYS:
            value = item.name if key == 'name' else _answer(answers, key)
            if key in RATING_SCALES:
                valid = type(value) is int and value in OPTIONS[key]
            elif key in CATEGORIES:
                valid = isinstance(value, str) and value in OPTIONS[key]
            else:
                valid = bool(_text_value(value))

            # A genuine saved answer proves applicability, even for a legacy
            # video comment saved before its follow-up question existed.
            if key in LEGACY_RATINGS and not legacy:
                continue
            if key in GATES and not valid:
                parent, choices = GATES[key]
                if answers.get(parent) not in choices:
                    continue
            eligible[key] += 1
            if valid:
                answered[key] += 1
                if key in distributions:
                    distributions[key][value] += 1

    questions = {}
    for key in QUESTION_KEYS:
        question = {
            'answered': answered[key],
            'unanswered': eligible[key] - answered[key],
            'outside_base': total - eligible[key],
            'eligible': eligible[key],
        }
        if key in OPTIONS:
            question['options'] = [
                {'value': value, 'count': distributions[key][value]} for value in OPTIONS[key]
            ]
        if key in RATING_SCALES:
            question['average'] = (
                round(sum(value * count for value, count in distributions[key].items()) / answered[key], 2)
                if answered[key] else None
            )
        questions[key] = question

    today = django_timezone.now().astimezone(timezone.utc).date()
    return {
        'total': total,
        'answered_slots': sum(answered[key] for key in CURRENT_QUESTIONS),
        'eligible_slots': sum(eligible[key] for key in CURRENT_QUESTIONS),
        'last_7_days': sum(count for day, count in daily.items() if 0 <= (today - day).days < 7),
        'last_30_days': sum(count for day, count in daily.items() if 0 <= (today - day).days < 30),
        'trend': _participation(daily, start, end),
        'questions': questions,
        'responses': submissions,
    }


def _text_report(rows, field, query, page, per_page):
    total = 0
    results = []
    fields = (field,) if field else TEXT_FIELDS
    needle = query.strip().casefold()
    for item in rows:
        answers = item.answers or {}
        comments = {
            key: value for key in fields
            if (value := _text_value(answers.get(key))) and needle in value.casefold()
        }
        if not comments:
            continue
        total += 1
        if (page - 1) * per_page < total <= page * per_page:
            results.append({
                'id': str(item.pk), 'created_at': item.created_at.isoformat(),
                'persona': answers.get('persona'), 'comments': comments,
            })
    return {'total': total, 'responses': results}


@never_cache
@require_http_methods(['GET'])
def admin_prelaunch_feedback(request):
    if not _core_admin(request):
        return _deny(request)
    try:
        filtered, start, end = _cohort(request.GET)
        text_field = request.GET.get('question', '')
        query = request.GET.get('q', '')
        if request.GET.get('view') == 'text':
            if text_field and text_field not in TEXT_FIELDS:
                raise ValueError('Choose a valid text question.')
            if len(query) > 200:
                raise ValueError('Search terms can contain up to 200 characters.')
    except ValueError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=400)

    rows = filtered.iterator(chunk_size=200)
    if request.GET.get('format') == 'csv':
        return _csv_response(rows)

    try:
        page = max(1, int(request.GET.get('page', '1')))
    except ValueError:
        page = 1
    per_page = 50
    if request.GET.get('view') == 'text':
        report = _text_report(rows, text_field, query, page, per_page)
    else:
        report = _report(rows, start, end, page, per_page)
        # Keep the previous view usable while cached Workspace assets refresh.
        questions = report['questions']
        report.update({
            'filtered_total': report['total'],
            'persona_counts': {
                **{option['value']: option['count'] for option in questions['persona']['options']},
                'unspecified': questions['persona']['unanswered'],
            },
            'averages': {key: questions[key]['average'] for key in RATING_SCALES},
            'metric_counts': {key: questions[key]['answered'] for key in RATING_SCALES},
        })
    return JsonResponse({'ok': True, 'page': page, 'per_page': per_page, **report})
