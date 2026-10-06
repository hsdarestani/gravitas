from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .models import PulsarRun
from .pulsar_runtime import default_harness
from .pulsar_runtime.profiles import snapshot


def _run_row(run):
    state = run.state if isinstance(run.state, dict) else {}
    return {
        'run_id': run.run_id,
        'thread_id': run.thread.thread_key,
        'surface': run.surface,
        'skill': run.skill,
        'status': run.status,
        'provider': run.provider,
        'model': run.model_name,
        'model_tier': state.get('model_tier'),
        'decision_source': state.get('decision_source'),
        'latency_ms': state.get('latency_ms'),
        'input_tokens': state.get('input_tokens'),
        'output_tokens': state.get('output_tokens'),
        'estimated_cost_usd': state.get('estimated_cost_usd'),
        'created_at': run.created_at.isoformat(),
        'updated_at': run.updated_at.isoformat(),
    }


@require_GET
def pulsar_runtime_status(request):
    if not request.user.is_authenticated:
        return JsonResponse(
            {'ok': False, 'error': 'authentication_required'},
            status=401,
        )

    profile = snapshot(request.user)
    allowed = set(profile.get('allowed_skills') or [])
    skills = [
        {
            'name': skill.name,
            'surfaces': list(skill.surfaces),
            'capabilities': list(skill.capabilities),
            'risk_ceiling': skill.risk_ceiling,
            'requires_auth': skill.requires_auth,
            'enabled': (not skill.requires_auth) or skill.name in allowed,
        }
        for skill in default_harness.skills.all()
    ]
    recent_runs = (
        PulsarRun.objects
        .filter(user=request.user)
        .select_related('thread')
        .order_by('-created_at')[:20]
    )

    return JsonResponse({
        'ok': True,
        'runtime': {
            'configured': default_harness.configured(),
            'providers': default_harness.models.status(),
            'decision': default_harness.decisions.status(),
            'skills': skills,
        },
        'recent_runs': [_run_row(run) for run in recent_runs],
        'week1_contract': {
            'shared_harness': True,
            'website_surface': 'public',
            'telegram_surface': 'telegram',
            'authenticated_default_thread': 'primary',
        },
    })
