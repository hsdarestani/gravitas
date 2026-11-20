"""Provider diagnostics are tested with HTTP mocks; these tests spend no neurons."""
import json
import time
from unittest.mock import Mock, patch

import requests
from django.test import SimpleTestCase, override_settings

from .pulsar_api import _unavailable
from .pulsar_runtime.errors import PulsarError, PulsarProviderError
from .pulsar_runtime.providers import ManagedCloudflareProvider, ModelGateway


@override_settings(CLOUDFLARE_AI_ACCOUNT_ID='PRIVATE_ACCOUNT',
                   CLOUDFLARE_AI_API_TOKEN='PRIVATE_TOKEN',
                   PULSAR_MODEL_GENERAL='@cf/meta/llama-3.3-70b-instruct-fp8-fast')
class ProviderFailureTests(SimpleTestCase):
    def response(self, status=200, codes=(), **extra):
        response = requests.Response()
        response.status_code = status
        response.headers['Content-Type'] = 'application/json'
        payload = {'success': status < 400, 'errors': [
            {'code': code, 'message': 'PRIVATE_PROVIDER_BODY'} for code in codes], **extra}
        response._content = json.dumps(payload).encode()
        return response

    def complete(self):
        return ManagedCloudflareProvider().complete(system='PRIVATE_SYSTEM', user='PRIVATE_QUESTION')

    @patch('core.pulsar_runtime.providers.requests.post')
    def test_quota_code_and_retry_after_survive_without_logging_content(self, post):
        response = self.response(429, [4006])
        response.headers['Retry-After'] = '120'
        post.return_value = response
        with self.assertLogs('core.pulsar_runtime.providers', 'WARNING') as logs:
            with self.assertRaises(PulsarProviderError) as caught:
                self.complete()
        error = caught.exception
        self.assertEqual(error.code, 'cloudflare_ai_quota_exhausted')
        self.assertEqual(error.http_status, 429)
        self.assertEqual(error.provider_codes, (4006,))
        self.assertEqual(error.retry_after, 120)
        rendered = '\n'.join(logs.output)
        for private in ('PRIVATE_ACCOUNT', 'PRIVATE_TOKEN', 'PRIVATE_QUESTION', 'PRIVATE_SYSTEM', 'PRIVATE_PROVIDER_BODY'):
            self.assertNotIn(private, rendered)
        self.assertIn('4006', rendered)
        self.assertEqual(post.call_count, 1)

    @patch('core.pulsar_runtime.providers.requests.post')
    def test_auth_rate_and_server_errors_remain_distinguishable(self, post):
        for status, codes, expected in (
            (401, [10000], 'cloudflare_ai_authentication_failed'),
            (403, [9109], 'cloudflare_ai_authentication_failed'),
            (429, [3040], 'cloudflare_ai_rate_limited'),
            (500, [3001], 'cloudflare_ai_failed'),
        ):
            with self.subTest(status=status):
                post.return_value = self.response(status, codes)
                with self.assertRaises(PulsarProviderError) as caught:
                    self.complete()
                self.assertEqual(caught.exception.code, expected)
                self.assertEqual(caught.exception.http_status, status)
                self.assertEqual(caught.exception.provider_codes, tuple(codes))

    @patch('core.pulsar_runtime.providers.requests.post')
    def test_provider_error_envelope_on_http_200_is_failure(self, post):
        post.return_value = self.response(200, [4006], success=False)
        with self.assertRaises(PulsarProviderError) as caught:
            self.complete()
        self.assertEqual(caught.exception.code, 'cloudflare_ai_quota_exhausted')

    @patch('core.pulsar_runtime.providers.requests.post')
    def test_network_and_timeout_do_not_log_exception_text(self, post):
        for error, expected in ((requests.Timeout('PRIVATE_TIMEOUT'), 'cloudflare_ai_timeout'),
                                (requests.ConnectionError('PRIVATE_NETWORK'), 'cloudflare_ai_network_error')):
            with self.subTest(expected=expected):
                post.side_effect = error
                with self.assertLogs('core.pulsar_runtime.providers', 'WARNING') as logs:
                    with self.assertRaises(PulsarProviderError) as caught:
                        self.complete()
                self.assertEqual(caught.exception.code, expected)
                self.assertNotIn('PRIVATE_', '\n'.join(logs.output))

    @patch('core.pulsar_runtime.providers.requests.post')
    def test_invalid_json_and_empty_answers_fail_explicitly(self, post):
        response = self.response()
        response._content = b'PRIVATE_NOT_JSON'
        post.return_value = response
        with self.assertRaises(PulsarProviderError) as caught:
            self.complete()
        self.assertEqual(caught.exception.code, 'cloudflare_ai_invalid_response')
        post.return_value = self.response(result={'response': ''})
        with self.assertRaises(PulsarProviderError) as caught:
            self.complete()
        self.assertEqual(caught.exception.code, 'cloudflare_ai_empty_response')

    @patch('core.pulsar_runtime.providers.requests.post')
    def test_gateway_preserves_provider_cause_and_never_adds_a_retry(self, post):
        post.return_value = self.response(429, [4006])
        gateway = ModelGateway(providers=[ManagedCloudflareProvider()])
        with self.assertRaises(PulsarError) as caught:
            gateway.complete(system='system', user='question')
        self.assertIsInstance(caught.exception.__cause__, PulsarProviderError)
        self.assertEqual(post.call_count, 1)
        response = _unavailable(caught.exception, time.monotonic())
        self.assertEqual(response.status_code, 429)
        payload = json.loads(response.content)
        self.assertEqual(payload['provider_codes'], [4006])
        self.assertEqual(payload['error'], 'cloudflare_ai_quota_exhausted')
        self.assertFalse(payload['ok'])
        self.assertRegex(payload['request_id'], r'^[a-f0-9]{32}$')
        self.assertNotIn('PRIVATE_', response.content.decode())

    @patch('core.pulsar_runtime.providers.requests.post')
    def test_real_success_retains_answer_and_usage(self, post):
        post.return_value = self.response(result={'response': 'A contextual explanation.',
            'usage': {'prompt_tokens': 30, 'completion_tokens': 8}})
        result = self.complete()
        self.assertEqual(result.text, 'A contextual explanation.')
        self.assertEqual(result.input_tokens, 30)
        self.assertEqual(result.output_tokens, 8)

    def test_public_unknown_error_never_logs_arbitrary_exception_text(self):
        with self.assertLogs('core.pulsar_api', 'WARNING') as logs:
            response = _unavailable(PulsarError('PRIVATE_QUESTION_AND_TOKEN'), time.monotonic())
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('PRIVATE_', '\n'.join(logs.output))
        self.assertNotIn('PRIVATE_', response.content.decode())

    def test_public_auth_error_is_not_retried(self):
        error = PulsarProviderError('cloudflare_ai_authentication_failed', http_status=403, provider_codes=[9109])
        payload = json.loads(_unavailable(error, time.monotonic()).content)
        self.assertFalse(payload['retryable'])
        self.assertEqual(payload['provider_codes'], [9109])
