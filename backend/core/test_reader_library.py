"""The guest-to-account handover, tested at the seams that actually break.

The interesting cases here are not "can a signed-in user save an article" but
what happens when the same pile is adopted twice, when two devices disagree
about how far through a path the reader is, and when an unauthenticated
visitor asks the server for a library it has no business inventing.
"""

import json

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import LabProgress, ReaderSavedItem


class ReaderLibraryTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            'reader@example.com', 'reader@example.com', 'A-secure-password-123!'
        )

    def post(self, payload):
        return self.client.post(
            '/api/reader/library/',
            json.dumps(payload),
            content_type='application/json',
        )

    def guest_pile(self):
        return {
            'saved': [
                {
                    'item_key': 'article-hypothesis-or-sentence',
                    'kind': 'article',
                    'title': 'Can a model produce a hypothesis?',
                    'url': '/article-hypothesis-or-sentence.html',
                    'summary': 'Fluency is not a claim about the world.',
                    'meta': {'eyebrow': 'Essay', 'reading': '14 min read'},
                },
                {
                    'item_key': 'path-ai-in-research',
                    'kind': 'path',
                    'title': 'AI in Research',
                    'url': '/path-ai-in-research.html',
                },
            ],
            'following': [
                {
                    'item_key': 'topic-machine-hypothesis',
                    'kind': 'topic',
                    'title': 'The Machine Hypothesis',
                },
            ],
            'paths': [
                {
                    'item_key': 'path-ai-in-research',
                    'title': 'AI in Research',
                    'done': ['step-01', 'step-02'],
                    'total': 8,
                },
            ],
        }

    def test_library_requires_an_account(self):
        """A guest's pile lives in their browser; the server has no copy."""
        self.assertEqual(self.client.get('/api/reader/library/').status_code, 401)
        self.assertEqual(self.post(self.guest_pile()).status_code, 401)

    def test_guest_pile_is_adopted_on_the_first_authenticated_post(self):
        self.client.force_login(self.user)
        response = self.post(self.guest_pile())
        self.assertEqual(response.status_code, 200)

        data = response.json()
        self.assertEqual(
            {item['item_key'] for item in data['saved']},
            {'article-hypothesis-or-sentence', 'path-ai-in-research'},
        )
        self.assertEqual([item['item_key'] for item in data['following']],
                         ['topic-machine-hypothesis'])
        self.assertEqual(data['paths'][0]['done'], ['step-01', 'step-02'])
        self.assertEqual(data['paths'][0]['total'], 8)
        self.assertFalse(data['paths'][0]['completed'])

        stored = ReaderSavedItem.objects.get(item_key='article-hypothesis-or-sentence')
        self.assertEqual(stored.meta['reading'], '14 min read')

    def test_adopting_the_same_pile_twice_writes_no_duplicates(self):
        """Sign-in can be retried, or run in two tabs. Both must be harmless."""
        self.client.force_login(self.user)
        self.post(self.guest_pile())
        second = self.post(self.guest_pile())

        self.assertEqual(second.status_code, 200)
        self.assertEqual(ReaderSavedItem.objects.filter(user=self.user).count(), 3)
        self.assertEqual(LabProgress.objects.filter(user=self.user).count(), 1)

    def test_saving_again_refreshes_the_snapshot(self):
        """A row is what the reader saw, so a retitled piece updates in place."""
        self.client.force_login(self.user)
        self.post(self.guest_pile())
        self.post({'saved': [{
            'item_key': 'article-hypothesis-or-sentence',
            'kind': 'article',
            'title': 'Hypothesis, or a sentence that looks like one',
        }]})

        stored = ReaderSavedItem.objects.get(
            user=self.user, item_key='article-hypothesis-or-sentence',
        )
        self.assertEqual(stored.title, 'Hypothesis, or a sentence that looks like one')
        self.assertEqual(ReaderSavedItem.objects.filter(user=self.user).count(), 3)

    def test_the_same_key_can_be_both_saved_and_followed(self):
        self.client.force_login(self.user)
        self.post({
            'saved': [{'item_key': 'topic-machine-hypothesis', 'kind': 'topic', 'title': 'T'}],
            'following': [{'item_key': 'topic-machine-hypothesis', 'kind': 'topic', 'title': 'T'}],
        })
        self.assertEqual(ReaderSavedItem.objects.filter(
            user=self.user, item_key='topic-machine-hypothesis',
        ).count(), 2)

    def test_path_progress_from_two_devices_is_unioned_not_replaced(self):
        """The laptop ticked 1-2, the phone ticked 3. Neither may undo the other."""
        self.client.force_login(self.user)
        self.post(self.guest_pile())
        response = self.post({'paths': [{
            'item_key': 'path-ai-in-research',
            'done': ['step-03'],
        }]})

        self.assertEqual(response.json()['paths'][0]['done'],
                         ['step-01', 'step-02', 'step-03'])
        self.assertEqual(response.json()['paths'][0]['total'], 8)

    def test_unticking_a_step_replaces_the_set(self):
        """The explicit correction the union above must still allow."""
        self.client.force_login(self.user)
        self.post(self.guest_pile())
        response = self.post({'paths': [{
            'item_key': 'path-ai-in-research',
            'done': ['step-01'],
            'replace': True,
        }]})
        self.assertEqual(response.json()['paths'][0]['done'], ['step-01'])

    def test_finishing_every_step_marks_the_path_complete(self):
        self.client.force_login(self.user)
        response = self.post({'paths': [{
            'item_key': 'path-ai-in-research',
            'done': ['a', 'b'],
            'total': 2,
        }]})
        self.assertTrue(response.json()['paths'][0]['completed'])

    def test_removing_an_entry_takes_only_that_relation(self):
        self.client.force_login(self.user)
        self.post({
            'saved': [{'item_key': 'topic-machine-hypothesis', 'kind': 'topic', 'title': 'T'}],
            'following': [{'item_key': 'topic-machine-hypothesis', 'kind': 'topic', 'title': 'T'}],
        })
        response = self.client.delete(
            '/api/reader/library/',
            json.dumps({'relation': 'following', 'item_key': 'topic-machine-hypothesis'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['following'], [])
        self.assertEqual(len(response.json()['saved']), 1)

    def test_removing_a_path_drops_its_progress(self):
        self.client.force_login(self.user)
        self.post(self.guest_pile())
        response = self.client.delete(
            '/api/reader/library/',
            json.dumps({'relation': 'path', 'item_key': 'path-ai-in-research'}),
            content_type='application/json',
        )
        self.assertEqual(response.json()['paths'], [])
        self.assertFalse(LabProgress.objects.filter(user=self.user).exists())

    def test_one_readers_library_is_invisible_to_another(self):
        self.client.force_login(self.user)
        self.post(self.guest_pile())

        other = get_user_model().objects.create_user(
            'other@example.com', 'other@example.com', 'A-secure-password-123!'
        )
        self.client.force_login(other)
        data = self.client.get('/api/reader/library/').json()
        self.assertEqual(data['saved'], [])
        self.assertEqual(data['paths'], [])

    def test_lab_progress_is_not_reported_as_a_learning_path(self):
        """Only `path-` keys are curricula. A played lab is not one."""
        self.client.force_login(self.user)
        LabProgress.objects.create(
            user=self.user, lab_key='game-hypothesis-machine', state={'done': ['x']},
        )
        self.assertEqual(self.client.get('/api/reader/library/').json()['paths'], [])

    def test_malformed_entries_are_refused_rather_than_stored(self):
        self.client.force_login(self.user)

        cases = [
            ({'saved': [{'item_key': 'has spaces', 'title': 'T'}]}, 'invalid_item_key'),
            ({'saved': [{'item_key': 'ok-key', 'title': ''}]}, 'title_required'),
            ({'saved': [{'item_key': 'ok-key', 'title': 'T', 'kind': 'invented'}]}, 'invalid_kind'),
            ({'saved': [{'item_key': 'ok-key', 'title': 'T', 'meta': 'not-a-dict'}]}, 'invalid_payload'),
            ({'paths': [{'item_key': 'not-a-path', 'done': []}]}, 'invalid_item_key'),
        ]
        for payload, expected in cases:
            with self.subTest(error=expected):
                response = self.post(payload)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()['error'], expected)

        self.assertFalse(ReaderSavedItem.objects.filter(user=self.user).exists())

    def test_an_oversized_pile_is_refused(self):
        self.client.force_login(self.user)
        response = self.post({'saved': [
            {'item_key': f'item-{n}', 'title': f'Item {n}'} for n in range(301)
        ]})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()['error'], 'payload_too_large')

    def test_other_methods_are_refused(self):
        self.client.force_login(self.user)
        response = self.client.patch(
            '/api/reader/library/', json.dumps({}), content_type='application/json',
        )
        self.assertEqual(response.status_code, 405)

    # ---- The header count, and what clears it -----------------------------

    def test_new_rows_arrive_unseen(self):
        self.client.force_login(self.user)
        data = self.post(self.guest_pile()).json()
        self.assertFalse(any(item['seen'] for item in data['saved'] + data['following']))

    def test_the_library_screen_marks_only_the_rows_it_names(self):
        """Something saved in another tab after the screen loaded stays new."""
        self.client.force_login(self.user)
        self.post(self.guest_pile())

        data = self.post({'seen': {
            'saved': ['article-hypothesis-or-sentence'],
            'following': ['topic-machine-hypothesis'],
        }}).json()

        seen = {(item['item_key'], item['seen']) for item in data['saved'] + data['following']}
        self.assertIn(('article-hypothesis-or-sentence', True), seen)
        self.assertIn(('topic-machine-hypothesis', True), seen)
        self.assertIn(('path-ai-in-research', False), seen)

    def test_marking_seen_is_per_relation(self):
        """Seeing a topic you saved does not also see the follow of it."""
        self.client.force_login(self.user)
        item = {'item_key': 'topic-machine-hypothesis', 'kind': 'topic', 'title': 'T'}
        self.post({'saved': [item], 'following': [item]})

        data = self.post({'seen': {'saved': ['topic-machine-hypothesis']}}).json()
        self.assertTrue(data['saved'][0]['seen'])
        self.assertFalse(data['following'][0]['seen'])

    def test_seeing_twice_keeps_the_first_date_and_a_resave_keeps_it_seen(self):
        self.client.force_login(self.user)
        self.post(self.guest_pile())
        self.post({'seen': {'saved': ['article-hypothesis-or-sentence']}})
        row = ReaderSavedItem.objects.get(item_key='article-hypothesis-or-sentence')
        first = row.seen_at

        self.post({'seen': {'saved': ['article-hypothesis-or-sentence']}})
        # A replayed guest adoption must not turn the count back on.
        self.post(self.guest_pile())
        row.refresh_from_db()
        self.assertEqual(row.seen_at, first)

    def test_removing_and_saving_again_counts_as_new(self):
        self.client.force_login(self.user)
        self.post(self.guest_pile())
        self.post({'seen': {'saved': ['article-hypothesis-or-sentence']}})
        self.client.generic(
            'DELETE', '/api/reader/library/',
            json.dumps({'relation': 'saved', 'item_key': 'article-hypothesis-or-sentence'}),
            content_type='application/json',
        )
        data = self.post({'saved': [self.guest_pile()['saved'][0]]}).json()
        row = next(item for item in data['saved'] if item['item_key'] == 'article-hypothesis-or-sentence')
        self.assertFalse(row['seen'])

    def test_one_reader_cannot_mark_anothers_rows_seen(self):
        other = get_user_model().objects.create_user(
            'other@example.com', 'other@example.com', 'A-secure-password-123!'
        )
        self.client.force_login(other)
        self.post(self.guest_pile())

        self.client.force_login(self.user)
        self.post({'seen': {'saved': ['article-hypothesis-or-sentence']}})
        self.assertFalse(ReaderSavedItem.objects.filter(user=other, seen_at__isnull=False).exists())

    def test_a_malformed_seen_list_is_refused(self):
        self.client.force_login(self.user)
        self.assertEqual(self.post({'seen': ['article-x']}).status_code, 400)
        self.assertEqual(self.post({'seen': {'saved': 'article-x'}}).status_code, 400)
        response = self.post({'seen': {'saved': ['../../etc']}})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'invalid_item_key')
