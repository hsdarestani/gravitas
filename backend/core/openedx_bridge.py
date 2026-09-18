import base64
import threading
import time

import requests
from django.conf import settings


class OpenEdXError(Exception):
    pass


_lock = threading.Lock()
_token = {'value': '', 'expires_at': 0.0}


def configured():
    return bool(
        getattr(settings, 'OPENEDX_ENABLED', False)
        and str(getattr(settings, 'OPENEDX_CLIENT_ID', '') or '').strip()
        and str(getattr(settings, 'OPENEDX_CLIENT_SECRET', '') or '').strip()
    )


def _base():
    return str(getattr(settings, 'OPENEDX_INTERNAL_URL', '') or '').rstrip('/')


def _host():
    value = str(getattr(settings, 'OPENEDX_LMS_URL', '') or '').strip()
    return value.split('://', 1)[-1].split('/', 1)[0]


def _timeout():
    return max(5, int(getattr(settings, 'OPENEDX_TIMEOUT', 30) or 30))


def _token_value():
    if not configured():
        raise OpenEdXError('openedx_not_configured')
    now = time.monotonic()
    if _token['value'] and _token['expires_at'] > now + 60:
        return _token['value']

    with _lock:
        now = time.monotonic()
        if _token['value'] and _token['expires_at'] > now + 60:
            return _token['value']

        client_id = str(settings.OPENEDX_CLIENT_ID)
        client_secret = str(settings.OPENEDX_CLIENT_SECRET)
        credential = base64.b64encode(f'{client_id}:{client_secret}'.encode('utf-8')).decode('ascii')
        try:
            response = requests.post(
                _base() + '/oauth2/access_token',
                headers={
                    'Authorization': f'Basic {credential}',
                    'Host': _host(),
                    'Accept': 'application/json',
                },
                data={'grant_type': 'client_credentials', 'token_type': 'jwt'},
                timeout=(5, _timeout()),
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise OpenEdXError('openedx_token_failed') from exc

        value = str(payload.get('access_token') or '').strip()
        if not value:
            raise OpenEdXError('openedx_token_failed')
        expires = max(120, int(payload.get('expires_in') or 3600))
        _token.update(value=value, expires_at=time.monotonic() + expires)
        return value


def request(method, path, *, params=None, payload=None, authenticated=True, expected=(200,)):
    headers = {'Host': _host(), 'Accept': 'application/json'}
    if authenticated:
        headers['Authorization'] = f'JWT {_token_value()}'
    try:
        response = requests.request(
            method,
            _base() + '/' + str(path).lstrip('/'),
            headers=headers,
            params=params,
            json=payload,
            timeout=(5, _timeout()),
        )
    except requests.RequestException as exc:
        raise OpenEdXError('openedx_unavailable') from exc

    if response.status_code not in expected:
        raise OpenEdXError(f'openedx_http_{response.status_code}')
    if response.status_code == 204 or not response.content:
        return {}
    try:
        return response.json()
    except ValueError as exc:
        raise OpenEdXError('openedx_invalid_response') from exc


def health():
    if not getattr(settings, 'OPENEDX_ENABLED', False):
        return {'configured': False, 'reachable': False}
    try:
        response = requests.get(
            _base() + '/heartbeat',
            headers={'Host': _host()},
            timeout=(3, 8),
        )
        reachable = 200 <= response.status_code < 500
    except requests.RequestException:
        reachable = False
    result = {'configured': configured(), 'reachable': reachable}
    if configured() and reachable:
        try:
            _token_value()
            result['oauth'] = True
        except OpenEdXError:
            result['oauth'] = False
    return result


def course_details(course_key):
    return request(
        'GET',
        f'/api/enrollment/v1/course/{course_key}',
        authenticated=False,
        expected=(200,),
    )


def allow_enrollment(*, email, course_key):
    return request(
        'POST',
        '/api/enrollment/v1/enrollment_allowed/',
        payload={'email': str(email).strip().lower(), 'course_id': str(course_key)},
        expected=(200, 201),
    )


def enroll_by_email(*, email, course_key):
    """Enroll an existing Open edX account by e-mail.

    The allow-list call is still made first so an account provisioned later
    remains eligible. A missing Open edX account is represented explicitly
    instead of turning Gravitas enrollment into a hard failure.
    """
    headers = {
        'Host': _host(),
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': f'JWT {_token_value()}',
    }
    try:
        response = requests.post(
            _base() + '/api/enrollment/v1/enrollment',
            headers=headers,
            json={
                'email': str(email).strip().lower(),
                'course_details': {'course_id': str(course_key)},
                'is_active': True,
            },
            timeout=(5, _timeout()),
        )
    except requests.RequestException as exc:
        raise OpenEdXError('openedx_unavailable') from exc
    if response.status_code == 406:
        raise OpenEdXError('openedx_account_pending')
    if response.status_code not in {200, 201}:
        raise OpenEdXError(f'openedx_http_{response.status_code}')
    try:
        return response.json()
    except ValueError:
        return {}


def enrollment_rows(*, email=None, course_key=None):
    params = {'page_size': 100}
    if email:
        params['email'] = str(email).strip().lower()
    if course_key:
        params['course_id'] = str(course_key)
    data = request('GET', '/api/enrollment/v1/enrollments', params=params, expected=(200,))
    if isinstance(data, dict):
        return data.get('results') or []
    return data if isinstance(data, list) else []
