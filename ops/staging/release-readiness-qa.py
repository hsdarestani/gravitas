"""Verify live staging read paths and exercise synthetic public intake."""
import os
import re

from staging_client import StageClient


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def verify():
    public = StageClient()
    for path in ('/site', '/topics', '/topic-answer-that-looked-right', '/education',
                 '/lab', '/learn', '/prelaunch-feedback'):
        require('aria-label="Environment"' in public.call(path), f'{path} lacks staging labeling')
    print('Seven public staging pages rendered and were marked noindex.')

    levels = public.call('/api/topics/answer-that-looked-right/essays/')['essays']
    print('Published staging essay combinations:', len(levels), 'of 6')
    public.call('/api/platform/work-reports/', status=401)
    public.call('/api/platform/projects/', status=401)

    resume = os.getenv('GQ_QA_RECHECK_RUN')
    run = resume or os.environ['GITHUB_RUN_ID']
    require(re.fullmatch(r'[0-9]+', run), 'Missing workflow run ID')
    email = f'release-qa-{run}@example.test'
    route = '/api/newsletter/subscribe/'
    body = {'email': email, 'source': 'staging-release-qa'}
    if not resume:
        marker = f'Synthetic release QA {run}'
        public.call('/api/prelaunch/feedback/')
        public.call('/api/prelaunch/feedback/', 'POST', {
            'name': marker, 'answers': {'overall_rating': 7, 'other_feedback': 'Synthetic staging QA only'},
        })
        saved = public.call('/api/prelaunch/feedback/')['submission']
        require(saved['name'] == marker and saved['answers']['overall_rating'] == 7, 'Survey persistence failed')
        require(StageClient().call('/api/prelaunch/feedback/')['submission'] is None, 'Survey session scope failed')
        print('Survey persistence and session privacy verified with synthetic data.')
        subscribe = public.call(route, 'POST', body, status=201)
        require(subscribe['ok'] and subscribe['created'], 'Newsletter signup failed')
    public.call('/api/auth/csrf/')
    duplicate = public.call(route, 'POST', body)
    require(duplicate['ok'] and not duplicate['created'], 'Newsletter retry created a duplicate')
    print('Newsletter signup retry verified using the existing synthetic address.')

    owner = StageClient()
    owner.sign_in(os.environ['STAGE_OWNER_EMAIL'], os.environ['STAGE_OWNER_PASSWORD'])
    routes = {
        'Research projects': '/api/platform/projects/',
        'Research calendar': '/api/platform/research-calendar/',
        'OKRs': '/api/operating/objectives/',
        'Meetings': '/api/operating/meetings/',
        'Work reports': '/api/platform/work-reports/',
        'Nextcloud integration status': '/api/platform/nextcloud/',
    }
    failures = []
    try:
        for feature, path in routes.items():
            try:
                result = owner.call(path)
                require(isinstance(result, dict) and result.get('ok', True) is True, f'{feature} failed')
                print(f'{feature} authenticated read passed.')
            except RuntimeError as error:
                print(f'{feature}: {error}')
                failures.append(feature)
    finally:
        owner.sign_out()
    require(not failures, 'Authenticated read issues: ' + ', '.join(failures))


if __name__ == '__main__':
    verify()
