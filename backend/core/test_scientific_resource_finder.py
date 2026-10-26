"""Regression tests for the read-only Pulsar scientific-resource Telegram skill."""
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from .scientific_resource_finder import (
    _arxiv_pdf, handle_resource_request, parse_request,
)
from .task_notifications import telegram_notification_webhook


class ScientificResourceFinderTests(SimpleTestCase):
    def test_iso_standard_link_returns_official_reference_without_claiming_pdf(self):
        response = handle_resource_request('https://www.iso.org/standard/35736.html')
        self.assertEqual(len(response), 1)
        self.assertIn('ISO/IEC 25012:2008', response[0]['text'])
        self.assertIn('https://www.iso.org/standard/35736.html', response[0]['text'])
        self.assertNotIn('document_url', response[0])

    def test_doi_arxiv_and_commands(self):
        self.assertEqual(parse_request('10.1038/s41586-025-01234-5')['kind'], 'doi')
        self.assertEqual(parse_request('https://doi.org/10.1038/s41586-025-01234-5')['kind'], 'doi')
        self.assertEqual(parse_request('https://arxiv.org/abs/2501.01234')['kind'], 'arxiv')
        self.assertEqual(parse_request('/find data quality model')['kind'], 'title')
        self.assertEqual(parse_request('/book 9780140328721')['kind'], 'isbn')
        self.assertEqual(parse_request('/book The Selfish Gene')['kind'], 'book_title')
        self.assertEqual(parse_request('/find')['kind'], 'help')

    def test_normal_work_messages_not_hijacked(self):
        for text in (
            'Today I completed research work.',
            'Review Task #213',
            '/report',
            'ثبت گزارش امروز',
            'Here is a link https://www.iso.org/standard/35736.html for my report',
            'https://some-website.test/unrelated',
        ):
            self.assertIsNone(handle_resource_request(text), text)

    def test_unknown_url_does_not_trigger_external_fetch(self):
        with patch('core.scientific_resource_finder.requests.get') as get:
            response = handle_resource_request('/find https://example.com/unknown')
        get.assert_not_called()
        self.assertIn('Unsupported link', response[0]['text'])

    def test_arxiv_pdf_requires_trusted_exact_path(self):
        self.assertEqual(_arxiv_pdf('https://arxiv.org/pdf/2501.01234'),
                         'https://arxiv.org/pdf/2501.01234')
        for url in (
            'http://arxiv.org/pdf/2501.01234',
            'https://arxiv.org.evil.test/pdf/2501.01234',
            'https://arxiv.org@evil.test/pdf/2501.01234',
            'https://arxiv.org/private/2501.01234',
            'https://arxiv.org/pdf/2501.01234?x=1',
        ):
            self.assertEqual(_arxiv_pdf(url), '')

    @patch('core.scientific_resource_finder._get_json')
    def test_openalex_results_distinguish_open_pdf_from_publisher_link(self, get_json):
        get_json.return_value = {'results': [
            {
                'display_name': 'Open paper', 'publication_year': 2024,
                'doi': 'https://doi.org/10.1234/test',
                'open_access': {'is_oa': True},
                'best_oa_location': {
                    'is_oa': True,
                    'pdf_url': 'https://arxiv.org/pdf/2501.01234',
                    'landing_page_url': 'https://arxiv.org/abs/2501.01234',
                },
            },
            {
                'display_name': 'Closed paper', 'publication_year': 2023,
                'doi': 'https://doi.org/10.2222/test',
                'open_access': {'is_oa': False}, 'best_oa_location': None,
            },
        ]}
        response = handle_resource_request('/find scientific data quality')
        self.assertIn('Open paper', response[0]['text'])
        self.assertIn('Closed paper', response[0]['text'])
        self.assertIn('No verified open-access PDF', response[0]['text'])
        self.assertEqual(response[1]['document_url'],
                         'https://arxiv.org/pdf/2501.01234')
        self.assertEqual(get_json.call_args.args[0], 'https://api.openalex.org/works')

    @patch('core.scientific_resource_finder._get_json')
    def test_openlibrary_book_lookup_is_metadata_only(self, get_json):
        get_json.return_value = {
            'title': 'Example Book', 'key': '/books/OL123M',
        }
        response = handle_resource_request('/book 9780140328721')
        self.assertIn('Example Book', response[0]['text'])
        self.assertIn('https://openlibrary.org/books/OL123M', response[0]['text'])
        self.assertNotIn('document_url', response[0])

    @patch('core.scientific_resource_finder._get_json')
    def test_search_books_by_title(self, get_json):
        get_json.return_value = {
            'docs': [{'title': 'The Selfish Gene',
                      'author_name': ['Richard Dawkins'],
                      'key': '/works/OL123W'}],
        }
        response = handle_resource_request('/book The Selfish Gene')
        self.assertIn('The Selfish Gene', response[0]['text'])
        self.assertIn('https://openlibrary.org/works/OL123W', response[0]['text'])
        self.assertEqual(get_json.call_args.args[0], 'https://openlibrary.org/search.json')

    def test_arxiv_direct_request_has_no_api_dependency(self):
        with patch('core.scientific_resource_finder.requests.get') as get:
            response = handle_resource_request('https://arxiv.org/abs/2501.01234')
        get.assert_not_called()
        self.assertEqual(response[1]['document_url'],
                         'https://arxiv.org/pdf/2501.01234')

    @patch('core.task_notifications._telegram_api')
    def test_document_sender_falls_back_to_link_on_delivery_error(self, telegram_api):
        from .task_notifications import _send_telegram_pulsar_messages

        telegram_api.side_effect = [
            RuntimeError('remote file unavailable'),
            {'ok': True},
        ]
        _send_telegram_pulsar_messages(123, [{
            'document_url': 'https://arxiv.org/pdf/2501.01234',
            'caption': 'OA PDF',
        }])
        self.assertEqual(telegram_api.call_args_list[0].args[0], 'sendDocument')
        self.assertEqual(telegram_api.call_args_list[1].args[0], 'sendMessage')
        self.assertIn('arxiv.org/pdf/', telegram_api.call_args_list[1].args[1]['text'])

    @override_settings(GRAVITAS_TELEGRAM_WEBHOOK_SECRET='test-secret')
    @patch('core.telegram_work_reports.handle_report_message')
    @patch('core.task_notifications._telegram_api')
    @patch('core.task_notifications._telegram_connected_preference')
    def test_webhook_routes_iso_before_work_report_and_without_database_mutations(
            self, preference, telegram_api, report_handler):
        preference.return_value = SimpleNamespace(
            user=SimpleNamespace(pk=7), user_id=7,
        )
        request = RequestFactory().post(
            '/api/telegram/webhook',
            data=json.dumps({
                'message': {
                    'message_id': 11,
                    'chat': {'id': 123, 'type': 'private'},
                    'text': 'https://www.iso.org/standard/35736.html',
                },
            }), content_type='application/json',
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN='test-secret',
        )
        response = telegram_notification_webhook(request)
        self.assertEqual(response.status_code, 200)
        report_handler.assert_not_called()
        messages = [call.args[1] for call in telegram_api.call_args_list
                    if call.args[0] == 'sendMessage']
        self.assertEqual(len(messages), 1)
        self.assertIn('ISO/IEC 25012:2008', messages[0]['text'])
