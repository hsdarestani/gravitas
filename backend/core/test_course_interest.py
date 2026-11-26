from django.core import mail, signing
from django.test import TestCase, override_settings

from .course_interest import SIGNING_SALT
from .models import CourseInterest


@override_settings(PUBLIC_BASE_URL='https://graviquest.com',
                   EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class CourseInterestTests(TestCase):
    URL = '/api/learn/interest/'

    def post(self, **body):
        return self.client.post(self.URL, body, content_type='application/json')

    def test_interest_is_stored_and_no_email_is_sent(self):
        # Since 2026-11-26 the form mails nothing; it keeps the address.
        response = self.post(course='ai-in-research', level=3, email='Reader@Example.com')
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()['received'])
        row = CourseInterest.objects.get()
        self.assertEqual((row.email, row.level, row.confirmed), ('reader@example.com', 3, False))
        self.assertEqual(len(mail.outbox), 0)

    def test_repeat_updates_the_level_without_an_email(self):
        self.post(course='ai-in-research', level=1, email='reader@example.com')
        response = self.post(course='ai-in-research', level=2, email='reader@example.com')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(CourseInterest.objects.get().level, 2)
        self.assertEqual(len(mail.outbox), 0)

    def test_a_link_sent_before_the_change_still_confirms(self):
        self.post(course='ai-in-research', level=2, email='reader@example.com')
        row = CourseInterest.objects.get()
        token = signing.dumps({'id': row.pk, 'email': row.email}, salt=SIGNING_SALT, compress=True)
        response = self.client.get('/api/learn/interest/confirm/', {'token': token})
        self.assertEqual(response['Location'], 'https://graviquest.com/?interest=1#learn')
        self.assertTrue(CourseInterest.objects.get().confirmed)
        again = self.post(course='ai-in-research', level=3, email='reader@example.com')
        self.assertTrue(again.json()['already_confirmed'])

    def test_email_alone_is_enough(self):
        # The form asks only for an email since 2026-11-18; no level is sent.
        response = self.client.post(self.URL, {'course': 'ai-in-research', 'email': 'only@example.com'}, content_type='application/json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(CourseInterest.objects.get().level, CourseInterest.Level.KEEN)

    def test_a_skeptic_counts_too(self):
        response = self.post(course='ai-in-research', level=0, email='doubter@example.com')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(CourseInterest.objects.get().level, CourseInterest.Level.SKEPTICAL)

    def test_bad_token_says_so(self):
        response = self.client.get('/api/learn/interest/confirm/', {'token': 'nope'})
        self.assertEqual(response['Location'], 'https://graviquest.com/?interest=0#learn')

    def test_rejects_unknown_course_level_and_email(self):
        self.assertEqual(self.post(course='made-up', level=2, email='a@b.co').json()['error'], 'unknown_course')
        self.assertEqual(self.post(course='ai-in-research', level=9, email='a@b.co').json()['error'], 'invalid_level')
        self.assertEqual(self.post(course='ai-in-research', level='lots', email='a@b.co').json()['error'], 'invalid_level')
        self.assertEqual(self.post(course='ai-in-research', level=2, email='nope').json()['error'], 'invalid_email')
        self.assertEqual(self.client.get(self.URL).status_code, 405)
        self.assertFalse(CourseInterest.objects.exists())
