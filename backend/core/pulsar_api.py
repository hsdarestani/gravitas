import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .models import ContentItem
from .pulsar import PLATFORM_CONTEXT, PulsarError, complete, configured


def _links(message):
    text = str(message or '').lower()
    rows = []
    if any(word in text for word in ('topic', 'essay', 'source', 'simulation')):
        rows.append({'label': 'Topics', 'href': '/topics.html'})
    if any(word in text for word in ('learn', 'course', 'certificate', 'library')):
        rows.append({'label': 'Learning', 'href': '/learn.html'})
    if any(word in text for word in ('account', 'sign', 'login', 'register', 'workspace')):
        rows.append({'label': 'Create an account', 'href': '/signup'})
        rows.append({'label': 'Sign in', 'href': '/login'})
    if any(word in text for word in ('community', 'join', 'discussion')):
        rows.append({'label': 'Community', 'href': '/community.html'})
    return rows[:3]


@csrf_exempt
@require_POST
def public_pulsar_ask(request):
    try:
        data = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        data = {}
    message = str(data.get('message') or '').strip()[:4000]
    if not message:
        return JsonResponse({'ok': False, 'error': 'message_required'}, status=400)

    topics = ContentItem.objects.filter(
        status=ContentItem.Status.PUBLISHED,
    ).order_by('-published_at', '-created_at')[:30]
    public_context = '\n'.join(
        f'- {item.kind}: {item.title} — {item.summary[:420]}'
        for item in topics
    )
    page = str(data.get('page') or '')[:250]
    history = data.get('history') if isinstance(data.get('history'), list) else []
    recent = []
    for turn in history[-6:]:
        if not isinstance(turn, dict):
            continue
        role = str(turn.get('role') or '')[:20]
        content = str(turn.get('content') or '').strip()[:700]
        if role and content:
            recent.append(f'{role}: {content}')

    if configured():
        try:
            answer = complete(
                system=(
                    'You are Plusar, the Gravitas+ assistant on the public website. '
                    'Answer in the language the visitor used. Be concise and useful. '
                    'Use the supplied platform/content context when making claims about Gravitas+. '
                    'If the context does not establish something, say so instead of inventing it. '
                    'Never claim access to a visitor account or private workspace from this public chat.\n\n'
                    + PLATFORM_CONTEXT
                ),
                user=(
                    f'Current page: {page or "/"}\n'
                    + ('Recent conversation:\n' + '\n'.join(recent) + '\n' if recent else '')
                    + f'Published Gravitas+ content:\n{public_context}\n\n'
                    + f'Visitor question: {message}'
                ),
            )
            return JsonResponse({
                'ok': True,
                'reply': answer,
                'links': _links(message),
                'provider': 'cloudflare-workers-ai',
            })
        except PulsarError:
            pass

    fallback = (
        'Plusar is temporarily unable to reach the managed AI service. '
        'You can still browse Topics, Learning and the Community from the main navigation.'
    )
    return JsonResponse({'ok': True, 'reply': fallback, 'links': _links(message), 'provider': 'fallback'})
