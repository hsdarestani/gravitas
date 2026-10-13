from unittest.mock import Mock, patch

from django.test import SimpleTestCase, override_settings
import requests

from core.cloud import CloudError, _request


@override_settings(
    NEXTCLOUD_INTERNAL_URL='https://cloud.example.test',
    NEXTCLOUD_PUBLIC_URL='https://cloud.example.test',
    NEXTCLOUD_CONNECT_TIMEOUT=2,
    NEXTCLOUD_READ_TIMEOUT=3,
)
class NextcloudReadRetryTests(SimpleTestCase):
    def test_safe_get_retries_transient_503_and_preserves_etag_headers(self):
        busy = Mock(status_code=503)
        ok = Mock(status_code=200)
        with patch('core.cloud.requests.request', side_effect=[busy, ok]) as send, patch('core.cloud.time.sleep') as pause:
            actual = _request('GET', 'https://cloud.example.test/remote.php/dav/files/test/project.md',
                              auth=('test', 'secret'), expected={200},
                              headers={'If-None-Match': '"saved"'})
        self.assertIs(actual, ok)
        self.assertEqual(send.call_count, 2)
        self.assertEqual(send.call_args.kwargs['headers']['If-None-Match'], '"saved"')
        self.assertEqual(send.call_args.kwargs['headers']['Accept-Encoding'], 'identity')
        busy.close.assert_called_once()
        pause.assert_called_once()

    def test_unsafe_write_is_not_replayed_after_503(self):
        with patch('core.cloud.requests.request', return_value=Mock(status_code=503)) as send, patch('core.cloud.time.sleep') as pause:
            with self.assertRaises(CloudError):
                _request('PUT', 'https://cloud.example.test/remote.php/dav/files/test/project.md',
                         auth=('test', 'secret'), expected={201, 204}, data=b'x')
        send.assert_called_once()
        pause.assert_not_called()

    def test_non_transient_read_error_is_not_retried(self):
        with patch('core.cloud.requests.request', return_value=Mock(status_code=403)) as send:
            with self.assertRaises(CloudError):
                _request('GET', 'https://cloud.example.test/remote.php/dav/files/test/project.md',
                         auth=('test', 'secret'), expected={200})
        send.assert_called_once()

    def test_read_network_failures_retry_with_bounded_attempts(self):
        with patch('core.cloud.requests.request', side_effect=requests.ConnectionError('offline')) as send, patch('core.cloud.time.sleep') as pause:
            with self.assertRaises(CloudError):
                _request('PROPFIND', 'https://cloud.example.test/remote.php/dav/files/test/',
                         auth=('test', 'secret'), expected={207})
        self.assertEqual(send.call_count, 3)
        self.assertEqual(pause.call_count, 2)
