import json
import logging
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
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
from .models import Comment, LabProgress, NewsletterSubscriber

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
    return {
        'id': user.pk,
        'email': user.email,
        'name': user.first_name or user.username,
        'is_staff': user.is_staff,
    }


def _comment_json(comment):
    return {
        'id': comment.pk,
        'content_key': comment.content_key,
        'parent_id': comment.parent_id,
        'body': comment.body,
        'author': comment.author.first_name or 'Member',
        'created_at': comment.created_at.isoformat(),
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

    user = User.objects.create_user(
        username=email,
        email=email,
        password=password,
        first_name=name,
    )
    login(request, user)

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
            'newsletter_pending': newsletter_pending,
        },
        status=201,
    )


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

    login(request, user)
    if not keep:
        request.session.set_expiry(0)

    return JsonResponse({'ok': True, 'user': _user_json(user)})


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
            '<h2>Reset your Gravitas+ password</h2>'
            '<p>Use the link below within one hour to choose a new password.</p>'
            f'<p><a href="{link}">Choose a new password</a></p>'
            '<p>If you did not request this, you can ignore this email.</p>'
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
        return JsonResponse({'ok': True, 'comments': [_comment_json(item) for item in queryset]})

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
