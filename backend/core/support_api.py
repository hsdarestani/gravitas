import json

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import SupportMessage, SupportTicket
from .platform_runtime_v3 import core_role, ensure_platform_workspaces


def _body(request):
    try:
        data = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _admin(user):
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    spaces = ensure_platform_workspaces(user)
    return core_role(user, spaces['core']) in {'owner', 'admin'}


def _message_json(item):
    return {
        'id': item.pk,
        'author_id': item.author_id,
        'author': item.author.get_full_name() or item.author.email,
        'body': item.body,
        'is_team_reply': item.is_team_reply,
        'created_at': item.created_at.isoformat(),
    }


def _ticket_json(item, detail=False):
    data = {
        'id': item.pk,
        'subject': item.subject,
        'status': item.status,
        'priority': item.priority,
        'created_at': item.created_at.isoformat(),
        'updated_at': item.updated_at.isoformat(),
        'member': {
            'id': item.user_id,
            'name': item.user.get_full_name() or item.user.email,
            'email': item.user.email,
        },
        'message_count': item.messages.count(),
    }
    if detail:
        data['messages'] = [_message_json(msg) for msg in item.messages.select_related('author').all()]
    return data


@require_http_methods(['GET', 'POST'])
def member_tickets(request):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    if request.method == 'GET':
        qs = SupportTicket.objects.filter(user=request.user).select_related('user')
        return JsonResponse({'ok': True, 'tickets': [_ticket_json(item) for item in qs[:100]]})

    data = _body(request)
    subject = str(data.get('subject') or '').strip()[:240]
    body = str(data.get('message') or '').strip()
    priority = str(data.get('priority') or SupportTicket.Priority.NORMAL)
    if not subject or not body:
        return JsonResponse({'ok': False, 'error': 'subject_and_message_required'}, status=400)
    if len(body) > 10000:
        return JsonResponse({'ok': False, 'error': 'message_too_long'}, status=400)
    if priority not in SupportTicket.Priority.values:
        return JsonResponse({'ok': False, 'error': 'invalid_priority'}, status=400)
    ticket = SupportTicket.objects.create(user=request.user, subject=subject, priority=priority)
    SupportMessage.objects.create(ticket=ticket, author=request.user, body=body, is_team_reply=False)
    return JsonResponse({'ok': True, 'ticket': _ticket_json(ticket, True)}, status=201)


@require_http_methods(['GET', 'POST', 'PATCH'])
def member_ticket_detail(request, ticket_id):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    ticket = SupportTicket.objects.select_related('user').filter(pk=ticket_id, user=request.user).first()
    if not ticket:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'ticket': _ticket_json(ticket, True)})
    if request.method == 'PATCH':
        data = _body(request)
        if data.get('status') not in {SupportTicket.Status.RESOLVED, SupportTicket.Status.CLOSED}:
            return JsonResponse({'ok': False, 'error': 'invalid_status'}, status=400)
        ticket.status = data['status']
        ticket.save(update_fields=['status', 'updated_at'])
        return JsonResponse({'ok': True, 'ticket': _ticket_json(ticket, True)})

    if ticket.status == SupportTicket.Status.CLOSED:
        return JsonResponse({'ok': False, 'error': 'ticket_closed'}, status=409)
    data = _body(request)
    body = str(data.get('message') or '').strip()
    if not body or len(body) > 10000:
        return JsonResponse({'ok': False, 'error': 'invalid_message'}, status=400)
    SupportMessage.objects.create(ticket=ticket, author=request.user, body=body, is_team_reply=False)
    ticket.status = SupportTicket.Status.WAITING_TEAM
    ticket.save(update_fields=['status', 'updated_at'])
    return JsonResponse({'ok': True, 'ticket': _ticket_json(ticket, True)})


@require_http_methods(['GET'])
def admin_tickets(request):
    if not _admin(request.user):
        return JsonResponse({'ok': False, 'error': 'core_admin_required'}, status=403)
    qs = SupportTicket.objects.select_related('user').all()
    status = str(request.GET.get('status') or '').strip()
    if status:
        if status not in SupportTicket.Status.values:
            return JsonResponse({'ok': False, 'error': 'invalid_status'}, status=400)
        qs = qs.filter(status=status)
    return JsonResponse({'ok': True, 'tickets': [_ticket_json(item) for item in qs[:250]]})


@require_http_methods(['GET', 'POST', 'PATCH'])
def admin_ticket_detail(request, ticket_id):
    if not _admin(request.user):
        return JsonResponse({'ok': False, 'error': 'core_admin_required'}, status=403)
    ticket = SupportTicket.objects.select_related('user').filter(pk=ticket_id).first()
    if not ticket:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    if request.method == 'GET':
        return JsonResponse({'ok': True, 'ticket': _ticket_json(ticket, True)})
    data = _body(request)
    if request.method == 'PATCH':
        status = str(data.get('status') or '')
        priority = str(data.get('priority') or '')
        fields = []
        if status:
            if status not in SupportTicket.Status.values:
                return JsonResponse({'ok': False, 'error': 'invalid_status'}, status=400)
            ticket.status = status; fields.append('status')
        if priority:
            if priority not in SupportTicket.Priority.values:
                return JsonResponse({'ok': False, 'error': 'invalid_priority'}, status=400)
            ticket.priority = priority; fields.append('priority')
        if fields:
            fields.append('updated_at')
            ticket.save(update_fields=fields)
        return JsonResponse({'ok': True, 'ticket': _ticket_json(ticket, True)})

    body = str(data.get('message') or '').strip()
    if not body or len(body) > 10000:
        return JsonResponse({'ok': False, 'error': 'invalid_message'}, status=400)
    SupportMessage.objects.create(ticket=ticket, author=request.user, body=body, is_team_reply=True)
    ticket.status = SupportTicket.Status.WAITING_MEMBER
    ticket.save(update_fields=['status', 'updated_at'])
    return JsonResponse({'ok': True, 'ticket': _ticket_json(ticket, True)})
