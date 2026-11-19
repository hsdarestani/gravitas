"""Prelaunch feedback: anonymous access, optional inputs, private admin analytics."""
import json

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings

from .models import PrelaunchFeedback


@override_settings(SECURE_SSL_REDIRECT=False)
class PrelaunchFeedbackTests(TestCase):
    url = '/api/prelaunch/feedback/'
    admin_url = '/api/platform/admin/prelaunch-feedback/'

    def post(self, body, client=None):
        return (client or self.client).post(
            self.url, json.dumps(body), content_type='application/json'
        )

    def test_anonymous_submission_with_no_name_or_answers(self):
        self.assertIsNone(self.client.get(self.url).json()['submission'])
        response = self.post({'name': '', 'answers': {}})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['submission']['name'], '')
        self.assertEqual(PrelaunchFeedback.objects.count(), 1)
        self.assertEqual(self.client.get(self.url).json()['submission']['answers'], {})

    def test_anonymous_answers_can_be_edited_in_same_session(self):
        self.post({'answers': {'overall_rating': 8, 'persona': 'a1'}})
        updated = self.post({'name': 'Sam', 'answers': {
            'overall_rating': 10, 'persona': 'other', 'persona_other': 'Teacher',
            'section_ratings': {'video': 9, 'essay': 6},
            'first_impression': 'I expected something else',
        }})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(PrelaunchFeedback.objects.count(), 1)
        self.assertEqual(PrelaunchFeedback.objects.get().answers['section_ratings']['video'], 9)
        other_browser = Client()
        self.assertIsNone(other_browser.get(self.url).json()['submission'])

    def test_rejects_unknown_fields_and_invalid_scores(self):
        for bad in (
            {'answers': {'overall_rating': True}},
            {'answers': {'overall_rating': 11}},
            {'answers': {'usability': 0}},
            {'answers': {'section_ratings': {'lab': 7}}},
            {'answers': {'section_ratings': {'forum': '10'}}},
            {'answers': {'persona': 'a4'}},
            {'answers': {'first_impression': 'a' * 2001}},
            {'name': 'a' * 121, 'answers': {}},
        ):
            with self.subTest(bad=bad):
                self.assertEqual(self.post(bad).status_code, 400)

    def test_anonymous_cannot_read_admin_responses(self):
        self.post({'name': 'Test', 'answers': {'overall_rating': 7}})
        self.assertEqual(self.client.get(self.admin_url).status_code, 401)
        member = get_user_model().objects.create_user('reader', password='testpassword')
        self.client.force_login(member)
        self.assertEqual(self.client.get(self.admin_url).status_code, 403)

    def test_superuser_admin_summary_and_csv_safe(self):
        self.post({'name': '=HYPERLINK("evil")', 'answers': {
            'persona': 'a2', 'overall_rating': 8,
            'video_feedback': '+SUM(1,2)', 'section_ratings': {'video': 6},
        }})
        admin = get_user_model().objects.create_superuser(
            'admin', email='admin@example.com', password='testpassword'
        )
        self.client.force_login(admin)
        response = self.client.get(self.admin_url)
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data['total'], 1)
        self.assertEqual(data['persona_counts']['a2'], 1)
        self.assertEqual(data['averages']['overall_rating'], 8)
        csv_response = self.client.get(self.admin_url + '?format=csv')
        self.assertEqual(csv_response.status_code, 200)
        self.assertIn("'=HYPERLINK", csv_response.content.decode())
        self.assertIn("'+SUM", csv_response.content.decode())

    def test_csrf_is_enforced_for_public_post(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(self.post({'answers': {}}, client).status_code, 403)
        client.get('/api/auth/csrf/')
        token = client.cookies['csrftoken'].value
        res = client.post(self.url, json.dumps({'answers': {}}),
                          content_type='application/json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(res.status_code, 200, res.content)
