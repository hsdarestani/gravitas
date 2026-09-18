import json
import re

from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .models import KnowledgeResource
from .pulsar import PLATFORM_CONTEXT, PulsarError, complete, configured


def _terms(question):
    return {
        value.lower()
        for value in re.findall(r"[\w'-]{3,}", question, flags=re.UNICODE)
        if value.lower() not in {
            'about', 'from', 'have', 'that', 'these', 'this',
            'what', 'when', 'where', 'which', 'with', 'your',
        }
    }


def _accessible_notes(user, question):
    terms = _terms(question)
    resources = KnowledgeResource.objects.filter(
        Q(owner=user)
        | Q(workspace__owner=user)
        | Q(workspace__memberships__user=user),
        kind=KnowledgeResource.Kind.NOTE,
    ).distinct().order_by('-updated_at')[:250]

    ranked = []
    for resource in resources:
        haystack = f'{resource.title}\n{resource.body}'.lower()
        score = sum(
            3 if term in resource.title.lower() else 1
            for term in terms
            if term in haystack
        )
        if score:
            ranked.append((score, resource))
    ranked.sort(key=lambda row: (-row[0], -row[1].updated_at.timestamp()))
    return [resource for _, resource in ranked[:8]]


@require_POST
def assistant_ask(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    try:
        data = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        data = {}
    question = str(data.get('question') or '').strip()[:4000]
    if not question:
        return JsonResponse({'ok': False, 'error': 'question_required'}, status=400)

    matches = _accessible_notes(request.user, question)
    sources = [
        {'id': str(resource.pk), 'title': resource.title}
        for resource in matches
    ]
    context_rows = []
    for resource in matches:
        text = re.sub(r'\s+', ' ', resource.body or '').strip()
        context_rows.append(
            f'[{resource.title}] {text[:1800]}' if text else f'[{resource.title}]'
        )
    private_context = '\n\n'.join(context_rows)

    if configured():
        try:
            answer = complete(
                system=(
                    'You are Plusar inside the authenticated Gravitas+ workspace. '
                    'Answer in the same language as the user. Be concise, precise and useful. '
                    'For claims about the user\'s own work, use only the private context supplied below; '
                    'do not invent notes, projects, files or results. If the private context is insufficient, '
                    'say that clearly. You may explain documented Gravitas+ platform capabilities from the '
                    'platform context. Mention source titles naturally when private notes support the answer.\n\n'
                    + PLATFORM_CONTEXT
                ),
                user=(
                    f'Question: {question}\n\n'
                    + (
                        'Accessible private note context:\n' + private_context
                        if private_context
                        else 'Accessible private note context: no matching notes were found.'
                    )
                ),
                max_tokens=1100,
            )
            return JsonResponse({
                'ok': True,
                'grounded': True,
                'answer': answer,
                'sources': sources,
                'provider': 'cloudflare-workers-ai',
            })
        except PulsarError:
            pass

    if not matches:
        return JsonResponse({
            'ok': True,
            'grounded': True,
            'answer': (
                'I could not find this in the workspace pages you can access, '
                'and the managed AI service is temporarily unavailable.'
            ),
            'sources': [],
            'provider': 'fallback',
        })

    excerpts = []
    for resource in matches[:3]:
        text = re.sub(r'\s+', ' ', resource.body or '').strip()
        excerpts.append(f'{resource.title}: {text[:280]}' if text else resource.title)
    return JsonResponse({
        'ok': True,
        'grounded': True,
        'answer': 'I found the following in your pages:\n\n' + '\n\n'.join(excerpts),
        'sources': sources,
        'provider': 'fallback',
    })
