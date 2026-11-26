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
import re
import secrets
import time
import uuid
from urllib.parse import urlsplit
from xml.etree import ElementTree

import django
import requests

django.setup()

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile

from core import cloud
from core.layer_models import CommunityProfile, ModuleGrant
from core.models import ProjectMembership, WorkspaceMembership, WorkspaceStudioCanvas, WorkspaceStudioProject
from core.operating_models import OperatingTask, TaskInAppNotification
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
native_ok = False
phase = 'owner_identity'
try:
    quota = 512 * 1024 * 1024
    owner_cloud = cloud.ensure_identity(owner, quota)
    cloud.set_quota(owner_cloud, quota)
    phase = 'research_identity'
    other_cloud = cloud.ensure_identity(researcher, quota)
    cloud.set_quota(other_cloud, quota)
    first_bytes = b'Workspace V2 native Nextcloud staging QA\n'
    path = f'Staging-QA-{run}/evidence.txt'
    phase = 'owner_upload'
    cloud.upload(owner_cloud, path, SimpleUploadedFile('evidence.txt', first_bytes, content_type='text/plain'))
    phase = 'owner_download'
    with cloud.download(owner_cloud, path) as response:
        assert response.content == first_bytes
    phase = 'research_own_storage'
    assert cloud.path_exists(other_cloud, 'Gravitas')
    phase = 'foreign_attachment_denial'
    missing = cloud._request('GET', cloud._dav_url(owner_cloud, path), auth=cloud._auth(other_cloud),
                             expected={401, 403, 404})
    print(f'acceptance_native_nextcloud_upload_bytes_and_denial=pass status={missing.status_code}', flush=True)

    phase = 'native_revision_file_id'
    file_url = cloud._dav_url(owner_cloud, path)
    properties = b'<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>'
    response = cloud._request('PROPFIND', file_url, auth=cloud._auth(owner_cloud), expected={207},
                              headers={'Depth': '0', 'Content-Type': 'application/xml'}, data=properties)
    file_id = ElementTree.fromstring(response.content).findtext('.//{http://owncloud.org/ns}fileid')
    assert file_id and file_id.isdecimal()
    time.sleep(3)
    phase = 'native_revision_upload'
    second_bytes = b'Workspace V2 native Nextcloud revision two\n'
    cloud.upload(owner_cloud, path, SimpleUploadedFile('evidence.txt', second_bytes, content_type='text/plain'))
    phase = 'native_revision_listing'
    base = f'/remote.php/dav/versions/{owner_cloud.username}/versions/{file_id}/'
    response = cloud._request('PROPFIND', settings.NEXTCLOUD_INTERNAL_URL + base,
                              auth=cloud._auth(owner_cloud), expected={207}, headers={'Depth': '1'})
    entries = [urlsplit(element.text or '').path.removeprefix('/nextcloud')
               for element in ElementTree.fromstring(response.content).iter('{DAV:}href')]
    versions = [entry for entry in entries if entry.startswith(base) and entry[len(base):].strip('/').isdigit()]
    assert versions
    phase = 'native_revision_download'
    older = cloud._request('GET', settings.NEXTCLOUD_INTERNAL_URL + versions[0],
                           auth=cloud._auth(owner_cloud), expected={200})
    assert older.content == first_bytes
    with cloud.download(owner_cloud, path) as response:
        assert response.content == second_bytes
    native_ok = True
    print('acceptance_native_nextcloud_revision_bytes=pass', flush=True)
except (cloud.CloudError, AssertionError, ElementTree.ParseError) as exc:
    http_error = re.fullmatch(r'Cloud storage returned HTTP ([0-9]{3})', str(exc))
    detail = f'HTTP {http_error[1]}' if http_error else type(exc).__name__
    print(f'acceptance_native_nextcloud=failed phase={phase} reason={detail}', flush=True)

child = owner_client.call('POST', studio + 'projects/', 201,
                           json={**project_data, 'title': f'Staging nested project {run}'}).json()['id']
nested = owner_client.call('POST', studio + 'tasks/', 201,
                            json={**task_data, 'title': 'Nested handoff task',
                                  'client_create_id': str(uuid.uuid4())}).json()['id']
node = 'project-link-staging-child'
canvas = {'positions': {}, 'frames': [], 'groups': [], 'arrows': [], 'start_date': project_data['start_date'],
          'nodes': [{'id': node, 'targetProjectId': str(child), 'milestoneId': '', 'x': 190, 'y': 160}],
          'handoffs': [[node, str(nested)]],
          'loops': [{'id': 'nested-review', 'from': str(nested), 'to': str(nested),
                     'target': 1, 'count': 0, 'optional': False}]}
canvas_url = studio + f'projects/{project}/canvas/'
canvas_revision = WorkspaceStudioCanvas.objects.get(project_id=project).revision
owner_client.call('PATCH', canvas_url, json={'revision': canvas_revision, 'canvas': canvas})


def nested_status(status, expected=200):
    updated = OperatingTask.objects.only('updated_at').get(pk=nested).updated_at.isoformat()
    return owner_client.call('PATCH', studio + f'tasks/{nested}/', expected,
                             json={'status': status, 'expected_updated_at': updated}).json()


assert nested_status('active', 409)['error'] == 'project_handoff_incomplete'
child_url = studio + f'projects/{child}/'
child_revision = WorkspaceStudioProject.objects.get(project_id=child).revision
owner_client.call('PATCH', child_url, json={'action': 'report', 'revision': child_revision,
                                            'body': 'Nested staging work verified.'})
owner_client.call('PATCH', child_url, json={'action': 'done', 'revision': child_revision + 1})
nested_status('active')
assert nested_status('done', 409)['error'] == 'review_pass_required'
owner_client.call('POST', studio + f'projects/{project}/review/',
                  json={'revision': canvas_revision + 1, 'id': 'nested-review', 'findings': 'Verified in staging.'})
nested_status('done')
print('acceptance_staging_nested_handoff_and_review_loop=pass', flush=True)
if not native_ok:
    raise SystemExit(1)
PY
