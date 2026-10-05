import json

from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .pulsar import PLATFORM_CONTEXT, PulsarError, PulsarPermissionError, configured, run_text
from .pulsar_runtime.context import PulsarContextEngine


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

    surface = str(data.get('surface') or 'research').strip().lower()
    project_id = data.get('project_id')
    skill = 'project_task' if surface in {'core', 'projects', 'project'} else 'research'
    surface = 'core' if skill == 'project_task' else 'research'

    try:
        package = PulsarContextEngine().workspace(
            request.user,
            question,
            project_id=project_id,
            skill=skill,
        )
    except PulsarPermissionError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=403)

    if configured():
        try:
            result = run_text(
                system=(
                    'You are Pulsar inside the authenticated Gravitas+ workspace. '
                    'Pulsar is a multi-capability learning and research assistant. '
                    'Answer in the same language as the user. Be concise, precise and useful. '
                    'For claims about the user\'s own work, use only the supplied ACL-checked context. '
                    'Do not invent notes, projects, files, tasks or results. '
                    'If the context is insufficient, say that clearly. '
                    'Mention source titles naturally when they support the answer.\n\n'
                    + PLATFORM_CONTEXT
                ),
                user=(
                    f'Question: {question}\n\n'
                    + (
                        'ACL-checked Gravitas context:\n' + package.text
                        if package.text
                        else 'ACL-checked Gravitas context: no matching material was found.'
                    )
                ),
                max_tokens=1200,
                temperature=0.2,
                surface=surface,
                skill=skill,
                operation='synthesis' if package.sources else 'answer',
                user_id=request.user.pk,
                workspace_id=str(data.get('workspace_id') or '')[:120] or None,
                thread_id=str(data.get('thread_id') or 'primary')[:160],
                actor=request.user,
                metadata={
                    'source_count': len(package.sources),
                    'project_id': package.metadata.get('project_id'),
                    'turn_input': question,
                },
            )
            return JsonResponse({
                'ok': True,
                'grounded': True,
                'answer': result.text,
                'sources': package.sources,
                'provider': result.provider,
                'run_id': result.run_id,
                'skill': result.skill,
                'model_tier': result.model_tier,
            })
        except PulsarPermissionError as exc:
            return JsonResponse({'ok': False, 'error': str(exc)}, status=403)
        except PulsarError:
            pass

    if not package.text:
        return JsonResponse({
            'ok': True,
            'grounded': True,
            'answer': (
                'I could not find this in the Gravitas material you are allowed to access, '
                'and the managed AI service is temporarily unavailable.'
            ),
            'sources': [],
            'provider': 'fallback',
        })

    return JsonResponse({
        'ok': True,
        'grounded': True,
        'answer': 'I found the following in your accessible Gravitas context:\n\n' + package.text[:2400],
        'sources': package.sources,
        'provider': 'fallback',
    })
