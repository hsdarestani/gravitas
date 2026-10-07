import json
import logging
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core import signing
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.http import HttpResponseRedirect, JsonResponse
from django.views.decorators.http import require_http_methods

User = get_user_model()
logger = logging.getLogger(__name__)

EMAIL_VERIFIED_GROUP = 'gravitas-email-verified'
EMAIL_VERIFICATION_SALT = 'gravitas-account-email-confirm-v1'
EMAIL_VERIFICATION_MAX_AGE = 60 * 60 * 48


def is_email_verified(user):
    if not user or not getattr(user, 'pk', None):
        return False
    return user.groups.filter(name=EMAIL_VERIFIED_GROUP).exists()


def mark_email_verified(user):
    group, _ = Group.objects.get_or_create(name=EMAIL_VERIFIED_GROUP)
    user.groups.add(group)
    return True


def _verification_link(user):
    token = signing.dumps(
        {'uid': user.pk, 'email': (user.email or '').strip().lower()},
        salt=EMAIL_VERIFICATION_SALT,
        compress=True,
    )
    return f"{settings.PUBLIC_BASE_URL}/api/auth/email-confirm/?token={quote(token)}"


def send_account_verification(user):
    email = (user.email or '').strip().lower()
    if not email:
        raise ValueError('email_required')
    link = _verification_link(user)
    text = (
        'Confirm your Gravitas+ email address\n\n'
        'Click the link below within 48 hours to confirm your account email:\n'
        f'{link}\n\n'
        'If you did not create a Gravitas+ account, you can ignore this email.'
    )
    html = (
        '<div style="margin:0;padding:32px 16px;background:#eef2f4;font-family:Arial,sans-serif;color:#15303d">'
        '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:18px;padding:32px;border:1px solid #d9e1e5">'
        '<div style="font-size:24px;font-weight:800;letter-spacing:.02em;margin-bottom:22px">Gravitas+</div>'
        '<h2 style="margin:0 0 12px;font-size:24px">Confirm your email address</h2>'
        '<p style="margin:0 0 22px;line-height:1.6;color:#52636c">One click confirms your account and protects your research workspace. This link is valid for 48 hours.</p>'
        f'<p style="margin:0 0 24px"><a href="{link}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#003049;color:#fff;text-decoration:none;font-weight:700">Confirm email address</a></p>'
        '<p style="margin:0;font-size:13px;line-height:1.6;color:#718089">If you did not create a Gravitas+ account, you can safely ignore this message.</p>'
        '</div></div>'
    )
    message = EmailMultiAlternatives(
        subject='Confirm your Gravitas+ email',
        body=text,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[email],
    )
    message.attach_alternative(html, 'text/html')
    return bool(message.send(fail_silently=False))


def _send_new_account_verification(user_id):
    try:
        user = User.objects.get(pk=user_id, is_active=True)
        if not user.email or is_email_verified(user):
            return
        send_account_verification(user)
    except Exception:
        logger.exception('Could not send account verification email for user_id=%s', user_id)


@receiver(post_save, sender=User, dispatch_uid='gravitas_account_verification_on_create')
def account_verification_on_create(sender, instance, created, **kwargs):
    if not created or not instance.is_active or not instance.email:
        return
    if getattr(instance, '_verification_handled', False):
        return
    # System/E2E identities and admin-created unusable-password invites have their
    # own setup flows. Normal public signup accounts get a real confirmation mail.
    if instance.is_superuser or instance.email.lower().endswith('@example.com'):
        return
    if not instance.has_usable_password():
        return
    transaction.on_commit(lambda: _send_new_account_verification(instance.pk))


@require_http_methods(['GET'])
def account_email_confirm(request):
    token = request.GET.get('token', '')
    try:
        data = signing.loads(
            token,
            salt=EMAIL_VERIFICATION_SALT,
            max_age=EMAIL_VERIFICATION_MAX_AGE,
        )
        user = User.objects.get(pk=data.get('uid'), is_active=True)
        signed_email = str(data.get('email') or '').strip().lower()
        if not signed_email or signed_email != (user.email or '').strip().lower():
            raise User.DoesNotExist
    except (signing.BadSignature, signing.SignatureExpired, User.DoesNotExist, TypeError, ValueError):
        return HttpResponseRedirect(f'{settings.PUBLIC_BASE_URL}/account.html?email_verified=0')

    mark_email_verified(user)
    return HttpResponseRedirect(f'{settings.PUBLIC_BASE_URL}/account.html?email_verified=1')


@require_http_methods(['POST'])
def account_email_resend(request):
    user = request.user if request.user.is_authenticated else None
    if user is None:
        try:
            data = json.loads(request.body or '{}')
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = {}
        email = str(data.get('email') or '').strip().lower()
        if email:
            candidate = User.objects.filter(email__iexact=email, is_active=True).first()
            if candidate is not None:
                profile = getattr(candidate, 'gravitas_community_profile', None)
                if profile is not None and profile.email_verification_required:
                    user = candidate

    # Signed-out callers always receive a generic success response so this
    # endpoint cannot be used to discover which email addresses have accounts.
    if user is None:
        return JsonResponse({'ok': True, 'pending_confirmation': True})
    if is_email_verified(user):
        return JsonResponse({'ok': True, 'already_verified': True})
    try:
        sent = send_account_verification(user)
    except Exception:
        logger.exception('Could not resend account verification for user_id=%s', user.pk)
        return JsonResponse({'ok': False, 'error': 'email_delivery_failed'}, status=502)
    return JsonResponse({'ok': True, 'sent': sent, 'pending_confirmation': True})
