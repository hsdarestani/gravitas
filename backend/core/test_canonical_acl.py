from unittest.mock import Mock, patch
from django.test import SimpleTestCase, override_settings
from .canonical_acl import read_acl, write_acl
from .cloud import CloudError


@override_settings(NEXTCLOUD_ADMIN_USER='test-admin', NEXTCLOUD_ADMIN_PASSWORD='test-only')
class CanonicalACLTests(SimpleTestCase):
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
