import json

from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .pulsar_runtime.agent import PulsarAgent
from .pulsar_runtime.errors import PulsarError, PulsarPermissionError


@require_POST
def pulsar_agent_run(request):
    if not request.user.is_authenticated:
        return JsonResponse(
            {'ok': False, 'error': 'authentication_required'},
            status=401,
        )
    try:
        data = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}

    confirm = data.get('confirm') is True
    cancel = data.get('cancel') is True
    message = str(data.get('message') or '').strip()
    if not message and not confirm and not cancel:
        return JsonResponse(
            {'ok': False, 'error': 'message_required'},
            status=400,
        )

    metadata = data.get('metadata')
    if not isinstance(metadata, dict):
        metadata = {}

    try:
        outcome = PulsarAgent().run(
            request.user,
            message,
            surface=str(data.get('surface') or 'core')[:32],
            skill=str(data.get('skill') or '').strip() or None,
            thread_id=str(data.get('thread_id') or 'primary')[:160],
            metadata=metadata,
            confirm=confirm,
            cancel=cancel,
        )
    except PulsarPermissionError as exc:
        return JsonResponse(
            {'ok': False, 'error': str(exc)},
            status=403,
        )
    except PulsarError as exc:
        return JsonResponse(
            {'ok': False, 'error': str(exc)},
            status=502,
        )

    return JsonResponse({
        'ok': True,
        'status': outcome.status,
        'reply': outcome.reply,
        'run_id': outcome.run_id,
        'tool': outcome.tool,
        'tool_args': outcome.tool_args,
        'sources': outcome.sources,
        'data': outcome.data,
        'approval_required': outcome.approval_required,
    })
