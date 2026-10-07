import json

from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_http_methods

from .pulsar_runtime.errors import PulsarPermissionError
from .pulsar_runtime.scheduler import cancel_scheduled_run, schedule_reminder
from .pulsar_runtime.skills import SkillRegistry


def _run_json(run):
    state = run.state if isinstance(run.state, dict) else {}
    reminder = state.get('reminder') if isinstance(state.get('reminder'), dict) else {}
    return {
        'run_id': run.run_id,
        'status': run.status,
        'surface': run.surface,
        'skill': run.skill,
        'thread_key': run.thread.thread_key if run.thread_id else None,
        'title': str(reminder.get('title') or 'Pulsar reminder'),
        'message': str(reminder.get('message') or run.input_text or ''),
        'wait_until': run.wait_until.isoformat() if run.wait_until else None,
        'created_at': run.created_at.isoformat(),
        'updated_at': run.updated_at.isoformat(),
    }


@require_http_methods(['GET', 'POST'])
def pulsar_reminders(request):
    if not request.user.is_authenticated:
        return JsonResponse(
            {'ok': False, 'error': 'authentication_required'},
            status=401,
        )

    from .models import PulsarRun

    if request.method == 'GET':
        rows = (
            PulsarRun.objects
            .filter(
                user=request.user,
                status=PulsarRun.Status.WAITING_TIME,
            )
            .select_related('thread')
            .order_by('wait_until', 'id')[:100]
        )
        return JsonResponse({
            'ok': True,
            'reminders': [_run_json(row) for row in rows],
        })

    try:
        data = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}

    message = str(data.get('message') or '').strip()
    due_raw = str(data.get('due_at') or '').strip()
    due_at = parse_datetime(due_raw)
    if not message:
        return JsonResponse(
            {'ok': False, 'error': 'message_required'},
            status=400,
        )
    if due_at is None:
        return JsonResponse(
            {'ok': False, 'error': 'valid_due_at_required'},
            status=400,
        )
    if timezone.is_naive(due_at):
        due_at = timezone.make_aware(
            due_at,
            timezone.get_current_timezone(),
        )

    surface = str(data.get('surface') or 'core').strip().lower()[:32]
    requested_skill = str(data.get('skill') or '').strip().lower()
    try:
        skill_def = SkillRegistry().resolve(
            name=requested_skill or None,
            surface=surface,
        )
        run = schedule_reminder(
            request.user,
            message=message,
            due_at=due_at,
            title=str(data.get('title') or 'Pulsar reminder'),
            thread_key=str(data.get('thread_id') or 'primary')[:160],
            surface=surface,
            skill=skill_def.name,
            metadata=(
                data.get('metadata')
                if isinstance(data.get('metadata'), dict)
                else {}
            ),
        )
    except (ValueError, PulsarPermissionError) as exc:
        status = 403 if isinstance(exc, PulsarPermissionError) else 400
        return JsonResponse(
            {'ok': False, 'error': str(exc)},
            status=status,
        )

    run = PulsarRun.objects.select_related('thread').get(pk=run.pk)
    return JsonResponse(
        {'ok': True, 'reminder': _run_json(run)},
        status=201,
    )


@require_http_methods(['DELETE', 'POST'])
def pulsar_reminder_detail(request, run_id):
    if not request.user.is_authenticated:
        return JsonResponse(
            {'ok': False, 'error': 'authentication_required'},
            status=401,
        )
    run = cancel_scheduled_run(request.user, run_id)
    if not run:
        return JsonResponse(
            {'ok': False, 'error': 'scheduled_run_not_found'},
            status=404,
        )
    return JsonResponse({
        'ok': True,
        'run_id': run.run_id,
        'status': run.status,
    })
