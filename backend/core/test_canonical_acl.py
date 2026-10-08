from unittest.mock import Mock, patch
from django.test import SimpleTestCase, override_settings
from .canonical_acl import read_acl, write_acl, protect_service_folder
from .cloud import CloudError


@override_settings(NEXTCLOUD_ADMIN_USER='test-admin', NEXTCLOUD_ADMIN_PASSWORD='test-only')
class CanonicalACLTests(SimpleTestCase):
    def test_service_folder_denies_members_but_preserves_conditional_admin_access(self):
        project = Mock()
        with patch('core.canonical_acl.cloud.project_mountpoint', return_value='GRV-000208'), patch('core.canonical_acl.cloud.project_group_id', return_value='project-group'), patch('core.canonical_acl.read_acl', return_value={'rules': [], 'etag': 'original'}), patch('core.canonical_acl.write_acl', return_value={'etag': 'saved'}) as write:
            protect_service_folder(project, '06_Archive/CanonicalTransactions')
            path, rules, etag = write.call_args.args
            self.assertEqual(etag, 'original')
            self.assertIn({'type': 'group', 'id': 'project-group', 'mask': 31, 'permissions': 0}, rules)
            self.assertIn({'type': 'user', 'id': 'test-admin', 'mask': 31, 'permissions': 31}, rules)
            write.return_value = None
            with self.assertRaises(CloudError):
                protect_service_folder(project, '06_Archive/CanonicalTransactions')

    def test_missing_acl_property_is_not_treated_as_empty_permissions(self):
        reply = Mock(content=b'<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:getetag>etag</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>')
        with patch('core.canonical_acl.cloud._request', return_value=reply):
            with self.assertRaises(CloudError):
                read_acl('GRV-000001/path')

    def test_multistatus_property_failure_is_rejected(self):
        reply = Mock(status_code=207, content=b'<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop/><d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat></d:response></d:multistatus>')
        with patch('core.canonical_acl.cloud._request', return_value=reply):
            with self.assertRaises(CloudError):
                write_acl('GRV-000001/path', [], 'etag')

    def test_xml_identifiers_are_escaped_and_exact_readback_is_required(self):
        reply = Mock(status_code=207, content=b'<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop/><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>')
        rules = [{'type': 'user', 'id': 'user&<name', 'mask': 31, 'permissions': 1}]
        with patch('core.canonical_acl.cloud._request', return_value=reply) as request, patch('core.canonical_acl.read_acl', return_value={'rules': rules, 'etag': 'new'}):
            write_acl('GRV-000001/path', rules, 'old')
            self.assertIn(b'user&amp;&lt;name', request.call_args.kwargs['data'])
            self.assertEqual(request.call_args.kwargs['headers']['If-Match'], 'old')

    def test_empty_native_acl_requires_positive_manager_and_mount_witnesses(self):
        xml = '<d:multistatus xmlns:d="DAV:" xmlns:n="http://nextcloud.org/ns"><d:response><d:propstat><d:prop><d:getetag>fresh</d:getetag><n:acl-enabled>1</n:acl-enabled><n:acl-can-manage>{manage}</n:acl-can-manage><n:group-folder-id>{folder}</n:group-folder-id></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><n:acl-list/></d:prop><d:status>HTTP/1.1 {status}</d:status></d:propstat></d:response></d:multistatus>'
        for manage, folder, status in [('1', '208', '404 Not Found'), ('0', '208', '404 Not Found'), ('1', '0', '404 Not Found'), ('1', '208', '403 Forbidden')]:
            with self.subTest(manage=manage, folder=folder, status=status):
                reply = Mock(content=xml.format(manage=manage, folder=folder, status=status).encode())
                with patch('core.canonical_acl.cloud._request', return_value=reply):
                    if manage == '1' and folder == '208' and status.startswith('404'):
                        self.assertEqual(read_acl('GRV-000208/new-folder'), {'rules': [], 'etag': 'fresh'})
                    else:
                        with self.assertRaises(CloudError):
                            read_acl('GRV-000208/new-folder')
