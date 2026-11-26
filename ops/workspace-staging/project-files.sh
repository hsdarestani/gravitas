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

from core import cloud
from core.layer_models import CommunityProfile, ModuleGrant
from core.models import ResearchProject, WorkspaceMembership
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
        response = self.session.request(method, loopback + path, headers=headers, timeout=(5, 75),
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
attachment_name = 'staging-evidence.txt'
payload = b'GraviQuest attachment acceptance evidence\n'
item = owner_client.call('POST', studio + f'tasks/{task}/attachments/', 201,
                         files={'file': (attachment_name, payload, 'text/plain')}).json()['attachment']
attachment_url = studio + f"tasks/{task}/attachments/{item['id']}/"
assert owner_client.call('GET', attachment_url).content == payload
research_client.call('GET', attachment_url, 403)
print('acceptance_staging_task_attachment_bytes_and_acl=pass', flush=True)

project_api = f'/api/platform/projects/{project}/'
structure = project_api + 'structure/'
initial = owner_client.session.get(loopback + structure, headers={
    'Host': domain, 'Origin': origin, 'X-Forwarded-Proto': 'https',
    'Cookie': '; '.join(f'{key}={value}' for key, value in owner_client.cookies.items()),
}, timeout=(5, 35), allow_redirects=False)
print(f'workspace_new_project_storage_first_http={initial.status_code}', flush=True)
if initial.status_code == 503:
    if initial.json().get('error') == 'Cloud storage returned HTTP 404':
        print('workspace_new_project_storage_team_folder=unprovisioned', flush=True)
    owner_client.call('POST', project_api + 'nextcloud/sync/')
elif initial.status_code != 200:
    raise RuntimeError(f'Unexpected fresh-project storage status {initial.status_code}')

owner_client.call('POST', structure, data={'action': 'upload', 'path': attachment_name},
                  files={'file': (attachment_name, payload, 'text/plain')})
listing = owner_client.call('GET', structure).json()
record = next(row for row in listing['items'] if row['name'] == attachment_name)
assert record['file_id'].isdecimal()
assert listing['native_url'].startswith(origin + '/nextcloud/index.php/')
owner_cloud = cloud.ensure_identity(owner, 512 * 1024 * 1024)
path = cloud.project_mountpoint(ResearchProject.objects.get(pk=project)) + '/' + attachment_name
with cloud.download(owner_cloud, path) as response:
    assert response.content == payload
research_client.call('GET', structure, 403)
print('acceptance_staging_native_project_upload_and_exact_file_id=pass', flush=True)
PY
