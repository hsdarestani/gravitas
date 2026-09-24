import json

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .layer_access import record_activity
from .layer_models import ActivityEvent
from .models import ContentItem, TopicProgress


ACTIONS = {
    'video': 'video_viewed',
    'comment': 'commented',
    'vote': 'voted',
    'simulation': 'simulation_played',
}


def _topic_objects(data, plural_key, singular_key):
    rows = data.get(plural_key)
    if isinstance(rows, list):
        return [row for row in rows if isinstance(row, dict)]
    row = data.get(singular_key)
    return [row] if isinstance(row, dict) else []


def topic_applicability(topic):
    data = topic.topic_data if isinstance(topic.topic_data, dict) else {}
    videos = _topic_objects(data, 'videos', 'video')
    simulations = _topic_objects(data, 'simulations', 'simulation')
    viewpoints = data.get('viewpoints') if isinstance(data.get('viewpoints'), dict) else {}
    poll_options = viewpoints.get('poll_options') if isinstance(viewpoints.get('poll_options'), list) else []
    discussion = data.get('discussion_enabled')
    return {
        'video': any(
            video.get('youtube_url')
            or video.get('self_hosted_url')
            or video.get('source_type') in {'youtube', 'self_hosted'}
            for video in videos
        ),
        'comment': discussion is not False,
        'vote': bool([item for item in poll_options if item]),
        'simulation': any(
            simulation.get('code')
            or simulation.get('builtin')
            or simulation.get('native')
            or simulation.get('type')
            or simulation.get('enabled')
            for simulation in simulations
        ),
    }


def progress_json(topic, progress=None):
    applicable = topic_applicability(topic)
    done = {
        'video': bool(progress and progress.video_viewed),
        'comment': bool(progress and progress.commented),
        'vote': bool(progress and progress.voted),
        'simulation': bool(progress and progress.simulation_played),
    }
    total = sum(1 for key, enabled in applicable.items() if enabled)
    done_count = sum(1 for key, enabled in applicable.items() if enabled and done[key])
    return {
        'topic_id': topic.pk,
        'slug': topic.slug,
        'title': topic.title,
        'url': f'/topic.html?slug={topic.slug}',
        'applicable': applicable,
        'done': done,
        'done_count': done_count,
        'total': total,
        'progress_percent': 0 if total == 0 else round((done_count / total) * 100, 1),
        'completed': bool(total and done_count >= total),
        'updated_at': progress.updated_at.isoformat() if progress else None,
    }


def mark_topic_progress_by_slug(user, slug, action):
    topic = ContentItem.objects.filter(
        slug=slug,
        kind=ContentItem.Kind.TOPIC,
        status=ContentItem.Status.PUBLISHED,
    ).first()
    return mark_topic_progress(user, topic, action) if topic else None


def mark_topic_progress(user, topic, action):
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    field = ACTIONS.get(action)
    if not field:
        return None
    applicable = topic_applicability(topic)
    if not applicable.get(action):
        return None
    progress, _ = TopicProgress.objects.get_or_create(user=user, topic=topic)
    if not getattr(progress, field):
        setattr(progress, field, True)
        progress.save(update_fields=[field, 'updated_at'])
        record_activity(
            layer=ActivityEvent.Layer.DASHBOARD,
            action=f'topic.{action}',
            actor=user,
            subject_user=user,
            object_type='topic',
            object_id=topic.pk,
            detail={'slug': topic.slug, 'title': topic.title},
        )
    return progress


@require_http_methods(['GET', 'POST'])
def topic_progress(request, slug):
    topic = ContentItem.objects.filter(
        slug=slug,
        kind=ContentItem.Kind.TOPIC,
        status=ContentItem.Status.PUBLISHED,
    ).first()
    if not topic:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)

    existing = None
    if request.user.is_authenticated:
        existing = TopicProgress.objects.filter(user=request.user, topic=topic).first()

    if request.method == 'GET':
        return JsonResponse({
            'ok': True,
            'authenticated': bool(request.user.is_authenticated),
            'progress': progress_json(topic, existing),
        })

    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    try:
        payload = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        payload = {}
    action = str(payload.get('action') or '').strip().lower()
    if action not in ACTIONS:
        return JsonResponse({'ok': False, 'error': 'invalid_action'}, status=400)
    if not topic_applicability(topic).get(action):
        return JsonResponse({'ok': False, 'error': 'component_not_applicable'}, status=409)
    progress = mark_topic_progress(request.user, topic, action)
    return JsonResponse({'ok': True, 'progress': progress_json(topic, progress)})
