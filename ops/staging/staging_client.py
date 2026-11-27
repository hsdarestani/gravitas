"""HTTP client for staging-only acceptance scripts."""

from http.cookiejar import CookieJar
import json
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

from smoke import NoRedirect, ORIGIN


class StageClient:
    def __init__(self):
        self.cookies = CookieJar()
        self.opener = build_opener(NoRedirect(), HTTPCookieProcessor(self.cookies))

    def call(self, path, method='GET', data=None, *, status=200):
        if not path.startswith('/') or path.startswith('//'):
            raise ValueError('staging relative path required')
        headers = {'Accept': 'application/json'}
        payload = None
        if method != 'GET':
            token = next(cookie.value for cookie in self.cookies if cookie.name == 'gravitas_staging_csrftoken')
            headers.update({
                'Origin': ORIGIN, 'Referer': ORIGIN + '/login', 'Content-Type': 'application/json',
                'X-CSRFToken': token,
            })
            payload = json.dumps(data).encode()
        try:
            result = self.opener.open(Request(ORIGIN + path, payload, headers, method=method), timeout=20)
        except HTTPError as error:
            result = error
        with result:
            if result.status != status or 'noindex' not in result.headers.get('X-Robots-Tag', '').lower():
                raise RuntimeError(f'{method} {path} returned {result.status}, expected staging HTTP {status}')
            if result.headers.get_content_type() == 'application/json':
                return json.load(result)
            return result.read().decode()

    def sign_in(self, email, password):
        self.call('/api/auth/csrf/')
        body = self.call('/api/auth/login/', 'POST', {'email': email, 'password': password, 'keep': False})
        if not body['ok'] or not any(
            c.name == 'gravitas_staging_sessionid' and c.secure and not c.domain_specified for c in self.cookies
        ):
            raise RuntimeError('staging sign-in or cookie isolation failed')

    def sign_out(self):
        self.call('/api/auth/logout/', 'POST', {})
