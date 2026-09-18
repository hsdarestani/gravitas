import html
import json

from django.core.mail import EmailMultiAlternatives, get_connection
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .models import NewsletterCampaign, NewsletterSubscriber
from .platform_runtime_v3 import core_role, ensure_platform_workspaces


def _admin(request):
    if not request.user.is_authenticated:
        return False
    if request.user.is_superuser:
        return True
    spaces = ensure_platform_workspaces(request.user)
    return core_role(request.user, spaces['core']) in {'owner', 'admin'}


def _subscriber_json(item):
    return {
        'id': item.pk,
        'email': item.email,
        'active': item.is_active,
        'source': item.source,
        'created_at': item.created_at.isoformat(),
        'updated_at': item.updated_at.isoformat(),
    }


@require_http_methods(['GET', 'POST'])
def admin_newsletter(request):
    if not _admin(request):
        return JsonResponse({'ok': False, 'error': 'core_admin_required'}, status=403)
    if request.method == 'GET':
        subscribers = NewsletterSubscriber.objects.all()[:1000]
        campaigns = NewsletterCampaign.objects.select_related('created_by')[:100]
        return JsonResponse({
            'ok': True,
            'active_count': NewsletterSubscriber.objects.filter(is_active=True).count(),
            'subscribers': [_subscriber_json(item) for item in subscribers],
            'campaigns': [{
                'id': item.pk,
                'subject': item.subject,
                'sent_count': item.sent_count,
                'created_by': item.created_by.get_full_name() or item.created_by.email,
                'created_at': item.created_at.isoformat(),
            } for item in campaigns],
        })

    try:
        data = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        data = {}
    subject = str(data.get('subject') or '').strip()[:240]
    body = str(data.get('body') or '').strip()
    if not subject or not body:
        return JsonResponse({'ok': False, 'error': 'subject_and_body_required'}, status=400)
    if len(body) > 100000:
        return JsonResponse({'ok': False, 'error': 'body_too_long'}, status=400)

    recipients = list(
        NewsletterSubscriber.objects.filter(is_active=True)
        .order_by('id')
        .values_list('email', flat=True)
    )
    connection = get_connection(fail_silently=False)
    messages = []
    safe_body = '<br>'.join(html.escape(body).splitlines())
    for email in recipients:
        message = EmailMultiAlternatives(
            subject=subject,
            body=body,
            to=[email],
            connection=connection,
        )
        message.attach_alternative(
            '<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;line-height:1.65">'
            '<h2 style="margin-bottom:20px">Gravitas+</h2>'
            f'<div>{safe_body}</div>'
            '</div>',
            'text/html',
        )
        messages.append(message)
    sent = connection.send_messages(messages) if messages else 0
    campaign = NewsletterCampaign.objects.create(
        subject=subject,
        body=body,
        sent_count=sent,
        created_by=request.user,
    )
    return JsonResponse({'ok': True, 'campaign_id': campaign.pk, 'sent_count': sent}, status=201)


@require_http_methods(['PATCH'])
def admin_newsletter_subscriber(request, subscriber_id):
    if not _admin(request):
        return JsonResponse({'ok': False, 'error': 'core_admin_required'}, status=403)
    item = NewsletterSubscriber.objects.filter(pk=subscriber_id).first()
    if not item:
        return JsonResponse({'ok': False, 'error': 'not_found'}, status=404)
    try:
        data = json.loads(request.body or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        data = {}
    if 'active' not in data:
        return JsonResponse({'ok': False, 'error': 'active_required'}, status=400)
    item.is_active = bool(data['active'])
    item.save(update_fields=['is_active', 'updated_at'])
    return JsonResponse({'ok': True, 'subscriber': _subscriber_json(item)})
