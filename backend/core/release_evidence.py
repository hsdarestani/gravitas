"""Read-only evidence from fixed release targets. No workflow dispatch access."""
import json
from pathlib import Path
import re

import requests
from django.conf import settings


REPO = 'hsdarestani/gravitas'
WORKFLOW = '.github/workflows/platform-ci.yml'


def public_json(url):
    try:
        response = requests.get(url, timeout=(2, 3), allow_redirects=False,
                                headers={'Accept': 'application/json'})
        return response.json() if response.status_code == 200 else None
    except (requests.RequestException, ValueError):
        return None


def verified_ci(run_id, revision):
    if type(run_id) is not int or not 0 < run_id < 10**18 or not re.fullmatch('[a-f0-9]{40}', revision):
        raise ValueError('exact_commit_ci_required')
    row = public_json(f'https://api.github.com/repos/{REPO}/actions/runs/{run_id}')
    if not isinstance(row, dict) or (
        row.get('repository', {}).get('full_name') != REPO
        or row.get('head_repository', {}).get('full_name') != REPO
        or row.get('head_sha') != revision
        or row.get('path', '').split('@')[0] != WORKFLOW
        or row.get('status') != 'completed'
        or row.get('conclusion') != 'success'
    ):
        raise ValueError('exact_commit_ci_not_verified')
    return {'run_id': run_id, 'sha': revision}


def staging_metadata():
    state = getattr(settings, 'STAGING_STATE', None)
    if state is None:
        return None
    try:
        value = json.loads((Path(state) / 'release.json').read_text())
        revision = value['revision']
        if not re.fullmatch('[a-f0-9]{40}', revision):
            return None
        return {'revision': revision, 'deployed_at': value.get('deployed_at')}
    except (OSError, ValueError, TypeError, KeyError):
        return None


def health(environment):
    origin = 'https://staging.graviquest.com' if environment == 'staging' else 'https://graviquest.com'
    row = public_json(origin + '/api/health/')
    return ('healthy' if isinstance(row, dict) and row.get('status') == row.get('database') == 'ok'
            else 'unverified')
