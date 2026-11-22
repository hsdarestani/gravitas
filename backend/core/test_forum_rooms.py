"""The Forum's rooms are one list, backend/core/forum_rooms.json.

It is read in three places that cannot import one another: ops/discourse/
rooms.rb makes the rooms and the team's threads on Discourse, the theme
(forum-home.gjs and common.scss) shows them, and core/forum.py limits the
public feed to them. These tests fail when the theme and the file disagree,
and pin what the feed does with a room the Forum no longer lists.
"""
import json
import re
from pathlib import Path
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings

from core.forum import forum_rooms

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

    def test_the_backend_reads_the_same_list(self):
        self.assertEqual(forum_rooms(), [room['slug'] for room in ROOMS])

    def test_the_theme_lists_the_same_rooms_in_the_same_order(self):
        source = (THEME / 'javascripts/discourse/components/graviquest/forum-home.gjs').read_text(encoding='utf-8')
        block = source[source.index('const ROOMS'):source.index('];', source.index('const ROOMS'))]
        self.assertEqual(re.findall(r'"([a-z0-9-]+)"', block), [room['slug'] for room in ROOMS])

    def test_the_weeks_question_opens_a_thread_in_a_listed_room(self):
        # The week's question is the current Topic's question; its card opens
        # that Topic's thread through /api/forum/open/<key>/, so the key must
        # be one of this file's threads, in a room the Forum lists.
        source = (THEME / 'javascripts/discourse/components/graviquest/forum-home.gjs').read_text(encoding='utf-8')
        block = source[source.index('const WEEK'):source.index('};', source.index('const WEEK'))]
        key = re.search(r'/api/forum/open/([a-z0-9-]+)/', block).group(1)
        keys = {k for room in ROOMS for t in room['threads'] for k in [t['key'], *t.get('also_keys', [])]}
        self.assertIn(key, keys)

    def test_the_menu_and_the_new_thread_picker_follow_the_list(self):
        css = (THEME / 'common/common.scss').read_text(encoding='utf-8')
        for room in ROOMS:
            self.assertIn(f'[href*="/{room["slug"]}/"]', css)
        picker = re.search(r'#reply-control \.category-chooser \.select-kit-row:not\(:is\((.*?)\)\)\{', css).group(1)
        self.assertEqual(re.findall(r'data-name="([^"]+)"', picker), [room['name'] for room in ROOMS])


@override_settings(GRAVITAS_FORUM_URL=BASE)
class ForumFeedListsOnlyTheRoomsTests(TestCase):
    def setUp(self):
        cache.clear()
        self.categories = {'category_list': {'categories': [
            {'id': 5, 'name': 'The Weighty Question', 'slug': 'open-question', 'topic_count': 2},
            {'id': 6, 'name': 'AI in Research', 'slug': 'ai-in-research', 'topic_count': 3},
            {'id': 30, 'name': 'About the Forum', 'slug': 'about-the-forum', 'topic_count': 1},
        ]}}
        self.topics = {'topic_list': {'topics': [
            {'id': 16, 'category_id': 5, 'title': 'Weekly question', 'posts_count': 1},
            {'id': 21, 'category_id': 6, 'title': 'Discussion', 'posts_count': 1},
            {'id': 40, 'category_id': 30, 'title': 'Welcome', 'posts_count': 1},
        ]}}

    @patch('core.forum.requests.get')
    def test_feed_holds_the_listed_rooms_in_the_files_order(self, get):
        get.side_effect = [upstream(self.categories), upstream(self.topics)]
        data = self.client.get('/api/forum/feed/').json()
        self.assertEqual([c['slug'] for c in data['categories']], ['about-the-forum', 'ai-in-research'])
        self.assertEqual([t['id'] for t in data['topics']], [21, 40])

    @patch('core.forum.requests.get')
    def test_a_room_the_forum_no_longer_lists_is_not_a_feed_filter(self, get):
        get.side_effect = [upstream(self.categories)]
        self.assertEqual(self.client.get('/api/forum/feed/?category=5').status_code, 404)
