import base64
import hashlib
import json
import secrets
from datetime import timedelta
from urllib.parse import quote, urlencode, urlsplit

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from django.conf import settings
from django.db import transaction
from django.http import HttpResponseRedirect, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from . import nextcloud_bridge
from .oidc_models import OIDCAccessToken, OIDCAuthorizationCode


def _b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode('ascii')


def _hash_token(value):
    return hashlib.sha256(str(value).encode('utf-8')).hexdigest()


def _issuer():
    return str(getattr(settings, 'GRAVITAS_OIDC_ISSUER', '') or f'{settings.PUBLIC_BASE_URL}/api/oidc').rstrip('/')


def _client_id():
    return str(getattr(settings, 'GRAVITAS_OIDC_CLIENT_ID', '') or 'gravitas-nextcloud')


def _client_secret():
    return str(getattr(settings, 'GRAVITAS_OIDC_CLIENT_SECRET', '') or '')


def _private_key():
    encoded = str(getattr(settings, 'GRAVITAS_OIDC_PRIVATE_KEY_B64', '') or '').strip()
    if not encoded:
        raise RuntimeError('OIDC signing key is not configured')
    try:
        pem = base64.b64decode(encoded, validate=True)
        key = serialization.load_pem_private_key(pem, password=None)
    except Exception as exc:
        raise RuntimeError('OIDC signing key is invalid') from exc
    if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
        raise RuntimeError('OIDC signing key must be RSA 2048 bits or stronger')
    return key


def _jwk():
    public = _private_key().public_key()
    numbers = public.public_numbers()
    n = numbers.n.to_bytes((numbers.n.bit_length() + 7) // 8, 'big')
    e = numbers.e.to_bytes((numbers.e.bit_length() + 7) // 8, 'big')
    der = public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    kid = hashlib.sha256(der).hexdigest()[:24]
    return {'kty': 'RSA', 'use': 'sig', 'alg': 'RS256', 'kid': kid, 'n': _b64url(n), 'e': _b64url(e)}


def _jwt(payload):
    jwk = _jwk()
    header = {'alg': 'RS256', 'typ': 'JWT', 'kid': jwk['kid']}
    encoded_header = _b64url(json.dumps(header, separators=(',', ':'), sort_keys=True).encode('utf-8'))
    encoded_payload = _b64url(json.dumps(payload, separators=(',', ':'), sort_keys=True).encode('utf-8'))
    signing_input = f'{encoded_header}.{encoded_payload}'.encode('ascii')
    signature = _private_key().sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    return f'{encoded_header}.{encoded_payload}.{_b64url(signature)}'


def _no_store(response):
    response['Cache-Control'] = 'no-store'
    response['Pragma'] = 'no-cache'
    return response


def _callback_urls():
    base = str(settings.NEXTCLOUD_PUBLIC_URL).rstrip('/')
    return {
        f'{base}/apps/user_oidc/code',
        f'{base}/index.php/apps/user_oidc/code',
    }


def _valid_redirect_uri(value):
    return str(value or '') in _callback_urls()


def _claims(user):
    identity = nextcloud_bridge.ensure_user(user)
    name = user.get_full_name().strip() or user.first_name or user.email or user.username
    return {
        'sub': f'gravitas:{user.pk}',
        'nextcloud_uid': identity.username,
        'preferred_username': identity.username,
        'name': name,
        'email': user.email,
    }


def _oauth_error(error, description, status=400):
    return _no_store(JsonResponse({'error': error, 'error_description': description}, status=status))


@require_GET
def oidc_discovery(request):
    issuer = _issuer()
    return JsonResponse({
        'issuer': issuer,
        'authorization_endpoint': f'{issuer}/authorize/',
        'token_endpoint': f'{issuer}/token/',
        'userinfo_endpoint': f'{issuer}/userinfo/',
        'jwks_uri': f'{issuer}/jwks/',
        'response_types_supported': ['code'],
        'response_modes_supported': ['query'],
        'grant_types_supported': ['authorization_code'],
        'subject_types_supported': ['public'],
        'id_token_signing_alg_values_supported': ['RS256'],
        'scopes_supported': ['openid', 'profile', 'email'],
        'claims_supported': ['sub', 'name', 'email', 'preferred_username', 'nextcloud_uid'],
        'token_endpoint_auth_methods_supported': ['client_secret_basic', 'client_secret_post'],
        'code_challenge_methods_supported': ['S256'],
    })


@require_GET
def oidc_jwks(request):
    try:
        key = _jwk()
    except RuntimeError:
        return _oauth_error('temporarily_unavailable', 'OIDC signing is not configured', 503)
    return _no_store(JsonResponse({'keys': [key]}))


@require_GET
def oidc_authorize(request):
    if not request.user.is_authenticated:
        next_path = request.get_full_path()
        return HttpResponseRedirect('/login?' + urlencode({'oidc_next': next_path}))

    client_id = str(request.GET.get('client_id') or '')
    redirect_uri = str(request.GET.get('redirect_uri') or '')
    response_type = str(request.GET.get('response_type') or '')
    scope = str(request.GET.get('scope') or 'openid')
    state = str(request.GET.get('state') or '')
    nonce = str(request.GET.get('nonce') or '')[:300]
    code_challenge = str(request.GET.get('code_challenge') or '')[:160]
    code_challenge_method = str(request.GET.get('code_challenge_method') or '')

    if client_id != _client_id():
        return _oauth_error('unauthorized_client', 'Unknown OIDC client')
    if not _valid_redirect_uri(redirect_uri):
        return _oauth_error('invalid_request', 'Invalid redirect URI')
    if response_type != 'code':
        return _oauth_error('unsupported_response_type', 'Only authorization code flow is supported')
    if 'openid' not in scope.split():
        return _oauth_error('invalid_scope', 'The openid scope is required')
    if code_challenge and code_challenge_method != 'S256':
        return _oauth_error('invalid_request', 'Only PKCE S256 is supported')

    try:
        nextcloud_bridge.ensure_user(request.user)
    except Exception:
        return _oauth_error('temporarily_unavailable', 'Could not provision the linked Nextcloud identity', 503)

    raw_code = secrets.token_urlsafe(48)
    OIDCAuthorizationCode.objects.create(
        code_hash=_hash_token(raw_code),
        user=request.user,
        client_id=client_id,
        redirect_uri=redirect_uri,
        scope=scope[:300],
        nonce=nonce,
        code_challenge=code_challenge,
        expires_at=timezone.now() + timedelta(minutes=5),
    )
    params = {'code': raw_code}
    if state:
        params['state'] = state
    separator = '&' if '?' in redirect_uri else '?'
    return HttpResponseRedirect(redirect_uri + separator + urlencode(params))


def _client_credentials(request):
    client_id = str(request.POST.get('client_id') or '')
    client_secret = str(request.POST.get('client_secret') or '')
    authorization = str(request.META.get('HTTP_AUTHORIZATION') or '')
    if authorization.lower().startswith('basic '):
        try:
            decoded = base64.b64decode(authorization.split(None, 1)[1]).decode('utf-8')
            basic_id, basic_secret = decoded.split(':', 1)
            client_id = basic_id
            client_secret = basic_secret
        except Exception:
            return '', ''
    return client_id, client_secret


@csrf_exempt
@require_POST
def oidc_token(request):
    configured_secret = _client_secret()
    if not configured_secret:
        return _oauth_error('temporarily_unavailable', 'OIDC client secret is not configured', 503)
    supplied_id, supplied_secret = _client_credentials(request)
    if supplied_id != _client_id() or not secrets.compare_digest(supplied_secret, configured_secret):
        response = _oauth_error('invalid_client', 'Client authentication failed', 401)
        response['WWW-Authenticate'] = 'Basic realm="Gravitas OIDC"'
        return response
    if str(request.POST.get('grant_type') or '') != 'authorization_code':
        return _oauth_error('unsupported_grant_type', 'Only authorization_code is supported')

    raw_code = str(request.POST.get('code') or '')
    redirect_uri = str(request.POST.get('redirect_uri') or '')
    verifier = str(request.POST.get('code_verifier') or '')
    now = timezone.now()

    with transaction.atomic():
        code = OIDCAuthorizationCode.objects.select_for_update().select_related('user').filter(code_hash=_hash_token(raw_code)).first()
        if not code or code.used_at is not None or code.expires_at <= now:
            return _oauth_error('invalid_grant', 'Authorization code is invalid or expired')
        if code.client_id != supplied_id or code.redirect_uri != redirect_uri:
            return _oauth_error('invalid_grant', 'Authorization code does not match this request')
        if code.code_challenge:
            if not verifier:
                return _oauth_error('invalid_grant', 'PKCE verifier is required')
            challenge = _b64url(hashlib.sha256(verifier.encode('ascii', errors='ignore')).digest())
            if not secrets.compare_digest(challenge, code.code_challenge):
                return _oauth_error('invalid_grant', 'PKCE verification failed')
        code.used_at = now
        code.save(update_fields=['used_at'])

    access_token = secrets.token_urlsafe(48)
    expires_in = 600
    OIDCAccessToken.objects.create(
        token_hash=_hash_token(access_token),
        user=code.user,
        client_id=supplied_id,
        scope=code.scope,
        expires_at=now + timedelta(seconds=expires_in),
    )
    claims = _claims(code.user)
    claims.update({
        'iss': _issuer(),
        'aud': supplied_id,
        'iat': int(now.timestamp()),
        'exp': int((now + timedelta(seconds=expires_in)).timestamp()),
        'auth_time': int(code.created_at.timestamp()),
    })
    if code.nonce:
        claims['nonce'] = code.nonce
    try:
        id_token = _jwt(claims)
    except RuntimeError:
        return _oauth_error('temporarily_unavailable', 'OIDC signing is not configured', 503)

    return _no_store(JsonResponse({
        'access_token': access_token,
        'token_type': 'Bearer',
        'expires_in': expires_in,
        'scope': code.scope,
        'id_token': id_token,
    }))


@require_GET
def oidc_userinfo(request):
    authorization = str(request.META.get('HTTP_AUTHORIZATION') or '')
    if not authorization.lower().startswith('bearer '):
        response = _oauth_error('invalid_token', 'Bearer token required', 401)
        response['WWW-Authenticate'] = 'Bearer'
        return response
    raw = authorization.split(None, 1)[1].strip()
    token = OIDCAccessToken.objects.select_related('user').filter(token_hash=_hash_token(raw)).first()
    if not token or token.expires_at <= timezone.now():
        response = _oauth_error('invalid_token', 'Bearer token is invalid or expired', 401)
        response['WWW-Authenticate'] = 'Bearer error="invalid_token"'
        return response
    return _no_store(JsonResponse(_claims(token.user)))


def _safe_nextcloud_target(value):
    base = str(settings.NEXTCLOUD_PUBLIC_URL).rstrip('/')
    default = '/index.php/apps/files/files'
    value = str(value or default).strip()
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        base_parts = urlsplit(base)
        if parsed.scheme != base_parts.scheme or parsed.netloc != base_parts.netloc:
            return default
        value = parsed.path or '/'
        if parsed.query:
            value += '?' + parsed.query
    if not value.startswith('/') or value.startswith('//') or '\\' in value or '\x00' in value:
        return default
    return value


@require_GET
def nextcloud_sso(request):
    if not request.user.is_authenticated:
        return HttpResponseRedirect('/login?' + urlencode({'oidc_next': request.get_full_path()}))
    provider_id = str(getattr(settings, 'NEXTCLOUD_OIDC_PROVIDER_ID', '') or '').strip()
    if not provider_id.isdigit():
        return JsonResponse({'ok': False, 'error': 'nextcloud_sso_not_configured'}, status=503)
    try:
        nextcloud_bridge.ensure_user(request.user)
    except Exception:
        return JsonResponse({'ok': False, 'error': 'nextcloud_identity_unavailable'}, status=503)
    target = _safe_nextcloud_target(request.GET.get('next'))
    base = str(settings.NEXTCLOUD_PUBLIC_URL).rstrip('/')
    login_url = f'{base}/index.php/apps/user_oidc/login/{provider_id}?{urlencode({"redirectUrl": target})}'
    return HttpResponseRedirect(login_url)
