import base64
import hashlib
import secrets
import tempfile
from pathlib import PurePosixPath
from urllib.parse import quote, urlencode
from xml.etree import ElementTree

import requests
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from .models import NextcloudIdentity


class CloudError(Exception):
    pass


NC_PERMISSION_READ = 1
NC_PERMISSION_UPDATE = 2
NC_PERMISSION_CREATE = 4
NC_PERMISSION_DELETE = 8
NC_PERMISSION_SHARE = 16
NC_PERMISSION_ALL = 31
ROLE_PERMISSION_MAP = {
    'view': NC_PERMISSION_READ,
    'comment': NC_PERMISSION_READ,
    'edit': NC_PERMISSION_READ | NC_PERMISSION_UPDATE | NC_PERMISSION_CREATE | NC_PERMISSION_DELETE,
    'manage': NC_PERMISSION_ALL,
}


def _fernet():
    key = hashlib.sha256(settings.SECRET_KEY.encode('utf-8')).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _encrypt(value):
    return _fernet().encrypt(value.encode('utf-8')).decode('ascii')


def _decrypt(value):
    try:
        return _fernet().decrypt(value.encode('ascii')).decode('utf-8')
    except InvalidToken as exc:
        raise CloudError('Stored cloud identity cannot be decrypted') from exc


def _admin_auth():
    username = settings.NEXTCLOUD_ADMIN_USER
    password = settings.NEXTCLOUD_ADMIN_PASSWORD
    if not username or not password:
        raise ImproperlyConfigured('Nextcloud service credentials are not configured')
    return username, password


def _request(method, url, *, auth, expected, **kwargs):
    try:
        response = requests.request(
            method,
            url,
            auth=auth,
            timeout=(settings.NEXTCLOUD_CONNECT_TIMEOUT, settings.NEXTCLOUD_READ_TIMEOUT),
            **kwargs,
        )
    except requests.RequestException as exc:
        raise CloudError('Cloud storage is temporarily unavailable') from exc
    if response.status_code not in expected:
        raise CloudError(f'Cloud storage returned HTTP {response.status_code}')
    return response


def _ocs_data(response, message='Invalid response from Nextcloud'):
    try:
        payload = response.json()['ocs']
        meta = payload.get('meta') or {}
        statuscode = int(meta.get('statuscode', 100))
        if statuscode not in {100, 200}:
            raise CloudError(str(meta.get('message') or message))
        return payload.get('data')
    except (KeyError, TypeError, ValueError, requests.JSONDecodeError) as exc:
        raise CloudError(message) from exc


def ensure_identity(user, quota_bytes):
    existing = NextcloudIdentity.objects.filter(user=user).first()
    if existing:
        return existing

    username = f'gravitas-u-{user.pk}'
    password = secrets.token_urlsafe(36)
    endpoint = f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v1.php/cloud/users'
    headers = {'OCS-APIRequest': 'true', 'Accept': 'application/json'}
    response = _request(
        'POST',
        endpoint,
        auth=_admin_auth(),
        expected={200, 201},
        headers=headers,
        data={'userid': username, 'password': password, 'displayName': user.get_full_name() or user.first_name or user.email},
    )
    try:
        meta = response.json()['ocs']['meta']
        ocs_code = int(meta['statuscode'])
        ocs_message = str(meta.get('message', ''))
    except (KeyError, TypeError, ValueError, requests.JSONDecodeError) as exc:
        raise CloudError('Invalid response from cloud provisioning') from exc
    if ocs_code != 100 and 'already exists' not in ocs_message.lower():
        raise CloudError('Could not provision private cloud storage')
    if ocs_code != 100:
        # A prior interrupted request may have created the cloud user but not the
        # Django mapping. Set a fresh password using the administrator API.
        response = _request(
            'PUT',
            f'{endpoint}/{quote(username, safe="")}',
            auth=_admin_auth(),
            expected={100, 200},
            headers=headers,
            data={'key': 'password', 'value': password},
        )
        if response.status_code == 200:
            _ocs_data(response, 'Could not recover cloud identity')

    identity = NextcloudIdentity.objects.create(
        user=user,
        username=username,
        encrypted_password=_encrypt(password),
    )
    set_quota(identity, quota_bytes)
    make_folder(identity, 'Gravitas')
    return identity


def set_quota(identity, quota_bytes):
    response = _request(
        'PUT',
        f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v1.php/cloud/users/{quote(identity.username, safe="")}',
        auth=_admin_auth(),
        expected={100, 200},
        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
        data={'key': 'quota', 'value': str(int(quota_bytes))},
    )
    if response.status_code == 200:
        _ocs_data(response, 'Could not apply cloud quota')


def delete_identity(identity):
    response = _request(
        'DELETE',
        f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v1.php/cloud/users/{quote(identity.username, safe="")}',
        auth=_admin_auth(),
        expected={200},
        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
    )
    try:
        if int(response.json()['ocs']['meta']['statuscode']) not in {100, 101}:
            raise CloudError('Could not delete cloud identity')
    except (KeyError, TypeError, ValueError, requests.JSONDecodeError) as exc:
        raise CloudError('Invalid response while deleting cloud identity') from exc


def _auth(identity):
    return identity.username, _decrypt(identity.encrypted_password)


def safe_relative_path(value):
    value = str(value or '').replace('\\', '/').strip('/')
    path = PurePosixPath(value)
    if not value or path.is_absolute() or '..' in path.parts or any('\x00' in part for part in path.parts):
        raise CloudError('Invalid storage path')
    return '/'.join(path.parts)


def safe_filename(value):
    name = PurePosixPath(str(value or '').replace('\\', '/')).name.strip()
    if not name or name in {'.', '..'} or '\x00' in name:
        raise CloudError('Invalid filename')
    return name[:240]


def resource_path(resource_id, filename):
    return f'Gravitas/resources/{int(resource_id)}/{safe_filename(filename)}'


def drive_path(folder_parts, filename=None):
    parts = ['Gravitas', 'My Files']
    parts.extend(safe_filename(part) for part in folder_parts if str(part).strip())
    if filename:
        parts.append(safe_filename(filename))
    return '/'.join(parts)


def project_mountpoint(project):
    # Stable and deliberately independent of project title so renaming a
    # research project never breaks Desktop/Mobile sync roots.
    return f'GRV-{int(project.pk):06d}'


def project_group_id(project):
    return f'gravitas-project-{int(project.pk):06d}'


def native_files_url(path=''):
    clean = str(path or '').strip('/')
    query = urlencode({'dir': '/' + clean}) if clean else ''
    return f'{settings.PUBLIC_BASE_URL}/nextcloud/index.php/apps/files/files' + (f'?{query}' if query else '')


def _dav_url(identity, path):
    clean = safe_relative_path(path)
    encoded = '/'.join(quote(part, safe='') for part in clean.split('/'))
    return f'{settings.NEXTCLOUD_INTERNAL_URL}/remote.php/dav/files/{quote(identity.username, safe="")}/{encoded}'


def _admin_dav_url(path):
    username, _password = _admin_auth()
    clean = safe_relative_path(path)
    encoded = '/'.join(quote(part, safe='') for part in clean.split('/'))
    return f'{settings.NEXTCLOUD_INTERNAL_URL}/remote.php/dav/files/{quote(username, safe="")}/{encoded}'


def make_folder(identity, path):
    clean = safe_relative_path(path)
    current = []
    for part in clean.split('/'):
        current.append(part)
        _request('MKCOL', _dav_url(identity, '/'.join(current)), auth=_auth(identity), expected={201, 405})


def upload(identity, path, uploaded_file):
    clean = safe_relative_path(path)
    parent = str(PurePosixPath(clean).parent)
    if parent and parent != '.':
        make_folder(identity, parent)
    uploaded_file.seek(0)
    _request(
        'PUT',
        _dav_url(identity, clean),
        auth=_auth(identity),
        expected={200, 201, 204},
        data=uploaded_file,
        headers={'Content-Type': uploaded_file.content_type or 'application/octet-stream'},
    )


def download(identity, path):
    return _request('GET', _dav_url(identity, path), auth=_auth(identity), expected={200}, stream=True)


def delete(identity, path):
    _request('DELETE', _dav_url(identity, path), auth=_auth(identity), expected={200, 204, 404})


def folder_is_empty(identity, path):
    response = _request(
        'PROPFIND',
        _dav_url(identity, path),
        auth=_auth(identity),
        expected={207, 404},
        headers={'Depth': '1'},
    )
    if response.status_code == 404:
        return True
    try:
        root = ElementTree.fromstring(response.content)
    except ElementTree.ParseError as exc:
        raise CloudError('Invalid cloud folder response') from exc
    responses = root.findall('{DAV:}response')
    return len(responses) <= 1


def path_exists(identity, path):
    response = _request(
        'PROPFIND',
        _dav_url(identity, path),
        auth=_auth(identity),
        expected={207, 404},
        headers={'Depth': '0'},
    )
    return response.status_code == 207


def move(identity, old_path, new_path):
    clean_new = safe_relative_path(new_path)
    clean_old = safe_relative_path(old_path)
    if clean_old == clean_new:
        return
    if path_exists(identity, clean_new):
        raise CloudError('Destination already exists')

    # Some reverse-proxied Nextcloud deployments hold WebDAV MOVE requests
    # until the upstream timeout. A bounded copy/delete has the same user-facing
    # semantics, keeps Overwrite=F behavior, and gives us a rollback point.
    upstream = download(identity, clean_old)
    try:
        with tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024) as copied:
            for chunk in upstream.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    copied.write(chunk)
            copied.seek(0)
            copied.content_type = upstream.headers.get('Content-Type', 'application/octet-stream')
            upload(identity, clean_new, copied)
    finally:
        upstream.close()
    try:
        delete(identity, clean_old)
    except CloudError:
        try:
            delete(identity, clean_new)
        except CloudError:
            pass
        raise


# ---------------------------------------------------------------------------
# Native Nextcloud / Team Folders bridge
# ---------------------------------------------------------------------------

def ensure_group(group_id):
    endpoint = f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v1.php/cloud/groups'
    headers = {'OCS-APIRequest': 'true', 'Accept': 'application/json'}
    existing = _request('GET', endpoint, auth=_admin_auth(), expected={200}, headers=headers)
    groups = (_ocs_data(existing, 'Could not list cloud groups') or {}).get('groups', [])
    if group_id in groups:
        return group_id
    response = _request('POST', endpoint, auth=_admin_auth(), expected={200}, headers=headers, data={'groupid': group_id})
    try:
        meta = response.json()['ocs']['meta']
        if int(meta.get('statuscode', 100)) not in {100, 102} and 'exist' not in str(meta.get('message', '')).lower():
            raise CloudError('Could not create project group')
    except (KeyError, TypeError, ValueError, requests.JSONDecodeError) as exc:
        raise CloudError('Invalid response while creating project group') from exc
    return group_id


def user_groups(username):
    response = _request(
        'GET',
        f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v1.php/cloud/users/{quote(username, safe="")}/groups',
        auth=_admin_auth(),
        expected={200},
        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
    )
    return (_ocs_data(response, 'Could not list user groups') or {}).get('groups', [])


def add_user_to_group(username, group_id):
    if group_id in user_groups(username):
        return
    response = _request(
        'POST',
        f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v1.php/cloud/users/{quote(username, safe="")}/groups',
        auth=_admin_auth(),
        expected={200},
        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
        data={'groupid': group_id},
    )
    _ocs_data(response, 'Could not add user to project group')


def remove_user_from_group(username, group_id):
    if group_id not in user_groups(username):
        return
    response = _request(
        'DELETE',
        f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v1.php/cloud/users/{quote(username, safe="")}/groups',
        auth=_admin_auth(),
        expected={200},
        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
        data={'groupid': group_id},
    )
    _ocs_data(response, 'Could not remove user from project group')


def list_team_folders():
    response = _request(
        'GET',
        f'{settings.NEXTCLOUD_INTERNAL_URL}/index.php/apps/groupfolders/folders',
        auth=_admin_auth(),
        expected={200},
        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
        params={'format': 'json'},
    )
    data = _ocs_data(response, 'Could not list Team Folders') or {}
    if isinstance(data, list):
        return data
    return list(data.values()) if isinstance(data, dict) else []


def ensure_team_folder(mountpoint, group_id):
    mountpoint = safe_filename(mountpoint)
    ensure_group(group_id)
    admin_username, _ = _admin_auth()
    add_user_to_group(admin_username, group_id)
    folders = list_team_folders()
    folder = next((item for item in folders if item.get('mount_point') == mountpoint), None)
    if folder is None:
        response = _request(
            'POST',
            f'{settings.NEXTCLOUD_INTERNAL_URL}/index.php/apps/groupfolders/folders',
            auth=_admin_auth(),
            expected={200},
            headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
            json={'mountpoint': mountpoint, 'acl_default_no_permission': False},
        )
        folder = _ocs_data(response, 'Could not create Team Folder')
    folder_id = int(folder['id'])
    group_details = folder.get('groups') or {}
    if group_id not in group_details:
        response = _request(
            'POST',
            f'{settings.NEXTCLOUD_INTERNAL_URL}/index.php/apps/groupfolders/folders/{folder_id}/groups',
            auth=_admin_auth(),
            expected={200},
            headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
            data={'group': group_id},
        )
        _ocs_data(response, 'Could not attach project group to Team Folder')
    # Project members can collaborate but cannot create arbitrary public shares
    # unless Gravitas explicitly grants that capability.
    response = _request(
        'POST',
        f'{settings.NEXTCLOUD_INTERNAL_URL}/index.php/apps/groupfolders/folders/{folder_id}/groups/{quote(group_id, safe="")}',
        auth=_admin_auth(),
        expected={200},
        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
        data={'permissions': NC_PERMISSION_READ | NC_PERMISSION_UPDATE | NC_PERMISSION_CREATE | NC_PERMISSION_DELETE},
    )
    _ocs_data(response, 'Could not configure Team Folder group permissions')
    response = _request(
        'POST',
        f'{settings.NEXTCLOUD_INTERNAL_URL}/index.php/apps/groupfolders/folders/{folder_id}/acl',
        auth=_admin_auth(),
        expected={200},
        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
        data={'acl': 1},
    )
    _ocs_data(response, 'Could not enable Team Folder advanced permissions')
    return {'id': folder_id, 'mount_point': mountpoint, 'group_id': group_id}


def set_team_folder_acl(mountpoint, relative_path, group_id, user_roles, visibility='specific'):
    """Replace the advanced ACL list for one path in a Team Folder.

    For ``specific``/``private`` access the project group is denied at the
    path and explicitly granted users receive the exact role translated to
    Nextcloud permissions. For inherited/project access the ACL list is cleared
    so Team Folders naturally inherit its parent rule.
    """
    mountpoint = safe_filename(mountpoint)
    relative_path = str(relative_path or '').strip('/')
    path = mountpoint + (f'/{relative_path}' if relative_path else '')
    rules = []
    if visibility in {'specific', 'private'}:
        rules.append(('group', group_id, group_id, 0))
        for username, role in sorted(user_roles.items()):
            permissions = ROLE_PERMISSION_MAP.get(role, NC_PERMISSION_READ)
            rules.append(('user', username, username, permissions))

    acl_xml = ''.join(
        '<nc:acl>'
        f'<nc:acl-mapping-type>{mapping_type}</nc:acl-mapping-type>'
        f'<nc:acl-mapping-id>{mapping_id}</nc:acl-mapping-id>'
        f'<nc:acl-mapping-display-name>{display}</nc:acl-mapping-display-name>'
        f'<nc:acl-mask>{NC_PERMISSION_ALL}</nc:acl-mask>'
        f'<nc:acl-permissions>{permissions}</nc:acl-permissions>'
        '</nc:acl>'
        for mapping_type, mapping_id, display, permissions in rules
    )
    body = (
        '<?xml version="1.0" encoding="utf-8" ?>'
        '<d:propertyupdate xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns">'
        '<d:set><d:prop><nc:acl-list>' + acl_xml + '</nc:acl-list></d:prop></d:set>'
        '</d:propertyupdate>'
    )
    _request(
        'PROPPATCH',
        _admin_dav_url(path),
        auth=_admin_auth(),
        expected={207},
        headers={'Content-Type': 'application/xml; charset=utf-8'},
        data=body.encode('utf-8'),
    )


def create_app_password(identity):
    """Issue a revocable Nextcloud app password for Desktop/Mobile clients."""
    response = _request(
        'POST',
        f'{settings.NEXTCLOUD_INTERNAL_URL}/ocs/v2.php/core/getapppassword',
        auth=_auth(identity),
        expected={200},
        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
        params={'format': 'json'},
    )
    data = _ocs_data(response, 'Could not create a Nextcloud app password')
    if isinstance(data, dict):
        password = data.get('apppassword') or data.get('appPassword')
    else:
        password = data
    if not password:
        raise CloudError('Nextcloud did not return an app password')
    return str(password)
