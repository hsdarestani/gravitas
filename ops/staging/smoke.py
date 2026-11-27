"""Probe the staging origin and optionally verify an HTTPS Core owner session."""
from http.cookiejar import CookieJar
import json
import os
import sys
from urllib.error import HTTPError
from urllib.request import (
    HTTPCookieProcessor, HTTPRedirectHandler, Request, build_opener,
)

ORIGIN = 'https://staging.graviquest.com'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def health():
    client = build_opener(NoRedirect())
    for path, keys in (
        ('/api/health/', {'status': 'ok', 'database': 'ok'}),
        ('/nextcloud/status.php', {'installed': True, 'maintenance': False}),
    ):
        with client.open(ORIGIN + path, timeout=20) as response:
            data = json.load(response)
            if any(data.get(k) != v for k, v in keys.items()):
                raise RuntimeError(f'{path} unhealthy')
            if 'noindex' not in response.headers.get('X-Robots-Tag', '').lower():
                raise RuntimeError(f'{path} noindex missing')
    print('Staging health and Nextcloud verified')


def platform_routes():
    client = build_opener(NoRedirect())
    for path in ('/', '/site', '/lab', '/education', '/topics', '/forum', '/prelaunch-feedback'):
        with client.open(ORIGIN + path, timeout=20) as response:
            if response.status != 200 or 'noindex' not in response.headers.get('X-Robots-Tag', '').lower():
                raise RuntimeError(f'{path} is unavailable or indexable')
            page = response.read().decode()
            if 'aria-label="Environment"' not in page:
                raise RuntimeError(f'{path} lacks staging identification')
            if path == '/forum' and 'https://forum.graviquest.com' in page:
                raise RuntimeError('staging forum routes to production')
    with client.open(ORIGIN + '/robots.txt', timeout=20) as response:
        if b'Disallow: /' not in response.read():
            raise RuntimeError('robots.txt does not disallow indexing')
    for path in ('/api/staging/release/', '/api/platform/team/'):
        try:
            with client.open(ORIGIN + path, timeout=20):
                raise RuntimeError(f'{path} is open without authentication')
        except HTTPError as error:
            if error.code != 401:
                raise
    print('Staging public routes, banner, noindex and authenticated access boundaries verified')


def owner_access():
    cookies = CookieJar()
    session = build_opener(NoRedirect(), HTTPCookieProcessor(cookies))

    def get(path):
        return session.open(ORIGIN + path, timeout=20)

    def post(path, data):
        csrf = next(cookie.value for cookie in cookies if cookie.name == 'gravitas_staging_csrftoken')
        request = Request(ORIGIN + path, json.dumps(data).encode(), {
            'Origin': ORIGIN, 'Referer': ORIGIN + '/login', 'X-CSRFToken': csrf,
            'Content-Type': 'application/json',
        })
        return session.open(request, timeout=20)

    with get('/api/auth/csrf/'):
        pass
    with post('/api/auth/login/', {
        'email': os.environ['STAGE_OWNER_EMAIL'],
        'password': os.environ['STAGE_OWNER_PASSWORD'],
        'keep': False,
    }) as response:
        if not json.load(response).get('ok'):
            raise RuntimeError('staging sign-in failed')
    if not any(c.name == 'gravitas_staging_sessionid' and c.secure and not c.domain_specified for c in cookies):
        raise RuntimeError('staging session cookie is not isolated')
    with get('/api/platform/team/'):
        pass
    if revision := os.getenv('STAGE_EXPECTED_REVISION'):
        with get('/api/staging/release/') as response:
            if json.load(response).get('revision') != revision:
                raise RuntimeError('authenticated release metadata does not match the selected revision')
    with post('/api/auth/logout/', {}):
        pass
    print('Named staging owner sign-in, session scope and Team access verified')


if __name__ == '__main__':
    try:
        health()
        if '--platform' in sys.argv:
            platform_routes()
        if '--owner' in sys.argv:
            owner_access()
    except HTTPError as exc:
        raise SystemExit(f'Staging probe returned HTTP {exc.code}') from None
