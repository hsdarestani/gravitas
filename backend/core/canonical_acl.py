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


def desired_rules(group_id, roles, visibility):
    roles = dict(roles)
    if settings.NEXTCLOUD_ADMIN_USER:
        roles.setdefault(settings.NEXTCLOUD_ADMIN_USER, 'manage')
    rules = [{'type': 'group', 'id': group_id, 'mask': cloud.NC_PERMISSION_ALL, 'permissions': 0}] if visibility in {'specific', 'private'} else []
    rules.extend({'type': 'user', 'id': name, 'mask': cloud.NC_PERMISSION_ALL,
                  'permissions': cloud.ROLE_PERMISSION_MAP.get(role, cloud.NC_PERMISSION_READ)} for name, role in roles.items())
    return normalize(rules)


def read_acl(path):
    body = b'<d:propfind xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns"><d:prop><d:getetag/><nc:acl-list/></d:prop></d:propfind>'
    response = cloud._request('PROPFIND', cloud._admin_dav_url(path), auth=cloud._admin_auth(),
        expected={207}, headers={'Depth': '0', 'Content-Type': 'application/xml'}, data=body)
    root = ET.fromstring(response.content)
    props = [p.find(D + 'prop') for p in root.findall('.//' + D + 'propstat')
             if ' 200 ' in (p.findtext(D + 'status') or '')]
    acl = next((p.find(N + 'acl-list') for p in props if p is not None and p.find(N + 'acl-list') is not None), None)
    etag = next((p.findtext(D + 'getetag') for p in props if p is not None and p.findtext(D + 'getetag')), '')
    if acl is None or not etag:
        raise cloud.CloudError('canonical_acl_snapshot_unavailable')
    rules = [{'type': item.findtext(N + 'acl-mapping-type'), 'id': item.findtext(N + 'acl-mapping-id'),
              'mask': item.findtext(N + 'acl-mask'), 'permissions': item.findtext(N + 'acl-permissions')}
             for item in acl.findall(N + 'acl')]
    return {'rules': normalize(rules), 'etag': etag}


def write_acl(path, rules, expected):
    root = ET.Element(D + 'propertyupdate')
    acl = ET.SubElement(ET.SubElement(ET.SubElement(root, D + 'set'), D + 'prop'), N + 'acl-list')
    for rule in normalize(rules):
        item = ET.SubElement(acl, N + 'acl')
        for key, value in [('acl-mapping-type', rule['type']), ('acl-mapping-id', rule['id']),
                           ('acl-mapping-display-name', rule['id']), ('acl-mask', rule['mask']),
                           ('acl-permissions', rule['permissions'])]:
            ET.SubElement(item, N + key).text = str(value)
    response = cloud._request('PROPPATCH', cloud._admin_dav_url(path), auth=cloud._admin_auth(),
        expected={207, 412}, headers={'If-Match': expected, 'Content-Type': 'application/xml'},
        data=ET.tostring(root, encoding='utf-8', xml_declaration=True))
    if response.status_code == 412:
        return None
    parsed = ET.fromstring(response.content)
    statuses = [p.findtext(D + 'status') or '' for p in parsed.findall('.//' + D + 'propstat')]
    if not statuses or any(' 200 ' not in status for status in statuses):
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
    rules = desired_rules(cloud.project_group_id(project), {}, 'private')
    if before['rules'] != rules and write_acl(path, rules, before['etag']) is None:
        raise cloud.CloudError('canonical_private_folder_changed')
