import json

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie

from .models import Comment, NewsletterSubscriber

User = get_user_model()


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
    try:
        validate_email(email)
    except ValidationError:
        return JsonResponse({'ok': False, 'error': 'invalid_email'}, status=400)

    subscriber, created = NewsletterSubscriber.objects.get_or_create(
        email=email,
        defaults={'source': 'website', 'is_active': True},
    )
    if not subscriber.is_active:
        subscriber.is_active = True
        subscriber.save(update_fields=['is_active', 'updated_at'])

    return JsonResponse({'ok': True, 'created': created}, status=201 if created else 200)


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

    if len(password) < 8:
        return JsonResponse({'ok': False, 'error': 'password_too_short'}, status=400)
    if User.objects.filter(username__iexact=email).exists() or User.objects.filter(email__iexact=email).exists():
        return JsonResponse({'ok': False, 'error': 'account_exists'}, status=409)

    user = User.objects.create_user(
        username=email,
        email=email,
        password=password,
        first_name=name,
    )
    login(request, user)

    if wants_newsletter:
        NewsletterSubscriber.objects.update_or_create(
            email=email,
            defaults={'source': 'account-signup', 'is_active': True},
        )

    return JsonResponse({'ok': True, 'user': _user_json(user)}, status=201)


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
