#!/usr/bin/env bash
set -euo pipefail

revision=8a008862d0ad6f72abd1cba95d368a5b88bc9595
service=gravitas-workspace-staging
config=/etc/gravitas-workspace-staging
release=/opt/gravitas-workspace-staging/releases/$revision
test "$(id -u)" -eq 0
test "$(cat "$config/created-by")" = "$service"
test "$(git -C "$release/source" rev-parse HEAD)" = "$revision"
systemctl is-active --quiet "$service"

systemd-run --quiet --wait --pipe --collect --unit "$service-acceptance" \
  -p User=gq-workspace-stage -p "EnvironmentFile=$config/application.env" \
  -p "WorkingDirectory=$release/source/backend" -p MemoryMax=384M -p CPUQuota=50% \
  "$release/venv/bin/python" - <<'PY'
import datetime
import secrets
import uuid

import django
import requests

django.setup()

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile

from core import cloud
from core.layer_models import CommunityProfile, ModuleGrant
from core.models import WorkspaceMembership
from core.platform_runtime_v3 import ensure_platform_workspaces

domain = 'staging.graviquest.com'
origin = f'https://{domain}'
loopback = 'http://127.0.0.1:18000'
studio = '/api/workspace-v2/'
board = '/api/operating/task-board/'
assert settings.WORKSPACE_STUDIO_ENABLED
assert settings.ALLOWED_HOSTS == [domain]
assert settings.DATABASES['default']['PORT'] == '15432'
assert settings.DATABASES['default']['NAME'] == 'gravitas_workspace_staging'
assert settings.NEXTCLOUD_INTERNAL_URL == 'http://127.0.0.1:18081'


class Client:
    def __init__(self):
        self.cookies = {}
        self.session = requests.Session()
        self.session.trust_env = False

    def call(self, method, path, status=200, **kwargs):
        headers = {'Host': domain, 'Origin': origin, 'X-Forwarded-Proto': 'https'}
        if self.cookies:
            headers['Cookie'] = '; '.join(f'{key}={value}' for key, value in self.cookies.items())
        if settings.CSRF_COOKIE_NAME in self.cookies:
            headers['X-CSRFToken'] = self.cookies[settings.CSRF_COOKIE_NAME]
        response = self.session.request(method, loopback + path, headers=headers, timeout=20,
                                        allow_redirects=False, **kwargs)
        for key in (settings.CSRF_COOKIE_NAME, settings.SESSION_COOKIE_NAME):
            if key in response.cookies:
                self.cookies[key] = response.cookies[key]
        if response.status_code != status:
            error = None
            if 'application/json' in response.headers.get('Content-Type', ''):
                error = response.json().get('error')
            raise RuntimeError(f'{method} {path}: expected {status}, got {response.status_code} ({error})')
        return response

    def login(self, user, password):
        self.call('GET', '/api/auth/csrf/')
        response = self.call('POST', '/api/auth/login/', json={'email': user.email, 'password': password})
        assert response.json()['ok']
        assert response.cookies.get(settings.SESSION_COOKIE_NAME)
        cookie = next(item for item in response.cookies if item.name == settings.SESSION_COOKIE_NAME)
        assert cookie.secure and cookie.domain == domain and not cookie.domain_specified

    def state(self):
        return self.call('GET', studio + 'state/').json()


def fixture_user(role):
    email = f'workspace-staging-qa-{role}@example.test'
    user, _ = get_user_model().objects.get_or_create(username=email, defaults={'email': email})
    password = secrets.token_urlsafe(36)
    user.set_password(password)
    user.save(update_fields=['password'])
    CommunityProfile.objects.update_or_create(user=user, defaults={'email_verification_required': False})
    client = Client()
    client.login(user, password)
    return user, client


anonymous = Client()
assert b'/assets/workspace-v2/workspace.js' in anonymous.call('GET', '/workspace-v2').content
anonymous.call('GET', studio + 'state/', 401)
owner, owner_client = fixture_user('owner')
member, member_client = fixture_user('member')
researcher, research_client = fixture_user('research')
spaces = ensure_platform_workspaces(owner)
for user, role in ((owner, WorkspaceMembership.Role.OWNER), (member, WorkspaceMembership.Role.MEMBER)):
    WorkspaceMembership.objects.update_or_create(workspace=spaces['core'], user=user, defaults={'role': role})
ModuleGrant.objects.update_or_create(user=researcher, module=ModuleGrant.Module.RESEARCH, defaults={'enabled': True})
assert owner_client.state()['actor']['id'] == owner.pk
assert member_client.state()['actor']['id'] == member.pk
research_client.call('GET', studio + 'state/', 403)
print('acceptance_staging_auth_and_roles=pass', flush=True)

run = uuid.uuid4().hex[:8]
project_data = {'action': 'create', 'title': f'Staging QA {run}', 'owner_id': owner.pk,
                'start_date': datetime.date.today().isoformat()}
member_client.call('POST', studio + 'projects/', 403, json=project_data)
project = owner_client.call('POST', studio + 'projects/', 201, json=project_data).json()['id']
task_data = {'title': 'Staging canonical task', 'definition_of_done': 'Evidence verified',
             'project_id': project, 'owner_id': owner.pk, 'status': 'ready',
             'client_create_id': str(uuid.uuid4()), 'duration_days': 2}
task = owner_client.call('POST', studio + 'tasks/', 201, json=task_data).json()['id']
v1_url = board + f'{task}/'
assert owner_client.call('GET', v1_url).json()['task']['title'] == task_data['title']
owner_client.call('PATCH', v1_url, json={'title': 'Staging canonical task edited from V1'})
entry = next(row for row in owner_client.state()['tasks'] if row['id'] == task)
assert entry['title'] == 'Staging canonical task edited from V1'

from core.operating_models import OperatingTask, TaskInAppNotification


def patch_task(**fields):
    expected = OperatingTask.objects.only('updated_at').get(pk=task).updated_at.isoformat()
    return owner_client.call('PATCH', studio + f'tasks/{task}/', json={**fields, 'expected_updated_at': expected})


patch_task(title='Staging canonical task edited from V2', contributor_ids=[member.pk])
patch_task(contributor_ids=[member.pk])
assert owner_client.call('GET', v1_url).json()['task']['title'] == 'Staging canonical task edited from V2'
notice = TaskInAppNotification.objects.get(task_id=task, recipient=member, event_type='task.contributor_assigned')
assert notice.pk in {notification['id'] for notification in member_client.state()['notifications']}
print('acceptance_canonical_v1_v2_and_assignment_notification=pass', flush=True)

template_data = {'project_id': project, 'name': f'Staging template {run}'}
old_snapshot = owner_client.call('POST', studio + 'templates/', 201, json=template_data).json()
template = next(row for row in owner_client.state()['saved_templates'] if row['id'] == old_snapshot['id'])
patch_task(title='Second template revision')
change = {**template_data, 'template_id': template['templateId'], 'expected_revision': 1}
owner_client.call('POST', studio + 'templates/', json=change)
owner_client.call('POST', studio + 'templates/', 409, json=change)
version = studio + f"templates/{template['templateId']}/revisions/1/"
assert owner_client.call('GET', version).json()['template']['tasks'][0]['title'] == 'Staging canonical task edited from V2'
member_client.call('GET', version, 404)
old_project = owner_client.call('POST', studio + 'projects/', 201,
                                json={**project_data, 'title': f'Staging historical snapshot {run}',
                                      'template': old_snapshot['id'], 'duration': 2}).json()['id']
assert OperatingTask.objects.get(project_id=old_project).title == 'Staging canonical task edited from V2'
print('acceptance_staging_template_revisions=pass', flush=True)

workflow_url = studio + f'tasks/{task}/workflow/'
canonical_workflow = f'/api/operating/tasks/{task}/workflow/'
workflow = owner_client.call('POST', workflow_url,
                             json={'action': 'install', 'workflow': {'template': 'development'}}).json()['workflow']


def workflow_action(client, action, **fields):
    return client.call('POST', workflow_url,
                       json={'action': action, 'revision': workflow['revision'], **fields}).json()['workflow']


workflow = workflow_action(owner_client, 'assign_reviewers', reviewers={'1': member.pk, 'final': member.pk})
for step in workflow['steps']:
    workflow = workflow_action(owner_client, 'complete_step', step=step['id'])
for part in workflow['parts']:
    workflow = workflow_action(owner_client, 'submit', part=part['id'], iteration=1,
                               items=[{**row, 'done': True} for row in part['iterations'][0]['items']],
                               preview=origin + '/workspace-v2')
assert 'task.qa_submit' in [n['event_type'] for n in member_client.state()['notifications']]
denied = owner_client.call('POST', canonical_workflow, 403,
                           json={'action': 'approve', 'revision': workflow['revision'], 'part': 1, 'iteration': 1})
assert denied.json()['error'] == 'workflow_assigned_reviewer_required'
workflow = workflow_action(member_client, 'request_changes', part=1, iteration=1, feedback='Update staging evidence.')
original, correction = workflow['parts'][0]['iterations']
assert original['status'] == 'changes_requested' and correction['number'] == 2
assert 'task.qa_request_changes' in [n['event_type'] for n in owner_client.state()['notifications']]
workflow = workflow_action(owner_client, 'submit', part=1, iteration=2,
                           items=[{**row, 'done': True} for row in correction['items']],
                           preview=origin + '/workspace-v2?qa=2')
for part in workflow['parts']:
    workflow = workflow_action(member_client, 'approve', part=part['id'], iteration=part['iterations'][-1]['number'])
workflow = workflow_action(member_client, 'finalize')
canonical = member_client.call('GET', canonical_workflow).json()['workflow']
assert canonical['parts'][0]['iterations'][-1]['number'] == 2
assert canonical['final_approval']['by']['id'] == member.pk
print('acceptance_staging_review_correction_and_canonical_history=pass', flush=True)

try:
    owner_cloud = cloud.ensure_identity(owner, 50 * 1024 * 1024)
    other_cloud = cloud.ensure_identity(researcher, 50 * 1024 * 1024)
    first_bytes = b'Workspace V2 native Nextcloud staging QA\n'
    path = f'Staging-QA-{run}/evidence.txt'
    cloud.upload(owner_cloud, path, SimpleUploadedFile('evidence.txt', first_bytes, content_type='text/plain'))
    with cloud.download(owner_cloud, path) as response:
        assert response.content == first_bytes
    missing = cloud._request('GET', cloud._dav_url(owner_cloud, path), auth=cloud._auth(other_cloud),
                             expected={403, 404})
    assert missing.status_code in (403, 404)
except cloud.CloudError:
    raise RuntimeError('Native Nextcloud storage acceptance failed') from None
print('acceptance_native_nextcloud_upload_bytes_and_denial=pass', flush=True)
PY
