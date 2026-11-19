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
        admin = get_user_model().objects.create_superuser(
            'owner', email='owner@example.com', password='testpassword'
        )
        self.client.force_login(admin)
        self.assertEqual(self.client.get('/api/platform/bootstrap/').status_code, 200)
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


    def test_expanded_starred_ratings_and_zero_to_ten_recommendation(self):
        response = self.post({'answers': {
            'site_works': 5, 'goals_clear': 4, 'findability': 3,
            'visual_attractiveness': 5, 'topic_interest': 4,
            'topic_quality': 3, 'return_likelihood': 5,
            'recommend_likelihood': 0, 'one_change': 'Make the menu clearer.',
            'video_watched': 'all', 'video_content_quality': 5,
            'contact_email': 'visitor@example.com',
        }})
        self.assertEqual(response.status_code, 200, response.content)
        values = PrelaunchFeedback.objects.get().answers
        self.assertEqual(values['recommend_likelihood'], 0)
        self.assertEqual(values['video_content_quality'], 5)
        self.assertEqual(values['contact_email'], 'visitor@example.com')

    def test_conditional_answers_cleared_when_branch_not_applicable(self):
        response = self.post({'answers': {
            'anything_broken': 'no', 'broken_where': 'broken',
            'community_visited': 'no', 'forum_usability': 5,
            'forum_motivation': 'invite me',
            'video_watched': 'no', 'video_content_quality': 5,
            'video_visuals': 5, 'video_stop_reason': 'stopped',
            'persona': 'a2', 'persona_other': 'ignore',
        }})
        self.assertEqual(response.status_code, 200, response.content)
        answers = PrelaunchFeedback.objects.get().answers
        for key in ('broken_where', 'forum_usability', 'forum_motivation',
                    'video_content_quality', 'video_visuals',
                    'video_stop_reason', 'persona_other'):
            self.assertNotIn(key, answers)
        self.assertEqual(answers['video_watched'], 'no')
        self.assertEqual(answers['community_visited'], 'no')

    def test_part_of_video_preserves_stop_reason_and_full_video_clears_it(self):
        self.post({'answers': {
            'video_watched': 'part', 'video_content_quality': 3,
            'video_stop_reason': 'I was interrupted.',
        }})
        self.assertIn('video_stop_reason', PrelaunchFeedback.objects.get().answers)
        self.post({'answers': {
            'video_watched': 'all', 'video_content_quality': 5,
            'video_stop_reason': 'Must disappear.',
        }})
        self.assertNotIn('video_stop_reason', PrelaunchFeedback.objects.get().answers)

    def test_invalid_expanded_inputs_are_rejected(self):
        for answers in (
            {'recommend_likelihood': -1}, {'recommend_likelihood': 11},
            {'goals_clear': 0}, {'goals_clear': 6},
            {'topic_difficulty': 'unknown'}, {'community_visited': 'maybe'},
            {'video_watched': 'sometimes'},
            {'contact_email': 'not-an-email'},
            {'contact_email': 'a' * 255},
            {'one_change': 'x' * 2001},
        ):
            with self.subTest(answers=answers):
                self.assertEqual(self.post({'answers': answers}).status_code, 400)

    def test_expanded_metrics_include_counts_and_export_all_columns(self):
        self.post({'answers': {
            'site_works': 4, 'recommend_likelihood': 10,
            'one_change': '=HYPERLINK("bad")', 'video_watched': 'no',
        }})
        admin = get_user_model().objects.create_superuser(
            'admin2', email='admin2@example.com', password='testpassword'
        )
        self.client.force_login(admin)
        data = self.client.get(self.admin_url).json()
        self.assertEqual(data['averages']['site_works'], 4)
        self.assertEqual(data['averages']['recommend_likelihood'], 10)
        self.assertEqual(data['metric_counts']['site_works'], 1)
        self.assertEqual(data['metric_counts']['topic_quality'], 0)
        exported = self.client.get(self.admin_url + '?format=csv').content.decode()
        self.assertIn('contact_email', exported.splitlines()[0])
        self.assertIn('site_works', exported.splitlines()[0])
        self.assertIn("'=HYPERLINK", exported)

    def test_earlier_survey_fields_remain_editable(self):
        self.post({'answers': {'overall_rating': 8, 'section_ratings': {'essay': 6}}})
        self.post({'answers': {
            'overall_rating': 8, 'section_ratings': {'essay': 6},
            'site_works': 5,
        }})
        self.assertEqual(PrelaunchFeedback.objects.count(), 1)
        self.assertEqual(PrelaunchFeedback.objects.get().answers['overall_rating'], 8)
