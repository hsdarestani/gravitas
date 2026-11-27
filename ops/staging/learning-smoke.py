"""Exercise real enrollment and lesson progress on the staging native LMS."""

from contextlib import ExitStack
import os
import re
import secrets

from staging_client import StageClient


def verify():
    execution = f'{os.environ["GITHUB_RUN_ID"]}-{os.environ["GITHUB_RUN_ATTEMPT"]}'
    if not re.fullmatch(r'[1-9][0-9]*-[1-9][0-9]*', execution):
        raise RuntimeError('staging test run identity required')
    slug = 'synthetic-staging-learning-' + execution
    email = f'{slug}@example.test'
    password = secrets.token_urlsafe(24)
    owner, learner, public = StageClient(), StageClient(), StageClient()
    owner.sign_in(os.environ['STAGE_OWNER_EMAIL'], os.environ['STAGE_OWNER_PASSWORD'])
    courses = '/api/lms/courses/'
    team = '/api/platform/team/'
    with ExitStack() as cleanup:
        cleanup.callback(owner.sign_out)
        user = owner.call(team, 'POST', {
            'email': email, 'name': 'Synthetic staging learner', 'role': 'member',
            'password': password, 'send_setup': False,
        }, status=201)
        if not user['created_user'] or user['email_sent']:
            raise RuntimeError('test identity was not newly created without delivery')
        cleanup.callback(owner.call, f'{team}{int(user["member"]["id"])}/', 'PATCH', {'is_active': False})
        learner.sign_in(email, password)
        cleanup.callback(learner.sign_out)
        learner.call(team, status=403)
        course = owner.call(courses, 'POST', {
            'slug': slug, 'title': 'Synthetic staging QA course', 'status': 'draft',
            'access_type': 'open', 'provider': 'native', 'certificate_enabled': False,
            'modules': [{'title':'Synthetic module', 'lessons': [
                {'title':'Synthetic lesson', 'body':'Staging-only example.', 'kind':'article',
                 'published': True, 'is_required': True},
            ]}],
        }, status=201)['course']
        detail = f'{courses}{int(course["id"])}/'
        public.call(detail, status=404)

        def archive():
            state = owner.call(detail, 'PATCH', {'status': 'archived'})
            if state.get('staged'):
                owner.call(detail + 'revision/publish/', 'POST', {'action': 'publish_now'})

        cleanup.callback(archive)
        course = owner.call(detail, 'PATCH', {'status': 'published'})['course']
        public.call(detail)
        lesson = course['modules'][0]['lessons'][0]
        progress = f'/api/lms/lessons/{int(lesson["id"])}/progress/'
        learner.call(progress, 'PUT', {'completed': True}, status=403)
        learner.call(detail + 'enroll/', 'POST', {}, status=201)
        check = learner.call(progress, 'PUT', {'completed': True})
        if not check['progress']['completed'] or check['enrollment']['status'] != 'completed':
            raise RuntimeError('native course completion was not recorded')
        loaded = learner.call('/api/lms/me/')
        if not any(item['id'] == check['enrollment']['id'] and item['status'] == 'completed'
                   for item in loaded['enrollments']):
            raise RuntimeError('native course completion did not persist')
    public.call(detail, status=404)
    print('Verified native course draft privacy, publication, denied pre-enrollment progress, enrollment and completion from a synthetic staging account.')
    print('Archived the synthetic course and deactivated the staging-only learner account.')


if __name__ == '__main__':
    verify()
