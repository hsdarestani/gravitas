import json
from uuid import uuid4

from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .models import PulsarRun, PulsarTurn
from .pulsar import PLATFORM_CONTEXT, PulsarError, PulsarPermissionError, configured, run_text
from .pulsar_runtime.context import PulsarContextEngine
from .pulsar_runtime.memory import (
    add_turn,
    continuity_context,
    finish_run,
    remember_exchange,
    resolve_thread,
    start_run,
)


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
    scope_type = 'project' if project_id not in (None, '') else 'global'
    scope_key = str(project_id or '')

    try:
        thread = resolve_thread(
            request.user,
            thread_id=data.get('thread_id'),
            surface=surface,
            resource_scope={'project_id': project_id} if project_id not in (None, '') else {},
            resume_recent=not bool(data.get('thread_id')),
        )
        continuity = continuity_context(
            thread,
            request.user,
            question,
            scope_type=scope_type,
            scope_key=scope_key,
        )
        package = PulsarContextEngine().workspace(
            request.user,
            question,
            project_id=project_id,
            skill=skill,
        )
    except PulsarPermissionError as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=403)

    add_turn(
        thread,
        role=PulsarTurn.Role.USER,
        surface=surface,
        skill=skill,
        content=question,
        metadata={'project_id': project_id},
    )

    if configured():
        try:
            result = run_text(
                system=(
                    'You are Pulsar inside the authenticated Gravitas+ workspace. '
                    'Pulsar is a multi-capability learning and research assistant. '
                    'Answer in the same language as the user. Be concise, precise and useful. '
                    'For claims about the user\'s own work, use only the supplied ACL-checked source-of-truth context. '
                    'Thread history and long-term memory are continuity aids, not authoritative facts. '
                    'If memory conflicts with ACL-checked context, the source-of-truth context wins. '
                    'Do not invent notes, projects, files, tasks or results. '
                    'If the source-of-truth context is insufficient, say that clearly. '
                    'Mention source titles naturally when they support the answer.\n\n'
                    + PLATFORM_CONTEXT
                ),
                user=(
                    (f'Continuity context:\n{continuity}\n\n' if continuity else '')
                    + f'Current question: {question}\n\n'
                    + (
                        'ACL-checked Gravitas source-of-truth context:\n' + package.text
                        if package.text
                        else 'ACL-checked Gravitas source-of-truth context: no matching material was found.'
                    )
                ),
                max_tokens=1200,
                temperature=0.2,
                surface=surface,
                skill=skill,
                operation='synthesis' if package.sources else 'answer',
                user_id=request.user.pk,
                workspace_id=str(data.get('workspace_id') or '')[:120] or None,
                thread_id=str(thread.public_id),
                actor=request.user,
                metadata={
                    'source_count': len(package.sources),
                    'project_id': package.metadata.get('project_id'),
                    'continuity': bool(continuity),
                },
            )
            start_run(
                request.user,
                thread,
                run_id=result.run_id,
                surface=surface,
                skill=result.skill,
                state={'source_count': len(package.sources), 'project_id': project_id},
            )
            finish_run(
                result.run_id,
                status=PulsarRun.Status.COMPLETED,
                result_summary=result.text,
            )
            add_turn(
                thread,
                role=PulsarTurn.Role.ASSISTANT,
                surface=surface,
                skill=result.skill,
                run_id=result.run_id,
                content=result.text,
                metadata={'source_count': len(package.sources)},
            )
            remember_exchange(
                request.user,
                thread,
                question=question,
                answer=result.text,
                surface=surface,
                skill=result.skill,
                run_id=result.run_id,
            )
            return JsonResponse({
                'ok': True,
                'grounded': True,
                'answer': result.text,
                'sources': package.sources,
                'provider': result.provider,
                'run_id': result.run_id,
                'thread_id': str(thread.public_id),
                'skill': result.skill,
                'model_tier': result.model_tier,
            })
        except PulsarPermissionError as exc:
            return JsonResponse({'ok': False, 'error': str(exc)}, status=403)
        except PulsarError:
            pass

    fallback_run_id = 'fallback-' + uuid4().hex
    if not package.text:
        answer = (
            'I could not find this in the Gravitas material you are allowed to access, '
            'and the managed AI service is temporarily unavailable.'
        )
        sources = []
    else:
        answer = 'I found the following in your accessible Gravitas context:\n\n' + package.text[:2400]
        sources = package.sources

    add_turn(
        thread,
        role=PulsarTurn.Role.ASSISTANT,
        surface=surface,
        skill=skill,
        run_id=fallback_run_id,
        content=answer,
        metadata={'fallback': True, 'source_count': len(sources)},
    )
    remember_exchange(
        request.user,
        thread,
        question=question,
        answer=answer,
        surface=surface,
        skill=skill,
        run_id=fallback_run_id,
    )
    return JsonResponse({
        'ok': True,
        'grounded': True,
        'answer': answer,
        'sources': sources,
        'provider': 'fallback',
        'run_id': fallback_run_id,
        'thread_id': str(thread.public_id),
        'skill': skill,
    })
