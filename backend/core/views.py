import json
import logging
import secrets
from urllib.parse import quote, urlencode

import requests

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.mail import EmailMultiAlternatives
from django.core.validators import validate_email
from django.db import connection
from django.http import HttpResponseRedirect, JsonResponse
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie

from . import cloud
from .email_verification import is_email_verified, mark_email_verified, send_account_verification
from .layer_models import CommunityProfile
from .models import Comment, CommentLike, LabProgress, NewsletterSubscriber
from .platform_models import ResearcherProfile

User = get_user_model()
logger = logging.getLogger(__name__)
NEWSLETTER_SIGNING_SALT = 'gravitas-newsletter-confirm-v1'
NEWSLETTER_CONFIRM_MAX_AGE = 60 * 60 * 48


def _payload(request):
    try:
        return json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return {}


def _user_json(user):
    profile = getattr(user, 'gravitas_researcher_profile', None)
    return {
        'id': user.pk,
        'email': user.email,
        'name': user.first_name or user.username,
        'phone': getattr(profile, 'phone', '') if profile else '',
        'email_verified': is_email_verified(user),
        'is_staff': user.is_staff,
    }


def _comment_json(comment, user=None):
    liked = bool(user and getattr(user, 'is_authenticated', False) and CommentLike.objects.filter(comment=comment, user=user).exists())
    return {
        'id': comment.pk,
        'content_key': comment.content_key,
        'parent_id': comment.parent_id,
        'body': comment.body,
        'author': comment.author.first_name or comment.author.get_username() or 'Member',
        'created_at': comment.created_at.isoformat(),
        'like_count': comment.likes.count(),
        'viewer_liked': liked,
    }


def _lab_progress_json(progress):
    return {
        'lab_key': progress.lab_key,
        'state': progress.state,
        'result': progress.result,
        'score': progress.score,
        'completed': progress.completed,
        'updated_at': progress.updated_at.isoformat(),
    }


def _send_system_email(subject, recipient, text_body, html_body=None):
    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[recipient],
    )
    if html_body:
        message.attach_alternative(html_body, 'text/html')
    message.send(fail_silently=False)


def _send_newsletter_confirmation(email):
    token = signing.dumps({'email': email}, salt=NEWSLETTER_SIGNING_SALT, compress=True)
    link = f"{settings.PUBLIC_BASE_URL}/api/newsletter/confirm/?token={quote(token)}"
    text = (
        'Confirm your Gravitas+ newsletter subscription\n\n'
        'Click the link below within 48 hours to confirm your email address:\n'
        f'{link}\n\n'
        'If you did not request this, you can ignore this email.'
    )
    html = (
        '<h2>Confirm your Gravitas+ subscription</h2>'
        '<p>One last step: confirm your email address within 48 hours.</p>'
        f'<p><a href="{link}">Confirm subscription</a></p>'
        '<p>If you did not request this, you can ignore this email.</p>'
    )
    _send_system_email('Confirm your Gravitas+ subscription', email, text, html)


def health(request):
    with connection.cursor() as cursor:
        cursor.execute('SELECT 1')
        cursor.fetchone()
    return JsonResponse({'status': 'ok', 'database': 'ok'})


@csrf_exempt
def newsletter_subscribe(request):
    if request.method != 'POST':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)

    payload = _payload(request)
    email = str(payload.get('email', '')).strip().lower()
    source = str(payload.get('source', 'website')).strip()[:80] or 'website'
    try:
        validate_email(email)
    except ValidationError:
        return JsonResponse({'ok': False, 'error': 'invalid_email'}, status=400)

    subscriber, created = NewsletterSubscriber.objects.get_or_create(
        email=email,
        defaults={'source': source, 'is_active': False},
    )
    if subscriber.is_active:
        return JsonResponse({'ok': True, 'created': False, 'already_confirmed': True})

    if subscriber.source != source:
        subscriber.source = source
        subscriber.save(update_fields=['source', 'updated_at'])

    try:
        _send_newsletter_confirmation(email)
    except Exception:
        return JsonResponse({'ok': False, 'error': 'email_delivery_failed'}, status=502)

    return JsonResponse(
        {'ok': True, 'created': created, 'pending_confirmation': True},
        status=201 if created else 200,
    )


def newsletter_confirm(request):
    token = request.GET.get('token', '')
    try:
        data = signing.loads(
            token,
            salt=NEWSLETTER_SIGNING_SALT,
            max_age=NEWSLETTER_CONFIRM_MAX_AGE,
        )
        email = str(data.get('email', '')).strip().lower()
        subscriber = NewsletterSubscriber.objects.get(email=email)
    except (signing.BadSignature, signing.SignatureExpired, NewsletterSubscriber.DoesNotExist):
        return HttpResponseRedirect(f'{settings.PUBLIC_BASE_URL}/newsletter.html?confirmed=0')

    if not subscriber.is_active:
        subscriber.is_active = True
        subscriber.save(update_fields=['is_active', 'updated_at'])
    return HttpResponseRedirect(f'{settings.PUBLIC_BASE_URL}/newsletter.html?confirmed=1')


@ensure_csrf_cookie
def auth_csrf(request):
    if request.method != 'GET':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)
    return JsonResponse({'ok': True})


def auth_signup(request):
    if request.method != 'POST':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)

    payload = _payload(request)
    name = str(payload.get('name', '')).strip()[:150]
    email = str(payload.get('email', '')).strip().lower()
    phone = str(payload.get('phone', '')).strip()[:40]
    password = str(payload.get('password', ''))
    wants_newsletter = bool(payload.get('newsletter'))

    try:
        validate_email(email)
    except ValidationError:
        return JsonResponse({'ok': False, 'error': 'invalid_email'}, status=400)

    if User.objects.filter(username__iexact=email).exists() or User.objects.filter(email__iexact=email).exists():
        return JsonResponse({'ok': False, 'error': 'account_exists'}, status=409)

    provisional_user = User(username=email, email=email, first_name=name)
    try:
        validate_password(password, user=provisional_user)
    except ValidationError as exc:
        return JsonResponse(
            {'ok': False, 'error': 'password_invalid', 'messages': list(exc.messages)},
            status=400,
        )

    user = User(username=email, email=email, first_name=name)
    user.set_password(password)
    # Public signup owns delivery synchronously, so the post_save fallback must
    # not send a second verification email for the same account.
    user._verification_handled = True
    user.save()
    CommunityProfile.objects.update_or_create(
        user=user,
        defaults={'email_verification_required': True},
    )
    ResearcherProfile.objects.update_or_create(user=user, defaults={'phone': phone})

    try:
        send_account_verification(user)
    except Exception:
        logger.exception('Could not deliver signup verification for user_id=%s', user.pk)
        user.delete()
        return JsonResponse({'ok': False, 'error': 'email_delivery_failed'}, status=502)

    from core.workspace_api import provision_personal_workspace
    provision_personal_workspace(user)

    newsletter_pending = False
    if wants_newsletter:
        subscriber, _ = NewsletterSubscriber.objects.get_or_create(
            email=email,
            defaults={'source': 'account-signup', 'is_active': False},
        )
        if not subscriber.is_active:
            if subscriber.source != 'account-signup':
                subscriber.source = 'account-signup'
                subscriber.save(update_fields=['source', 'updated_at'])
            try:
                _send_newsletter_confirmation(email)
                newsletter_pending = True
            except Exception:
                newsletter_pending = False

    return JsonResponse(
        {
            'ok': True,
            'user': _user_json(user),
            'pending_confirmation': True,
            'newsletter_pending': newsletter_pending,
        },
        status=201,
    )


def _verification_required(user):
    profile = getattr(user, 'gravitas_community_profile', None)
    return bool(profile and profile.email_verification_required)


def auth_login(request):
    if request.method != 'POST':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)

    payload = _payload(request)
    email = str(payload.get('email', '')).strip().lower()
    password = str(payload.get('password', ''))
    keep = bool(payload.get('keep', True))

    user = authenticate(request, username=email, password=password)
    if user is None:
        return JsonResponse({'ok': False, 'error': 'invalid_credentials'}, status=401)
    if _verification_required(user) and not is_email_verified(user):
        return JsonResponse(
            {'ok': False, 'error': 'email_not_verified', 'email': user.email},
            status=403,
        )

    login(request, user)
    if not keep:
        request.session.set_expiry(0)

    return JsonResponse({'ok': True, 'user': _user_json(user)})


def auth_google_start(request):
    client_id = str(getattr(settings, 'GOOGLE_OAUTH_CLIENT_ID', '') or '').strip()
    if not client_id:
        return HttpResponseRedirect(f'{settings.PUBLIC_BASE_URL}/account.html?google_error=not_configured#in')
    state = secrets.token_urlsafe(32)
    request.session['google_oauth_state'] = state
    params = {
        'client_id': client_id,
        'redirect_uri': settings.GOOGLE_OAUTH_REDIRECT_URI,
        'response_type': 'code',
        'scope': 'openid email profile',
        'state': state,
        'prompt': 'select_account',
    }
    return HttpResponseRedirect('https://accounts.google.com/o/oauth2/v2/auth?' + urlencode(params))


def auth_google_callback(request):
    code = str(request.GET.get('code') or '').strip()
    state = str(request.GET.get('state') or '').strip()
    expected = str(request.session.pop('google_oauth_state', '') or '')
    if not code or not state or not expected or not secrets.compare_digest(state, expected):
        return HttpResponseRedirect(f'{settings.PUBLIC_BASE_URL}/account.html?google_error=state#in')

    try:
        token_response = requests.post(
            'https://oauth2.googleapis.com/token',
            data={
                'code': code,
                'client_id': settings.GOOGLE_OAUTH_CLIENT_ID,
                'client_secret': settings.GOOGLE_OAUTH_CLIENT_SECRET,
                'redirect_uri': settings.GOOGLE_OAUTH_REDIRECT_URI,
                'grant_type': 'authorization_code',
            },
            timeout=(5, 20),
        )
        token_response.raise_for_status()
        access_token = str(token_response.json().get('access_token') or '')
        if not access_token:
            raise ValueError('missing_access_token')
        info_response = requests.get(
            'https://openidconnect.googleapis.com/v1/userinfo',
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=(5, 20),
        )
        info_response.raise_for_status()
        info = info_response.json()
    except (requests.RequestException, ValueError, TypeError):
        logger.exception('Google OAuth exchange failed')
        return HttpResponseRedirect(f'{settings.PUBLIC_BASE_URL}/account.html?google_error=provider#in')

    email = str(info.get('email') or '').strip().lower()
    if not email or not bool(info.get('email_verified')):
        return HttpResponseRedirect(f'{settings.PUBLIC_BASE_URL}/account.html?google_error=email#in')

    user = User.objects.filter(email__iexact=email).first()
    created = user is None
    if created:
        user = User(username=email, email=email, first_name=str(info.get('name') or '').strip()[:150])
        user.set_unusable_password()
        user._verification_handled = True
        user.save()
        from core.workspace_api import provision_personal_workspace
        provision_personal_workspace(user)
    elif not user.is_active:
        return HttpResponseRedirect(f'{settings.PUBLIC_BASE_URL}/account.html?google_error=account#in')

    profile, _ = CommunityProfile.objects.get_or_create(user=user)
    if not profile.email_verification_required:
        profile.email_verification_required = True
        profile.save(update_fields=['email_verification_required', 'updated_at'])
    mark_email_verified(user)
    ResearcherProfile.objects.get_or_create(user=user)
    login(request, user)
    return HttpResponseRedirect(f'{settings.PUBLIC_BASE_URL}/workspace')


def auth_logout(request):
    if request.method != 'POST':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)
    logout(request)
    return JsonResponse({'ok': True})


def auth_me(request):
    if not request.user.is_authenticated:
        return JsonResponse({'authenticated': False})
    return JsonResponse({'authenticated': True, 'user': _user_json(request.user)})


def auth_export(request):
    if request.method != 'GET':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)

    user = request.user
    comments_data = [
        {
            'id': item.pk,
            'content_key': item.content_key,
            'parent_id': item.parent_id,
            'body': item.body,
            'status': item.status,
            'created_at': item.created_at.isoformat(),
            'updated_at': item.updated_at.isoformat(),
        }
        for item in Comment.objects.filter(author=user).order_by('created_at')
    ]
    labs_data = [
        {
            'lab_key': item.lab_key,
            'state': item.state,
            'result': item.result,
            'score': item.score,
            'completed': item.completed,
            'created_at': item.created_at.isoformat(),
            'updated_at': item.updated_at.isoformat(),
        }
        for item in LabProgress.objects.filter(user=user).order_by('created_at')
    ]
    newsletter = NewsletterSubscriber.objects.filter(email__iexact=user.email).first()
    response = JsonResponse({
        'account': {
            'id': user.pk,
            'email': user.email,
            'name': user.first_name,
            'date_joined': user.date_joined.isoformat(),
            'last_login': user.last_login.isoformat() if user.last_login else None,
        },
        'newsletter': None if newsletter is None else {
            'is_active': newsletter.is_active,
            'source': newsletter.source,
            'created_at': newsletter.created_at.isoformat(),
            'updated_at': newsletter.updated_at.isoformat(),
        },
        'comments': comments_data,
        'lab_progress': labs_data,
    }, json_dumps_params={'indent': 2})
    response['Content-Disposition'] = 'attachment; filename="gravitas-account-data.json"'
    return response


def auth_delete(request):
    if request.method != 'POST':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)

    payload = _payload(request)
    password = str(payload.get('password', ''))
    confirmation = str(payload.get('confirmation', '')).strip().lower()
    user = request.user
    if confirmation != 'delete':
        return JsonResponse({'ok': False, 'error': 'confirmation_required'}, status=400)
    if not user.check_password(password):
        return JsonResponse({'ok': False, 'error': 'invalid_credentials'}, status=401)

    email = user.email
    identity = getattr(user, 'gravitas_nextcloud', None)
    if identity is not None:
        try:
            cloud.delete_identity(identity)
        except Exception:
            logger.exception('Could not remove Nextcloud identity for deleted user %s', user.pk)
    logout(request)
    NewsletterSubscriber.objects.filter(email__iexact=email).delete()
    user.delete()
    return JsonResponse({'ok': True, 'deleted': True})


def password_reset_request(request):
    if request.method != 'POST':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)

    payload = _payload(request)
    email = str(payload.get('email', '')).strip().lower()
    try:
        validate_email(email)
    except ValidationError:
        return JsonResponse({'ok': True})

    user = User.objects.filter(email__iexact=email, is_active=True).first()
    if user is not None:
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        link = f'{settings.PUBLIC_BASE_URL}/account.html?reset_uid={quote(uid)}&reset_token={quote(token)}#reset'
        text = (
            'Reset your Gravitas+ password\n\n'
            'Use the link below within one hour to choose a new password:\n'
            f'{link}\n\n'
            'If you did not request this, you can ignore this email.'
        )
        html = (
            '<div style="margin:0;padding:32px 16px;background:#eef2f4;font-family:Arial,sans-serif;color:#15303d">'
            '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:32px;border:1px solid #d9e1e5">'
            '<div style="font-size:24px;font-weight:800;margin-bottom:22px">Gravitas+</div>'
            '<h2 style="margin:0 0 12px">Reset your password</h2>'
            '<p style="line-height:1.6;color:#52636c">Use the button below within one hour to choose a new password.</p>'
            f'<p style="margin:22px 0"><a href="{link}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#003049;color:#fff;text-decoration:none;font-weight:700">Choose a new password</a></p>'
            '<p style="font-size:13px;line-height:1.6;color:#718089">If you did not request this, you can safely ignore this email.</p>'
            '</div></div>'
        )
        try:
            _send_system_email('Reset your Gravitas+ password', email, text, html)
        except Exception:
            return JsonResponse({'ok': False, 'error': 'email_delivery_failed'}, status=502)

    return JsonResponse({'ok': True})


def password_reset_confirm(request):
    if request.method != 'POST':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)

    payload = _payload(request)
    uid = str(payload.get('uid', ''))
    token = str(payload.get('token', ''))
    password = str(payload.get('password', ''))
    try:
        user_id = force_str(urlsafe_base64_decode(uid))
        user = User.objects.get(pk=user_id, is_active=True)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return JsonResponse({'ok': False, 'error': 'invalid_or_expired_link'}, status=400)

    if not default_token_generator.check_token(user, token):
        return JsonResponse({'ok': False, 'error': 'invalid_or_expired_link'}, status=400)

    try:
        validate_password(password, user=user)
    except ValidationError as exc:
        return JsonResponse(
            {'ok': False, 'error': 'password_invalid', 'messages': list(exc.messages)},
            status=400,
        )

    user.set_password(password)
    user.save(update_fields=['password'])
    return JsonResponse({'ok': True})


def comments(request, content_key):
    if request.method == 'GET':
        queryset = (
            Comment.objects
            .filter(content_key=content_key, status=Comment.Status.PUBLISHED)
            .select_related('author')
            .order_by('created_at')[:200]
        )
        return JsonResponse({'ok': True, 'comments': [_comment_json(item, request.user) for item in queryset]})

    if request.method != 'POST':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)

    payload = _payload(request)
    body = str(payload.get('body', '')).strip()
    if not body or len(body) > 5000:
        return JsonResponse({'ok': False, 'error': 'invalid_body'}, status=400)

    parent = None
    parent_id = payload.get('parent_id')
    if parent_id:
        parent = Comment.objects.filter(
            pk=parent_id,
            content_key=content_key,
            status=Comment.Status.PUBLISHED,
        ).first()
        if parent is None:
            return JsonResponse({'ok': False, 'error': 'invalid_parent'}, status=400)

    comment = Comment.objects.create(
        author=request.user,
        content_key=content_key,
        parent=parent,
        body=body,
        status=Comment.Status.PENDING,
    )
    return JsonResponse(
        {
            'ok': True,
            'moderation': 'pending',
            'comment': _comment_json(comment),
        },
        status=201,
    )


def comment_like(request, content_key, comment_id):
    if request.method != 'POST':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)
    comment = Comment.objects.filter(pk=comment_id, content_key=content_key, status=Comment.Status.PUBLISHED).first()
    if comment is None:
        return JsonResponse({'ok': False, 'error': 'comment_not_found'}, status=404)
    like, created = CommentLike.objects.get_or_create(comment=comment, user=request.user)
    if created:
        liked = True
    else:
        like.delete()
        liked = False
    return JsonResponse({'ok': True, 'liked': liked, 'like_count': comment.likes.count()})


def lab_progress(request, lab_key):
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)

    if request.method == 'GET':
        progress = LabProgress.objects.filter(user=request.user, lab_key=lab_key).first()
        if progress is None:
            return JsonResponse({'ok': True, 'exists': False, 'progress': None})
        return JsonResponse({'ok': True, 'exists': True, 'progress': _lab_progress_json(progress)})

    if request.method == 'DELETE':
        LabProgress.objects.filter(user=request.user, lab_key=lab_key).delete()
        return JsonResponse({'ok': True, 'deleted': True})

    if request.method not in {'POST', 'PUT'}:
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)

    payload = _payload(request)
    state = payload.get('state', {})
    result = payload.get('result', {})
    if not isinstance(state, dict) or not isinstance(result, dict):
        return JsonResponse({'ok': False, 'error': 'invalid_payload'}, status=400)

    serialized_size = len(json.dumps(state)) + len(json.dumps(result))
    if serialized_size > 100000:
        return JsonResponse({'ok': False, 'error': 'payload_too_large'}, status=413)

    score = payload.get('score')
    if score is not None:
        try:
            score = float(score)
        except (TypeError, ValueError):
            return JsonResponse({'ok': False, 'error': 'invalid_score'}, status=400)
        if abs(score) > 1_000_000_000:
            return JsonResponse({'ok': False, 'error': 'invalid_score'}, status=400)

    progress, created = LabProgress.objects.update_or_create(
        user=request.user,
        lab_key=lab_key,
        defaults={
            'state': state,
            'result': result,
            'score': score,
            'completed': bool(payload.get('completed', False)),
        },
    )
    return JsonResponse(
        {
            'ok': True,
            'created': created,
            'progress': _lab_progress_json(progress),
        },
        status=201 if created else 200,
    )


def password_change(request):
    """Change the password of the signed-in user.

    Distinct from the reset flow above, which proves identity through an
    emailed token because the person asking is by definition locked out.
    Here they are already signed in, so the proof is the current password.
    Requiring it is what stops a borrowed unlocked laptop from becoming a
    permanent account takeover.
    """
    if request.method != 'POST':
        return JsonResponse({'ok': False, 'error': 'method_not_allowed'}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'authentication_required'}, status=401)

    payload = _payload(request)
    current = str(payload.get('current_password', ''))
    password = str(payload.get('password', ''))

    if not request.user.check_password(current):
        return JsonResponse({'ok': False, 'error': 'current_password_incorrect'}, status=400)

    try:
        validate_password(password, user=request.user)
    except ValidationError as exc:
        return JsonResponse({'ok': False, 'error': 'password_rejected', 'detail': list(exc.messages)}, status=400)

    request.user.set_password(password)
    request.user.save(update_fields=['password'])

    # Changing a password rotates the session hash, which would sign the
    # person out of the tab they just used to change it. This keeps the
    # current session valid; every other session is invalidated, which is
    # the behaviour someone changing a password after a scare expects.
    update_session_auth_hash(request, request.user)

    return JsonResponse({'ok': True})
