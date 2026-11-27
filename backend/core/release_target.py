"""Release Center client for the separately configured loopback rehearsal only."""
import re

import requests
from django.conf import settings


class TargetError(Exception):
    pass


def enabled():
    token = getattr(settings, 'ISOLATED_RELEASE_TOKEN', '')
    return bool(settings.RELEASE_CENTER_ENABLED and re.fullmatch(r'[A-Za-z0-9_-]{32,256}', token))


def execute(operation, key, expected, revision):
    token = settings.ISOLATED_RELEASE_TOKEN
    url = f'http://127.0.0.1:{getattr(settings, "ISOLATED_RELEASE_PORT", 18120)}'
    target = 'isolated-production-rehearsal'
    try:
        with requests.Session() as session:
            session.trust_env = False
            session.headers['Authorization'] = f'Bearer {token}'
            response = session.post(url + '/release', timeout=(1, 4), allow_redirects=False,
                                    json=dict(operation=operation, key=key, expected=expected, revision=revision))
            if response.status_code == 409:
                raise TargetError('isolated_release_conflict')
            if response.status_code != 200:
                raise TargetError('isolated_release_target_unavailable')
            result = response.json()
            health = session.get(url + '/health', timeout=(1, 4), allow_redirects=False)
            digest = result.get('digest', '')
            if (result != dict(target=target, operation=operation, key=key, revision=revision, previous=expected,
                               digest=digest) or not re.fullmatch(r'[0-9a-f]{64}', digest)
                    or health.status_code != 200 or health.json() != dict(target=target, revision=revision, digest=digest)):
                raise TargetError('isolated_release_readback_failed')
            return result
    except (requests.RequestException, ValueError, TypeError, AttributeError) as exc:
        raise TargetError('isolated_release_target_unavailable') from exc
