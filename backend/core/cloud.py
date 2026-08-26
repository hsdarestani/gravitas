import base64
import hashlib
import secrets
from pathlib import PurePosixPath
from urllib.parse import quote
from xml.etree import ElementTree

import requests
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from .models import NextcloudIdentity


class CloudError(Exception):
    pass


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
        data={'userid': username, 'password': password, 'displayName': user.first_name or user.email},
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
        _request(
            'PUT',
            f'{endpoint}/{quote(username, safe="")}',
            auth=_admin_auth(),
            expected={100, 200},
            headers=headers,
            data={'key': 'password', 'value': password},
        )

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
    try:
        if int(response.json()['ocs']['meta']['statuscode']) != 100:
            raise CloudError('Could not apply cloud quota')
    except (KeyError, TypeError, ValueError, requests.JSONDecodeError) as exc:
        raise CloudError('Invalid response while applying cloud quota') from exc


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


def _dav_url(identity, path):
    clean = safe_relative_path(path)
    encoded = '/'.join(quote(part, safe='') for part in clean.split('/'))
    return f'{settings.NEXTCLOUD_INTERNAL_URL}/remote.php/dav/files/{quote(identity.username, safe="")}/{encoded}'


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


def move(identity, old_path, new_path):
    clean_new = safe_relative_path(new_path)
    parent = str(PurePosixPath(clean_new).parent)
    if parent and parent != '.':
        make_folder(identity, parent)
    _request(
        'MOVE',
        _dav_url(identity, old_path),
        auth=_auth(identity),
        expected={201, 204},
        headers={'Destination': _dav_url(identity, clean_new), 'Overwrite': 'F'},
    )
