import json
import re

from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .models import KnowledgeResource


def _terms(question):
    return {
        value.lower()
        for value in re.findall(r"[\w'-]{3,}", question, flags=re.UNICODE)
        if value.lower() not in {'about', 'from', 'have', 'that', 'these', 'this', 'what', 'when', 'where', 'which', 'with', 'your'}
    }


@require_POST
def assistant_ask(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    try:
        data = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        data = {}
    question = str(data.get('question') or '').strip()
    if not question:
        return JsonResponse({'ok': False, 'error': 'question_required'}, status=400)

    terms = _terms(question)
    resources = KnowledgeResource.objects.filter(
        Q(owner=request.user) | Q(workspace__owner=request.user) | Q(workspace__memberships__user=request.user),
        kind=KnowledgeResource.Kind.NOTE,
    ).distinct().order_by('-updated_at')[:250]
    ranked = []
    for resource in resources:
        haystack = f'{resource.title}\n{resource.body}'.lower()
        score = sum(3 if term in resource.title.lower() else 1 for term in terms if term in haystack)
        if score:
            ranked.append((score, resource))
    ranked.sort(key=lambda row: (-row[0], -row[1].updated_at.timestamp()))
    matches = [resource for _, resource in ranked[:6]]

    if not matches:
        return JsonResponse({
            'ok': True,
            'grounded': True,
            'answer': 'I could not find this in the pages you can access.',
            'sources': [],
        })

    excerpts = []
    for resource in matches[:3]:
        text = re.sub(r'\s+', ' ', resource.body or '').strip()
        excerpts.append(f'{resource.title}: {text[:280]}' if text else resource.title)
    return JsonResponse({
        'ok': True,
        'grounded': True,
        'answer': 'I found the following in your pages:\n\n' + '\n\n'.join(excerpts),
        'sources': [{'id': str(resource.pk), 'title': resource.title} for resource in matches],
    })
