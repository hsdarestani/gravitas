"""Live staging-only CMS and Lab publishing test with synthetic drafts."""

from contextlib import ExitStack
from http.cookiejar import CookieJar
import json
import os
import re
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

from smoke import NoRedirect, ORIGIN, health


def response(client, path, *, method='GET', data=None, csrf=None, expect=200):
    headers = {'Accept': 'application/json', 'Referer': ORIGIN + '/login'}
    if csrf:
        headers.update({'Origin': ORIGIN, 'X-CSRFToken': csrf, 'Content-Type': 'application/json'})
    body = json.dumps(data).encode() if data is not None else None
    try:
        result = client.open(Request(ORIGIN + path, body, headers, method=method), timeout=20)
    except HTTPError as error:
        result = error
    with result:
        if result.status != expect:
            raise RuntimeError(f'{method} {path} returned {result.status}, expected {expect}')
        if 'noindex' not in result.headers.get('X-Robots-Tag', '').lower():
            raise RuntimeError(f'{path} omitted staging noindex')
        if result.headers.get_content_type() == 'application/json':
            return json.load(result)
        return result.read().decode()


def verify():
    health()
    run = os.environ['GITHUB_RUN_ID']
    attempt = os.environ['GITHUB_RUN_ATTEMPT']
    if not re.fullmatch(r'[1-9][0-9]*', run + attempt):
        raise RuntimeError('invalid workflow execution')
    slug = f'synthetic-staging-platform-{run}-{attempt}'
    cookiejar = CookieJar()
    owner = build_opener(NoRedirect(), HTTPCookieProcessor(cookiejar))
    public = build_opener(NoRedirect())

    def owner_api(path, method='GET', data=None, expect=200):
        token = next((c.value for c in cookiejar if c.name == 'gravitas_staging_csrftoken'), None)
        return response(owner, path, method=method, data=data, csrf=token, expect=expect)

    owner_api('/api/auth/csrf/')
    if not owner_api('/api/auth/login/', 'POST', {
        'email': os.environ['STAGE_OWNER_EMAIL'], 'password': os.environ['STAGE_OWNER_PASSWORD'], 'keep': False,
    })['ok']:
        raise RuntimeError('staging owner sign-in failed')
    if not any(c.name == 'gravitas_staging_sessionid' and c.secure and not c.domain_specified for c in cookiejar):
        raise RuntimeError('staging session cookie is not isolated')

    with ExitStack() as cleanup:
        cleanup.callback(owner_api, '/api/auth/logout/', 'POST', {})
        cms = '/api/platform/admin/site/content/'
        draft = owner_api(cms, 'POST', {
            'slug': slug, 'title': 'Synthetic staging QA topic', 'status': 'draft', 'kind': 'topic',
            'summary': 'Synthetic editorial example', 'body': 'Synthetic editorial publication proof.',
        }, expect=201)['item']
        item = f'{cms}{int(draft["id"])}/'
        cleanup.callback(owner_api, item, 'PATCH', {'status': 'draft'})
        response(public, f'/api/content/{slug}/', expect=404)
        response(public, cms, expect=401)
        owner_api(item, 'PATCH', {'status': 'published'})
        article = response(public, f'/content/{slug}/')
        if 'Synthetic editorial publication proof.' not in article:
            raise RuntimeError('published staging content missing')
        print('CMS draft privacy, publish and public render verified.')

        labs = '/api/platform/admin/labs/'

        def files(revision):
            return [{'name': 'index.html', 'content':
                     f'<!doctype html><html lang="en"><title>Staging lab</title>'
                     f'<main><h1>Synthetic staging Lab {revision}</h1></main></html>'}]

        lab = owner_api(labs, 'POST', {
            'slug': slug, 'title': 'Synthetic staging QA Lab', 'files': files('one'),
            'config': {'components': ['stage', 'controls', 'metrics'], 'pulsar_enabled': False},
        }, expect=201)['lab']
        lab_path = f'{labs}{int(lab["id"])}/'
        cleanup.callback(owner_api, lab_path + 'unpublish/', 'POST', {})
        run_path = f'/lab-run/{slug}/'
        response(public, run_path, expect=404)
        preview = owner_api(lab_path + 'preview/')
        if 'Synthetic staging Lab one' not in preview:
            raise RuntimeError('staging Lab draft preview is missing')
        owner_api(lab_path + 'publish/', 'POST', {'version': lab['version']})
        if 'Synthetic staging Lab one' not in response(public, run_path):
            raise RuntimeError('first staging Lab release is missing')
        changed = owner_api(lab_path, 'PATCH', {'version': lab['version'], 'files': files('two')})['lab']
        if 'Synthetic staging Lab one' not in response(public, run_path):
            raise RuntimeError('an editable draft changed the published staging Lab')
        owner_api(lab_path + 'publish/', 'POST', {'version': changed['version']})
        if 'Synthetic staging Lab two' not in response(public, run_path):
            raise RuntimeError('updated staging Lab release is missing')
        restored = owner_api(lab_path + 'revisions/', 'POST', {
            'version': changed['version'], 'restore_version': lab['version'],
        })['lab']
        owner_api(lab_path + 'publish/', 'POST', {'version': restored['version']})
        if 'Synthetic staging Lab one' not in response(public, run_path):
            raise RuntimeError('restored staging Lab release is missing')
        print('Lab Studio draft preview, publication, snapshot isolation and version restore verified.')
    response(public, f'/api/content/{slug}/', expect=404)
    response(public, f'/lab-run/{slug}/', expect=404)
    print(f'Synthetic QA records remain private under {slug}.')


if __name__ == '__main__':
    verify()
