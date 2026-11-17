from urllib.parse import parse_qs, urlparse

from django.core import mail
from django.test import TestCase, override_settings

from .models import CourseInterest


@override_settings(PUBLIC_BASE_URL='https://graviquest.com',
                   EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class CourseInterestTests(TestCase):
    URL = '/api/learn/interest/'

    def post(self, **body):
        return self.client.post(self.URL, body, content_type='application/json')

    def test_interest_is_held_unconfirmed_and_one_email_is_sent(self):
        response = self.post(course='ai-in-research', level=3, email='Reader@Example.com ')
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()['pending_confirmation'])
        row = CourseInterest.objects.get()
        self.assertEqual((row.email, row.level, row.confirmed), ('reader@example.com', 3, False))
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('AI in Research', mail.outbox[0].subject)

    def test_repeat_inside_the_hour_updates_the_level_without_a_second_email(self):
        self.post(course='ai-in-research', level=1, email='reader@example.com')
        response = self.post(course='ai-in-research', level=2, email='reader@example.com')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(CourseInterest.objects.get().level, 2)
        self.assertEqual(len(mail.outbox), 1)

    def test_confirmation_link_confirms_and_lands_on_learn(self):
        self.post(course='ai-in-research', level=2, email='reader@example.com')
        link = next(line for line in mail.outbox[0].body.splitlines() if '/api/learn/interest/confirm/' in line)
        token = parse_qs(urlparse(link).query)['token'][0]
        response = self.client.get('/api/learn/interest/confirm/', {'token': token})
        self.assertEqual(response['Location'], 'https://graviquest.com/?interest=1#learn')
        self.assertTrue(CourseInterest.objects.get().confirmed)
        again = self.post(course='ai-in-research', level=3, email='reader@example.com')
        self.assertTrue(again.json()['already_confirmed'])
        self.assertEqual(len(mail.outbox), 1)

    def test_bad_token_says_so(self):
        response = self.client.get('/api/learn/interest/confirm/', {'token': 'nope'})
        self.assertEqual(response['Location'], 'https://graviquest.com/?interest=0#learn')

    def test_rejects_unknown_course_level_and_email(self):
        self.assertEqual(self.post(course='made-up', level=2, email='a@b.co').json()['error'], 'unknown_course')
        self.assertEqual(self.post(course='ai-in-research', level=9, email='a@b.co').json()['error'], 'invalid_level')
        self.assertEqual(self.post(course='ai-in-research', level=2, email='nope').json()['error'], 'invalid_email')
        self.assertEqual(self.client.get(self.URL).status_code, 405)
        self.assertFalse(CourseInterest.objects.exists())
