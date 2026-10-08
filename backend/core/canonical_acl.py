"""Conditional, verified snapshots of Nextcloud Team Folder ACL properties."""
from xml.etree import ElementTree as ET
from django.conf import settings
from . import cloud

D = '{DAV:}'
N = '{http://nextcloud.org/ns}'


def normalize(rules):
    return sorted([{'type': str(r['type']), 'id': str(r['id']),
                    'mask': int(r['mask']), 'permissions': int(r['permissions'])}
                   for r in rules], key=lambda r: (r['type'], r['id'], r['mask'], r['permissions']))


def desired_rules(group_id, roles, visibility, extra_groups=()):
    roles = dict(roles)
    if settings.NEXTCLOUD_ADMIN_USER:
        roles.setdefault(settings.NEXTCLOUD_ADMIN_USER, 'manage')
    rules = [{'type': 'group', 'id': group, 'mask': cloud.NC_PERMISSION_ALL, 'permissions': 0} for group in {group_id, *extra_groups}] if visibility in {'specific', 'private'} else []
    rules.extend({'type': 'user', 'id': name, 'mask': cloud.NC_PERMISSION_ALL,
                  'permissions': cloud.ROLE_PERMISSION_MAP.get(role, cloud.NC_PERMISSION_READ)} for name, role in roles.items())
    return normalize(rules)


def read_acl(path):
    body = b'<d:propfind xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns"><d:prop><d:getetag/><nc:acl-list/><nc:acl-enabled/><nc:acl-can-manage/><nc:group-folder-id/></d:prop></d:propfind>'
    response = cloud._request('PROPFIND', cloud._admin_dav_url(path), auth=cloud._admin_auth(),
        expected={207}, headers={'Depth': '0', 'Content-Type': 'application/xml'}, data=body)
    root = ET.fromstring(response.content)
    props = [p.find(D + 'prop') for p in root.findall('.//' + D + 'propstat')
             if ' 200 ' in (p.findtext(D + 'status') or '')]
    acl = next((p.find(N + 'acl-list') for p in props if p is not None and p.find(N + 'acl-list') is not None), None)
    etag = next((p.findtext(D + 'getetag') for p in props if p is not None and p.findtext(D + 'getetag')), '')
    if not etag:
        raise cloud.CloudError('canonical_acl_snapshot_unavailable')
    if acl is None:
        # GroupFolders returns null for a path with no direct rules; Sabre DAV
        # represents that requested property as 404, not an empty list. Accept
        # this only with independent positive mount/ACL/manager witnesses.
        values = {key: next((p.findtext(N + key) for p in props if p is not None and p.findtext(N + key)), '')
                  for key in ('acl-enabled', 'acl-can-manage', 'group-folder-id')}
        missing = any(' 404 ' in (p.findtext(D + 'status') or '') and p.find(D + 'prop/' + N + 'acl-list') is not None
                      for p in root.findall('.//' + D + 'propstat'))
        if not (missing and values['acl-enabled'] in {'true', '1'} and values['acl-can-manage'] in {'true', '1'}
                and values['group-folder-id'].isdigit() and int(values['group-folder-id']) > 0):
            raise cloud.CloudError('canonical_acl_snapshot_unavailable')
        return {'rules': [], 'etag': etag}
    rules = [{'type': item.findtext(N + 'acl-mapping-type'), 'id': item.findtext(N + 'acl-mapping-id'),
              'mask': item.findtext(N + 'acl-mask'), 'permissions': item.findtext(N + 'acl-permissions')}
             for item in acl.findall(N + 'acl')]
    return {'rules': normalize(rules), 'etag': etag}


def write_acl(path, rules, expected):
    """Compare full ACL snapshot inside the native PostgreSQL transaction.

    Sabre DAV only compares If-Match for IFile, so collection PROPPATCH cannot
    use that header. Never replace it with an unconditional folder write.
    """
    import json
    if not isinstance(expected, dict) or not expected.get('etag') or 'rules' not in expected:
        raise cloud.CloudError('canonical_acl_expected_snapshot_required')
    response = cloud._request('POST', settings.NEXTCLOUD_INTERNAL_URL + '/ocs/v2.php/apps/gravitascanonical/api/v1/acl',
        auth=cloud._admin_auth(), expected={200, 409},
        headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
        data={'path': path, 'expected_etag': expected['etag'],
              'expected_rules': json.dumps(normalize(expected['rules'])), 'rules': json.dumps(normalize(rules))})
    if response.status_code == 409:
        return None
    result = cloud._ocs_data(response, 'Could not conditionally update native ACL')
    if not isinstance(result, dict) or result.get('applied') is not True:
        raise cloud.CloudError('canonical_acl_property_write_failed')
    saved = read_acl(path)
    if saved['rules'] != normalize(rules):
        raise cloud.CloudError('canonical_acl_readback_failed')
    return saved


def protect_service_folder(project, relative_path):
    """Restrict an empty bootstrap/archive folder before storing private data.

    The journal cannot journal its own first ACL. It can still require an
    exact revision and verified service-only readback before any content PUT.
    """
    path = cloud.project_mountpoint(project) + '/' + relative_path
    before = read_acl(path)
    rules = desired_rules(cloud.project_group_id(project), {}, 'private', cloud.canonical_native_groups(project).values())
    if before['rules'] != rules and write_acl(path, rules, before) is None:
        raise cloud.CloudError('canonical_private_folder_changed')
