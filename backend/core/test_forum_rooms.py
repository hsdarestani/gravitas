"""Seed integrity and admin-managed public room regression tests."""
import json
import re
from pathlib import Path
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings

from .test_forum import BASE, upstream

ROOT = Path(__file__).resolve().parents[2]
SPEC = json.loads((ROOT / 'backend/core/forum_rooms.json').read_text(encoding='utf-8'))
ROOMS = SPEC['rooms']
THEME = ROOT / 'discourse/theme'


class ForumRoomsFileTests(TestCase):
    def test_every_room_and_thread_is_complete_and_unique(self):
        slugs = [room['slug'] for room in ROOMS]
        self.assertEqual(len(slugs), len(set(slugs)))
        keys = []
        for room in ROOMS:
            self.assertRegex(room['slug'], r'^[a-z0-9-]+$')
            self.assertTrue(room['name'].strip())
            self.assertTrue(room['description'].strip())
            self.assertTrue(room['threads'], f'{room["slug"]} has no thread')
            for thread in room['threads']:
                keys += [thread['key'], *thread.get('also_keys', [])]
                self.assertTrue(thread['title'].strip())
                # An existing thread's text belongs to whoever posted it.
                self.assertEqual('body' in thread, not thread.get('existing', False))
        self.assertEqual(len(keys), len(set(keys)))

    def test_theme_reads_native_public_rooms(self):
        source = (THEME / 'javascripts/discourse/components/graviquest/forum-home.gjs').read_text(encoding='utf-8')
        self.assertNotIn('const ROOMS =', source)
        self.assertIn('this.site.categories', source)
        self.assertIn('category.read_restricted', source)

    def test_the_weeks_question_opens_a_thread_in_a_listed_room(self):
        # The week's question is the current Topic's question; its card opens
        # that Topic's thread through /api/forum/open/<key>/, so the key must
        # be one of this file's threads, in a room the Forum lists.
        source = (THEME / 'javascripts/discourse/components/graviquest/forum-home.gjs').read_text(encoding='utf-8')
        block = source[source.index('const WEEK'):source.index('};', source.index('const WEEK'))]
        key = re.search(r'/api/forum/open/([a-z0-9-]+)/', block).group(1)
        keys = {k for room in ROOMS for t in room['threads'] for k in [t['key'], *t.get('also_keys', [])]}
        self.assertIn(key, keys)

    def test_theme_does_not_hide_new_rooms_or_picker_options(self):
        css = (THEME / 'common/common.scss').read_text(encoding='utf-8')
        self.assertNotIn('not(.category-about-the-forum)', css)
        self.assertNotIn('data-name="About the Forum"', css)
        deploy = (ROOT / 'ops/discourse/rooms.rb').read_text(encoding='utf-8')
        self.assertIn('GQ_SEED_ROOMS', deploy)
        self.assertNotIn('category.set_permissions(admins: :full)', deploy)


@override_settings(GRAVITAS_FORUM_URL=BASE)
class ForumFeedAdminManagedRoomsTests(TestCase):
    def setUp(self):
        cache.clear()
        self.categories = {'category_list': {'categories': [
            {'id': 5, 'name': 'Future Topics', 'slug': 'propose-a-topic', 'topic_count': 2, 'position': 3},
            {'id': 99, 'name': 'Private staff', 'slug': 'staff', 'read_restricted': True},
            {'id': 6, 'name': 'AI in Research', 'slug': 'ai-in-research', 'topic_count': 3, 'position': 2},
            {'id': 30, 'name': 'About the Forum', 'slug': 'about-the-forum', 'topic_count': 1, 'position': 1},
        ]}}
        self.topics = {'topic_list': {'topics': [
            {'id': 16, 'category_id': 5, 'title': 'Weekly question', 'posts_count': 1},
            {'id': 21, 'category_id': 6, 'title': 'Discussion', 'posts_count': 1},
            {'id': 40, 'category_id': 30, 'title': 'Welcome', 'posts_count': 1},
        ]}}

    @patch('core.forum.requests.get')
    def test_feed_includes_new_public_rooms_in_admin_order(self, get):
        get.side_effect = [upstream(self.categories), upstream(self.topics)]
        data = self.client.get('/api/forum/feed/').json()
        self.assertEqual([c['slug'] for c in data['categories']], ['about-the-forum', 'ai-in-research', 'propose-a-topic'])
        self.assertEqual([t['id'] for t in data['topics']], [16, 21, 40])

    @patch('core.forum.requests.get')
    def test_private_room_is_not_a_feed_filter(self, get):
        get.side_effect = [upstream(self.categories)]
        self.assertEqual(self.client.get('/api/forum/feed/?category=99').status_code, 404)

    @patch('core.forum.requests.get')
    def test_admin_visibility_change_is_effective_on_next_request(self, get):
        private = {'category_list': {'categories': [
            {**c, 'read_restricted': True} if c['id'] == 5 else c
            for c in self.categories['category_list']['categories']]}}
        get.side_effect = [upstream(self.categories), upstream(self.topics),
                           upstream(private), upstream(self.topics)]
        first = self.client.get('/api/forum/feed/').json()
        second = self.client.get('/api/forum/feed/').json()
        self.assertIn(5, [c['id'] for c in first['categories']])
        self.assertNotIn(5, [c['id'] for c in second['categories']])
        self.assertNotIn(16, [t['id'] for t in second['topics']])
