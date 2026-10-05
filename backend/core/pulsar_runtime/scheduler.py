from uuid import uuid4

from django.db import transaction
from django.utils import timezone

from .continuity import get_thread, normalize_thread_key
from .errors import PulsarPermissionError
from .profiles import assert_skill_allowed


def schedule_reminder(
    user,
    *,
    message,
    due_at,
    title='Pulsar reminder',
    thread_key='primary',
    surface='core',
    skill='general',
    metadata=None,
):
    if not user or not getattr(user, 'is_authenticated', False):
        raise PulsarPermissionError('pulsar_authentication_required')
    if skill not in {'public', 'general'}:
        assert_skill_allowed(user, skill)
    if due_at is None:
        raise ValueError('reminder_due_at_required')
    if timezone.is_naive(due_at):
        due_at = timezone.make_aware(due_at, timezone.get_current_timezone())
    if due_at <= timezone.now():
        raise ValueError('reminder_due_at_must_be_future')

    message = ' '.join(str(message or '').split()).strip()
    if not message:
        raise ValueError('reminder_message_required')
    title = ' '.join(str(title or 'Pulsar reminder').split()).strip()[:300]

    from core.models import PulsarRun

    thread = get_thread(
        user,
        normalize_thread_key(thread_key),
        surface=surface,
        skill=skill,
    )
    state = dict(metadata or {})
    state['reminder'] = {
        'title': title or 'Pulsar reminder',
        'message': message[:12000],
    }
    run = PulsarRun.objects.create(
        thread=thread,
        user=user,
        run_id=uuid4().hex,
        surface=str(surface or 'core')[:32],
        skill=str(skill or 'general')[:40],
        status=PulsarRun.Status.WAITING_TIME,
        input_text=message[:16000],
        state=state,
        wait_until=due_at,
    )
    thread.status = thread.Status.WAITING
    thread.save(update_fields=['status', 'updated_at'])
    return run


def cancel_scheduled_run(user, run_id):
    if not user or not getattr(user, 'is_authenticated', False):
        raise PulsarPermissionError('pulsar_authentication_required')
    from core.models import PulsarRun

    with transaction.atomic():
        run = (
            PulsarRun.objects
            .select_for_update()
            .filter(
                run_id=str(run_id or ''),
                user=user,
                status__in=[
                    PulsarRun.Status.WAITING_TIME,
                    PulsarRun.Status.WAITING_USER,
                ],
            )
            .first()
        )
        if not run:
            return None
        run.status = PulsarRun.Status.CANCELLED
        run.wait_until = None
        run.save(update_fields=['status', 'wait_until', 'updated_at'])
        if not run.thread.runs.filter(
            status__in=[
                PulsarRun.Status.WAITING_TIME,
                PulsarRun.Status.WAITING_USER,
            ],
        ).exclude(pk=run.pk).exists():
            run.thread.status = run.thread.Status.ACTIVE
            run.thread.save(update_fields=['status', 'updated_at'])
        return run


def wake_due_runs(*, now=None, limit=100):
    """Wake due Pulsar waiting-time runs exactly once.

    Delivery is delegated to the existing Gravitas notification outbox so
    Pulsar does not create a second email/Telegram transport.
    """
    from core.models import PulsarRun
    from core.task_notifications import enqueue_pulsar_reminder

    now = now or timezone.now()
    limit = max(1, min(int(limit or 100), 1000))
    ids = list(
        PulsarRun.objects
        .filter(
            status=PulsarRun.Status.WAITING_TIME,
            wait_until__isnull=False,
            wait_until__lte=now,
        )
        .order_by('wait_until', 'id')
        .values_list('id', flat=True)[:limit]
    )

    awakened = 0
    notifications = 0
    for run_id in ids:
        with transaction.atomic():
            run = (
                PulsarRun.objects
                .select_for_update()
                .select_related('user', 'thread')
                .filter(
                    pk=run_id,
                    status=PulsarRun.Status.WAITING_TIME,
                    wait_until__lte=now,
                )
                .first()
            )
            if not run:
                continue

            notifications += enqueue_pulsar_reminder(run)
            run.status = PulsarRun.Status.COMPLETED
            run.output_text = 'scheduled_reminder_enqueued'
            run.wait_until = None
            state = dict(run.state or {})
            state['woke_at'] = now.isoformat()
            run.state = state
            run.save(update_fields=[
                'status',
                'output_text',
                'wait_until',
                'state',
                'updated_at',
            ])

            if not run.thread.runs.filter(
                status__in=[
                    PulsarRun.Status.WAITING_TIME,
                    PulsarRun.Status.WAITING_USER,
                ],
            ).exclude(pk=run.pk).exists():
                run.thread.status = run.thread.Status.ACTIVE
                run.thread.last_run_at = now
                run.thread.save(update_fields=[
                    'status',
                    'last_run_at',
                    'updated_at',
                ])
            awakened += 1

    return {
        'awakened': awakened,
        'notifications_queued': notifications,
    }
