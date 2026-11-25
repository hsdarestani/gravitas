"""Prelaunch feedback: anonymous access, optional inputs, private admin analytics."""
import csv
import io
import json
from datetime import datetime, timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings

from .models import PrelaunchFeedback, WorkspaceMembership
from .platform_runtime_v3 import ensure_platform_workspaces


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


@override_settings(SECURE_SSL_REDIRECT=False)
class PrelaunchAnalyticsTests(TestCase):
    url = '/api/platform/admin/prelaunch-feedback/'

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('survey-admin')
        self.client.force_login(self.admin)

    def save_response(self, timestamp, answers, **fields):
        item = PrelaunchFeedback.objects.create(answers=answers, **fields)
        PrelaunchFeedback.objects.filter(pk=item.pk).update(created_at=datetime.fromisoformat(timestamp))
        return item

    def test_distribution_excludes_blanks_preserves_zero_and_reports_eligibility(self):
        self.save_response('2026-11-01T00:00:00+00:00', {
            'persona': 'a1', 'site_works': 3, 'recommend_likelihood': 0,
            'video_watched': 'part', 'video_content_quality': 5,
            'overall_rating': 9, 'section_ratings': {'essay': 7},
        })
        self.save_response('2026-11-02T00:00:00+00:00', {
            'persona': 'a2', 'site_works': 4, 'recommend_likelihood': 10,
            'video_watched': 'all', 'community_visited': 'no',
        })
        self.save_response('2026-11-03T00:00:00+00:00', {
            'video_feedback': 'A legacy video comment', 'site_works': True,
        })
        data = self.client.get(self.url).json()
        self.assertEqual(data['total'], 3)
        questions = data['questions']
        self.assertEqual(questions['site_works']['average'], 3.5)
        self.assertEqual(questions['site_works']['unanswered'], 1)
        self.assertEqual(questions['recommend_likelihood']['options'][0], {'value': 0, 'count': 1})
        self.assertEqual(questions['recommend_likelihood']['options'][-1], {'value': 10, 'count': 1})
        self.assertEqual(questions['recommend_likelihood']['average'], 5)
        self.assertEqual(questions['video_content_quality']['eligible'], 2)
        self.assertEqual(questions['video_content_quality']['unanswered'], 1)
        self.assertEqual(questions['video_content_quality']['outside_base'], 1)
        self.assertEqual(questions['video_feedback'], {
            'answered': 1, 'unanswered': 2, 'eligible': 3, 'outside_base': 0,
        })
        self.assertEqual(questions['forum_usability']['eligible'], 0)
        self.assertIsNone(questions['forum_usability']['average'])
        self.assertEqual(questions['overall_rating']['eligible'], 1)
        self.assertEqual(questions['section:essay']['average'], 7)
        self.assertEqual(questions['section:video']['unanswered'], 1)
        self.assertEqual(data['answered_slots'], 11)
        self.assertEqual(
            data['eligible_slots'],
            sum(question['eligible'] for key, question in questions.items()
                if key not in {'name', 'contact_email', 'overall_rating', 'usability'}
                and not key.startswith('section:'))
        )

    def test_same_filtered_cohort_in_analytics_text_and_csv(self):
        included = self.save_response('2026-11-22T23:59:59.999999+00:00', {
            'persona': 'a3', 'video_watched': 'no', 'community_visited': 'yes',
            'site_works': 4, 'one_change': 'Improve Straße search.',
            'other_feedback': 'Unrelated comment', 'contact_email': 'private@example.com',
        }, name='=FORMULA()')
        for timestamp, persona, video, community in [
            ('2026-11-19T23:59:59+00:00', 'a3', 'no', 'yes'),
            ('2026-11-23T00:00:00+00:00', 'a3', 'no', 'yes'),
            ('2026-11-20T00:00:00+00:00', 'a2', 'no', 'yes'),
            ('2026-11-20T00:00:00+00:00', 'a3', 'all', 'yes'),
            ('2026-11-20T00:00:00+00:00', 'a3', 'no', 'no'),
        ]:
            self.save_response(timestamp, {
                'persona': persona, 'video_watched': video, 'community_visited': community,
                'site_works': 1, 'one_change': 'Another response',
            })
        self.save_response('2026-11-22T12:00:00+00:00', {'persona': 'a3'}, survey_version='different')
        filters = {'from': '2026-11-20', 'to': '2026-11-22', 'persona': 'a3',
                   'video_watched': 'no', 'community_visited': 'yes'}
        data = self.client.get(self.url, filters).json()
        self.assertEqual(data['total'], 1)
        self.assertEqual(data['averages']['site_works'], 4)
        self.assertEqual([row['count'] for row in data['trend']], [0, 0, 1])
        self.assertEqual(data['responses'][0]['id'], str(included.pk))
        search = self.client.get(self.url, {**filters, 'view': 'text', 'q': 'STRASSE'}).json()
        self.assertEqual(search['total'], 1)
        self.assertEqual(search['responses'][0]['comments'], {'one_change': 'Improve Straße search.'})
        self.assertNotIn('name', search['responses'][0])
        excluded = self.client.get(self.url, {**filters, 'view': 'text', 'q': 'STRASSE', 'question': 'other_feedback'})
        self.assertEqual(excluded.json()['total'], 0)
        csv_response = self.client.get(self.url, {**filters, 'format': 'csv', 'page': 2})
        records = list(csv.DictReader(io.StringIO(csv_response.content.decode())))
        self.assertEqual([row['id'] for row in records], [str(included.pk)])
        self.assertEqual(records[0]['name'], "'=FORMULA()")
        self.assertEqual(records[0]['contact_email'], 'private@example.com')
        self.assertIn('no-store', csv_response['Cache-Control'])
        self.assertIn('private', csv_response['Cache-Control'])

    def test_empty_cohort_and_blank_only_submission(self):
        blank = self.save_response('2026-11-02T00:00:00+00:00', {})
        self.save_response('2026-11-03T00:00:00+00:00', {
            'persona': None, 'video_watched': None, 'community_visited': '',
        })
        self.save_response('2026-11-04T00:00:00+00:00', {'persona': 'a1', 'video_watched': 'no'})
        params = dict.fromkeys(('persona', 'video_watched', 'community_visited'), 'unspecified')
        report = self.client.get(self.url, params).json()
        self.assertIn(str(blank.pk), [item['id'] for item in report['responses']])
        self.assertEqual(report['total'], 2)
        self.assertEqual(report['answered_slots'], 0)
        self.assertEqual(report['questions']['site_works']['unanswered'], 2)
        self.assertGreater(report['eligible_slots'], 0)
        empty = self.client.get(self.url, {'from': '2026-11-05'}).json()
        self.assertEqual((empty['total'], empty['eligible_slots'], empty['trend']), (0, 0, []))
        self.assertIsNone(empty['questions']['site_works']['average'])
        self.assertEqual(len(self.client.get(self.url, {'from': '2026-11-05', 'format': 'csv'}).content.splitlines()), 1)

    def test_time_windows_use_utc_creation_and_keep_empty_buckets(self):
        for stamp in ('2026-10-05', '2026-10-29', '2026-11-20', '2026-11-25', '2026-11-26'):
            self.save_response(stamp + 'T00:00:00+00:00', {})
        with patch('core.prelaunch_feedback_api.django_timezone.now',
                   return_value=datetime(2026, 11, 25, 23, 59, tzinfo=timezone.utc)):
            data = self.client.get(self.url).json()
        self.assertEqual((data['last_7_days'], data['last_30_days']), (2, 3))
        self.assertEqual(sum(row['count'] for row in data['trend']), 5)
        self.assertEqual(data['trend'][0], {'from': '2026-10-05', 'to': '2026-10-11', 'count': 1})
        self.assertEqual(data['trend'][1]['count'], 0)
        self.assertEqual(data['trend'][-1]['to'], '2026-11-26')

    def test_access_and_invalid_filters(self):
        for filters in (
            {'from': '2026-02-30'}, {'from': '20261101'}, {'from': '2026-11-05', 'to': '2026-11-04'},
            {'community_visited': 'maybe'}, {'view': 'text', 'question': 'contact_email'},
            {'view': 'text', 'q': 'x' * 201},
        ):
            with self.subTest(filters=filters):
                self.assertEqual(self.client.get(self.url, filters).status_code, 400)
        core = ensure_platform_workspaces(self.admin)['core']
        users = get_user_model().objects
        reader = users.create_user('survey-reader')
        member = users.create_user('survey-core-member')
        WorkspaceMembership.objects.create(workspace=core, user=member, role='member')
        owner = users.create_user('survey-core-owner')
        WorkspaceMembership.objects.create(workspace=core, user=owner, role='owner')
        delegated_admin = users.create_user('survey-core-delegated-admin')
        WorkspaceMembership.objects.create(workspace=core, user=delegated_admin, role='admin')
        for filters in ({}, {'view': 'text'}, {'format': 'csv'}):
            with self.subTest(mode=filters):
                self.assertEqual(Client().get(self.url, filters).status_code, 401)
                for user, expected in [(reader, 403), (member, 403), (owner, 200), (delegated_admin, 200)]:
                    self.client.force_login(user)
                    self.assertEqual(self.client.get(self.url, filters).status_code, expected)

    def test_pagination_preserves_cohort_and_search_counts(self):
        PrelaunchFeedback.objects.bulk_create(
            [PrelaunchFeedback(answers={'one_change': 'Search this'}) for _ in range(52)]
        )
        data = self.client.get(self.url, {'page': 2}).json()
        self.assertEqual(data['total'], 52)
        self.assertEqual(data['questions']['one_change']['answered'], 52)
        self.assertEqual(len(data['responses']), 2)
        text = self.client.get(self.url, {'view': 'text', 'page': 2, 'q': 'SEARCH'}).json()
        self.assertEqual(text['total'], 52)
        self.assertEqual(len(text['responses']), 2)
