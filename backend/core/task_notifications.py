import hmac
import html
import json
import logging
import secrets
import uuid
from datetime import timedelta

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .operating_models import (
    OperatingTask,
    TaskNotificationOutbox,
    TaskNotificationPreference,
    WorkStatus,
)

logger = logging.getLogger(__name__)
User = get_user_model()

FIELD_LABELS = {
    'title': 'Title',
    'description': 'Description',
    'owner': 'Owner',
    'priority': 'Priority',
    'status': 'Status',
    'due_date': 'Due date',
    'definition_of_done': 'Definition of done',
    'blocked_reason': 'Blocked reason',
    'milestone_id': 'Milestone',
    'work_package_id': 'Work package',
    'project_id': 'Project',
    'meeting_id': 'Meeting',
    'dependency_id': 'Dependency',
}


def _user_name(user):
    return user.get_full_name() or user.first_name or user.email or user.get_username()


def _task_url(task_id=None):
    base = settings.PUBLIC_BASE_URL.rstrip('/')
    return f'{base}/workspace/core/tasks' + (f'?task={task_id}' if task_id else '')


def _display(value):
    if isinstance(value, dict):
        return value.get('name') or value.get('email') or value.get('title') or str(value.get('id') or '')
    if value is None or value == '':
        return 'None'
    if isinstance(value, bool):
        return 'Yes' if value else 'No'
    text = str(value)
    return text if len(text) <= 160 else text[:157] + '...'


def _change_lines(detail):
    changes = detail.get('changes') if isinstance(detail, dict) else {}
    if not isinstance(changes, dict):
        return []
    lines = []
    for field, change in changes.items():
        if not isinstance(change, dict):
            continue
        label = FIELD_LABELS.get(field, field.replace('_', ' ').title())
        before, after = change.get('from'), change.get('to')
        if field in {'description', 'definition_of_done', 'blocked_reason'}:
            lines.append(f'{label} updated')
        else:
            lines.append(f'{label}: {_display(before)} → {_display(after)}')
    return lines


def _event_copy(task, action, actor, detail):
    actor_name = _user_name(actor) if actor else 'Gravitas+'
    title = task.title
    link = _task_url(task.pk)

    if action == 'task.created':
        subject = f'New task assigned: {title}'
        intro = f'{actor_name} created a task assigned to you.'
        lines = []
    elif action == 'task.deleted':
        subject = f'Task deleted: {title}'
        intro = f'{actor_name} deleted this task.'
        lines = []
        link = _task_url()
    elif action == 'task.updated':
        lines = _change_lines(detail or {})
        if not lines:
            return None
        subject = f'Task updated: {title}'
        intro = f'{actor_name} updated your task.'
    elif action == 'task.moved':
        old = (detail or {}).get('from_status')
        new = (detail or {}).get('to_status')
        if old == new:
            return None
        subject = f'Task status changed: {title}'
        intro = f'{actor_name} changed the task status.'
        lines = [f'Status: {_display(old)} → {_display(new)}']
    elif action.startswith('task.checklist_item_'):
        subject = f'Checklist changed: {title}'
        item = (detail or {}).get('checklist_item_title') or ''
        changes = (detail or {}).get('changes') or {}
        if action == 'task.checklist_item_added':
            intro = f'{actor_name} added a checklist item.'
        elif action == 'task.checklist_item_deleted':
            intro = f'{actor_name} removed a checklist item.'
        elif action == 'task.checklist_item_completed':
            intro = f'{actor_name} completed a checklist item.'
        elif action == 'task.checklist_item_reopened':
            intro = f'{actor_name} reopened a checklist item.'
        else:
            intro = f'{actor_name} updated a checklist item.'
        lines = [item] if item else []
        if not item and isinstance(changes, dict) and 'title' in changes:
            lines.append(_display(changes['title'].get('to')))
    elif action == 'task.comment_added':
        subject = f'New comment on task: {title}'
        intro = f'{actor_name} added a comment.'
        snippet = str((detail or {}).get('comment_preview') or '').strip()
        lines = [snippet] if snippet else []
    elif action == 'task.attachment_added':
        subject = f'New attachment on task: {title}'
        intro = f'{actor_name} attached a file.'
        name = str((detail or {}).get('name') or '').strip()
        lines = [name] if name else []
    else:
        subject = f'Task changed: {title}'
        intro = f'{actor_name} changed your task.'
        lines = []

    due = task.due_date.isoformat() if task.due_date else None
    body_lines = [intro, '', f'Task: {title}']
    body_lines.extend(lines)
    if due:
        body_lines.append(f'Due: {due}')
    body_lines.extend(['', f'Open task: {link}'])
    return subject, '\n'.join(body_lines), {'url': link, 'changes': detail or {}}


def _recipient_ids(task, action, actor, detail):
    ids = {task.owner_id}
    if action == 'task.updated':
        changes = (detail or {}).get('changes') or {}
        owner_change = changes.get('owner') if isinstance(changes, dict) else None
        if isinstance(owner_change, dict):
            old = owner_change.get('from')
            if isinstance(old, dict) and old.get('id'):
                ids.add(int(old['id']))
    if actor and actor.pk in ids:
        ids.remove(actor.pk)
    return {pk for pk in ids if pk}


def _preference(user):
    pref, _ = TaskNotificationPreference.objects.get_or_create(user=user)
    return pref


def _enqueue_for_user(user, task, event_key, event_type, subject, body, payload, *, reminder=False):
    if not user or not user.is_active:
        return 0
    pref = _preference(user)
    if reminder:
        if not pref.due_reminders_enabled:
            return 0
    elif not pref.task_changes_enabled:
        return 0

    created = 0
    if pref.email_enabled and (user.email or '').strip():
        _, made = TaskNotificationOutbox.objects.get_or_create(
            recipient=user,
            channel=TaskNotificationOutbox.Channel.EMAIL,
            event_key=event_key,
            defaults={
                'task': task,
                'event_type': event_type,
                'subject': subject[:300],
                'body': body,
                'payload': payload,
            },
        )
        created += int(made)

    if pref.telegram_enabled and pref.telegram_chat_id:
        _, made = TaskNotificationOutbox.objects.get_or_create(
            recipient=user,
            channel=TaskNotificationOutbox.Channel.TELEGRAM,
            event_key=event_key,
            defaults={
                'task': task,
                'event_type': event_type,
                'subject': subject[:300],
                'body': body,
                'payload': payload,
            },
        )
        created += int(made)
    return created


def enqueue_task_event(task, action, actor=None, detail=None):
    copy = _event_copy(task, action, actor, detail or {})
    if not copy:
        return 0
    subject, body, payload = copy
    event_key = f'event:{uuid.uuid4().hex}'
    recipient_ids = _recipient_ids(task, action, actor, detail or {})
    users = User.objects.filter(pk__in=recipient_ids, is_active=True)
    return sum(
        _enqueue_for_user(user, task, event_key, action, subject, body, payload)
        for user in users
    )


def enqueue_due_reminders(today=None):
    today = today or timezone.localdate()
    tomorrow = today + timedelta(days=1)
    tasks = (
        OperatingTask.objects
        .filter(due_date__in=[today, tomorrow], owner__is_active=True)
        .exclude(status__in=[WorkStatus.DONE, WorkStatus.ARCHIVED])
        .select_related('owner')
    )
    created = 0
    for task in tasks:
        kind = 'today' if task.due_date == today else 'tomorrow'
        when = 'today' if kind == 'today' else 'tomorrow'
        subject = f'Task due {when}: {task.title}'
        body = (
            f'Reminder: this task is due {when}.\n\n'
            f'Task: {task.title}\n'
            f'Due: {task.due_date.isoformat()}\n\n'
            f'Open task: {_task_url(task.pk)}'
        )
        event_key = f'due:{task.pk}:{task.due_date.isoformat()}:{kind}'
        created += _enqueue_for_user(
            task.owner,
            task,
            event_key,
            f'task.due_{kind}',
            subject,
            body,
            {'url': _task_url(task.pk), 'due_date': task.due_date.isoformat(), 'kind': kind},
            reminder=True,
        )
    return created


def _email_html(row):
    escaped = html.escape(row.body).replace('\n', '<br>')
    url = html.escape(str((row.payload or {}).get('url') or _task_url(row.task_id)))
    return (
        '<div style="margin:0;padding:32px 16px;background:#eef2f4;font-family:Arial,sans-serif;color:#15303d">'
        '<div style="max-width:620px;margin:0 auto;background:#fff;border-radius:18px;padding:30px;border:1px solid #d9e1e5">'
        '<div style="font-size:22px;font-weight:800;margin-bottom:18px">Gravitas+</div>'
        f'<h2 style="margin:0 0 16px;font-size:22px">{html.escape(row.subject)}</h2>'
        f'<div style="line-height:1.65;color:#435761">{escaped}</div>'
        f'<p style="margin:24px 0 0"><a href="{url}" style="display:inline-block;padding:11px 16px;border-radius:10px;background:#003049;color:#fff;text-decoration:none;font-weight:700">Open task</a></p>'
        '</div></div>'
    )


def _send_email(row):
    pref = _preference(row.recipient)
    if not pref.email_enabled or not row.recipient.email:
        return 'skipped'
    message = EmailMultiAlternatives(
        subject=row.subject,
        body=row.body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[row.recipient.email],
    )
    message.attach_alternative(_email_html(row), 'text/html')
    message.send(fail_silently=False)
    return 'sent'


def _telegram_api(method, payload):
    token = getattr(settings, 'GRAVITAS_TELEGRAM_BOT_TOKEN', '')
    if not token:
        raise RuntimeError('telegram_bot_not_configured')
    response = requests.post(
        f'https://api.telegram.org/bot{token}/{method}',
        json=payload,
        timeout=10,
    )
    response.raise_for_status()
    data = response.json()
    if not data.get('ok'):
        raise RuntimeError(str(data.get('description') or 'telegram_api_error'))
    return data


def _send_telegram(row):
    pref = _preference(row.recipient)
    if not pref.telegram_enabled or not pref.telegram_chat_id:
        return 'skipped'
    text = f'{row.subject}\n\n{row.body}'
    _telegram_api('sendMessage', {
        'chat_id': pref.telegram_chat_id,
        'text': text[:4096],
        'disable_web_page_preview': False,
    })
    return 'sent'


def deliver_pending(limit=100):
    now = timezone.now()
    ids = list(
        TaskNotificationOutbox.objects
        .filter(
            status__in=[TaskNotificationOutbox.Status.PENDING, TaskNotificationOutbox.Status.FAILED],
            available_at__lte=now,
            attempts__lt=5,
        )
        .order_by('created_at', 'id')
        .values_list('id', flat=True)[:limit]
    )
    sent = failed = skipped = 0
    for row_id in ids:
        row = TaskNotificationOutbox.objects.select_related('recipient', 'task').filter(pk=row_id).first()
        if not row:
            continue
        try:
            result = _send_email(row) if row.channel == TaskNotificationOutbox.Channel.EMAIL else _send_telegram(row)
            row.status = TaskNotificationOutbox.Status.SENT
            row.sent_at = timezone.now()
            row.last_error = '' if result == 'sent' else 'skipped_by_current_preference'
            row.attempts += 1
            row.save(update_fields=['status', 'sent_at', 'last_error', 'attempts', 'updated_at'])
            if result == 'sent':
                sent += 1
            else:
                skipped += 1
        except Exception as exc:
            logger.exception('Task notification delivery failed outbox_id=%s', row.pk)
            row.status = TaskNotificationOutbox.Status.FAILED
            row.attempts += 1
            delay = min(2 ** row.attempts, 60)
            row.available_at = timezone.now() + timedelta(minutes=delay)
            row.last_error = str(exc)[:2000]
            row.save(update_fields=['status', 'attempts', 'available_at', 'last_error', 'updated_at'])
            failed += 1
    return {'sent': sent, 'failed': failed, 'skipped': skipped}


def _settings_json(pref):
    username = getattr(settings, 'GRAVITAS_TELEGRAM_BOT_USERNAME', '').lstrip('@')
    connected = bool(pref.telegram_chat_id)
    link = ''
    now = timezone.now()
    if username and not connected:
        if not pref.telegram_link_code or not pref.telegram_link_expires_at or pref.telegram_link_expires_at <= now:
            pref.telegram_link_code = secrets.token_urlsafe(24)
            pref.telegram_link_expires_at = now + timedelta(minutes=30)
            pref.save(update_fields=['telegram_link_code', 'telegram_link_expires_at', 'updated_at'])
        link = f'https://t.me/{username}?start={pref.telegram_link_code}'
    return {
        'email_enabled': pref.email_enabled,
        'telegram_enabled': pref.telegram_enabled,
        'task_changes_enabled': pref.task_changes_enabled,
        'due_reminders_enabled': pref.due_reminders_enabled,
        'telegram_connected': connected,
        'telegram_username': pref.telegram_username,
        'telegram_bot_configured': bool(username and getattr(settings, 'GRAVITAS_TELEGRAM_BOT_TOKEN', '')),
        'telegram_connect_url': link,
    }


@require_http_methods(['GET', 'PATCH'])
def task_notification_settings(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    pref = _preference(request.user)
    if request.method == 'PATCH':
        try:
            payload = json.loads(request.body or '{}')
        except (json.JSONDecodeError, UnicodeDecodeError):
            payload = {}
        fields = []
        for key in ['email_enabled', 'telegram_enabled', 'task_changes_enabled', 'due_reminders_enabled']:
            if key in payload:
                if not isinstance(payload[key], bool):
                    return JsonResponse({'ok': False, 'error': f'invalid_{key}'}, status=400)
                setattr(pref, key, payload[key])
                fields.append(key)
        if payload.get('disconnect_telegram') is True:
            pref.telegram_chat_id = None
            pref.telegram_username = ''
            pref.telegram_connected_at = None
            pref.telegram_link_code = None
            pref.telegram_link_expires_at = None
            fields.extend([
                'telegram_chat_id', 'telegram_username', 'telegram_connected_at',
                'telegram_link_code', 'telegram_link_expires_at',
            ])
        if fields:
            pref.save(update_fields=list(dict.fromkeys(fields + ['updated_at'])))
    return JsonResponse({'ok': True, 'settings': _settings_json(pref)})


@csrf_exempt
@require_http_methods(['POST'])
def telegram_notification_webhook(request):
    configured = getattr(settings, 'GRAVITAS_TELEGRAM_WEBHOOK_SECRET', '')
    supplied = request.headers.get('X-Telegram-Bot-Api-Secret-Token', '')
    if not configured or not supplied or not hmac.compare_digest(configured, supplied):
        return JsonResponse({'ok': False, 'error': 'forbidden'}, status=403)
    try:
        update = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({'ok': True})

    message = update.get('message') or {}
    chat = message.get('chat') or {}
    if chat.get('type') != 'private':
        return JsonResponse({'ok': True})
    text = str(message.get('text') or '').strip()
    if not text.startswith('/start'):
        return JsonResponse({'ok': True})

    parts = text.split(maxsplit=1)
    code = parts[1].strip() if len(parts) > 1 else ''
    pref = (
        TaskNotificationPreference.objects
        .select_related('user')
        .filter(telegram_link_code=code, telegram_link_expires_at__gte=timezone.now())
        .first()
    ) if code else None
    chat_id = chat.get('id')

    if not pref or not chat_id:
        if chat_id:
            try:
                _telegram_api('sendMessage', {'chat_id': chat_id, 'text': 'This Gravitas+ connection link is invalid or expired. Please create a new link in Settings.'})
            except Exception:
                logger.exception('Could not send invalid Telegram link response')
        return JsonResponse({'ok': True})

    conflict = TaskNotificationPreference.objects.filter(telegram_chat_id=chat_id).exclude(pk=pref.pk).exists()
    if conflict:
        try:
            _telegram_api('sendMessage', {'chat_id': chat_id, 'text': 'This Telegram account is already connected to another Gravitas+ account.'})
        except Exception:
            logger.exception('Could not send Telegram conflict response')
        return JsonResponse({'ok': True})

    pref.telegram_chat_id = int(chat_id)
    pref.telegram_username = str(chat.get('username') or '')[:64]
    pref.telegram_enabled = True
    pref.telegram_connected_at = timezone.now()
    pref.telegram_link_code = None
    pref.telegram_link_expires_at = None
    pref.save(update_fields=[
        'telegram_chat_id', 'telegram_username', 'telegram_enabled',
        'telegram_connected_at', 'telegram_link_code', 'telegram_link_expires_at', 'updated_at',
    ])
    try:
        _telegram_api('sendMessage', {
            'chat_id': chat_id,
            'text': 'Gravitas+ task notifications are connected. You will receive task changes and enabled deadline reminders here.',
        })
    except Exception:
        logger.exception('Could not send Telegram connection confirmation')
    return JsonResponse({'ok': True})
