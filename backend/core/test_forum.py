import base64
import hashlib
import hmac
import json
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlencode, urlsplit

import requests
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from core.email_verification import mark_email_verified
from core.forum_models import ForumDiscussion, ForumLogout
from core.models import ContentItem

SECRET = 'test-only-discourse-secret-never-a-production-value'
BASE = 'https://forum.graviquest.com'


def signed(fields=None):
    payload = base64.b64encode(urlencode(fields or {
        'nonce': 'a-one-time-nonce', 'return_sso_url': BASE + '/session/sso_login',
    }, doseq=True).encode()).decode()
    return {'sso': payload, 'sig': hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()}


def upstream(data, status=200):
    return Mock(status_code=status, content=b'{}', json=Mock(return_value=data))


@override_settings(GRAVITAS_FORUM_URL=BASE, GRAVITAS_DISCOURSE_CONNECT_SECRET=SECRET)
class ForumIdentityTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='existing@example.com', email='existing@example.com', password='existing-password')

    def sign_in(self, verified=True):
        if verified:
            mark_email_verified(self.user)
        self.client.force_login(self.user)

    def test_guest_uses_existing_login_without_payload_in_url(self):
        response = self.client.get('/api/forum/sso/', signed())
        self.assertEqual(response.url, '/login?continue=forum')
        self.assertTrue(response.cookies['gq_forum_continue']['secure'])
        self.assertIn('forum_pending_sso', self.client.session)

    def test_existing_verified_identity_is_stable_and_not_privileged(self):
        self.sign_in()
        response = self.client.get('/api/forum/sso/', {**signed(), 'admin': 'true'})
        self.assertEqual(response.status_code, 302)
        query = parse_qs(urlsplit(response.url).query)
        self.assertTrue(hmac.compare_digest(query['sig'][0], hmac.new(SECRET.encode(), query['sso'][0].encode(), hashlib.sha256).hexdigest()))
        fields = parse_qs(base64.b64decode(query['sso'][0]).decode())
        self.assertEqual(fields['external_id'], [f'graviquest:{self.user.pk}'])
        self.assertEqual(fields['email'], [self.user.email])
        self.assertEqual(fields['admin'], ['false'])
        self.assertEqual(fields['moderator'], ['false'])
        self.assertNotIn('@', fields['name'][0])
        self.assertIn('researchers', fields['remove_groups'][0])
        self.assertEqual(response['Referrer-Policy'], 'no-referrer')
        self.assertEqual(get_user_model().objects.filter(email=self.user.email).count(), 1)

    def test_unverified_existing_account_cannot_take_over_forum_by_email(self):
        self.sign_in(verified=False)
        self.assertEqual(self.client.get('/api/forum/sso/', signed()).status_code, 403)

    def test_only_explicit_forum_groups_grant_private_membership(self):
        self.sign_in()
        group = Group.objects.create(name='graviquest-forum-researchers')
        self.user.groups.add(group)
        response = self.client.get('/api/forum/sso/', signed())
        data = parse_qs(base64.b64decode(parse_qs(urlsplit(response.url).query)['sso'][0]).decode())
        self.assertEqual(data['add_groups'], ['researchers'])
        self.assertEqual(data['moderator'], ['false'])

    def test_suspended_profile_cannot_sign_into_forum(self):
        self.sign_in()
        profile = self.user.gravitas_community_profile
        profile.status = 'suspended'; profile.save()
        self.assertEqual(self.client.get('/api/forum/sso/', signed()).status_code, 403)

    @patch('core.forum.revoke_forum_sessions')
    def test_suspension_revokes_existing_native_sessions_after_commit(self, revoke):
        self.sign_in()
        with self.captureOnCommitCallbacks(execute=True):
            profile = self.user.gravitas_community_profile
            profile.status = 'suspended'; profile.save()
        revoke.assert_called_once_with(self.user)

    @patch('core.forum.revoke_forum_sessions')
    def test_removing_private_group_revokes_native_sessions(self, revoke):
        group = Group.objects.create(name='graviquest-forum-researchers')
        self.user.groups.add(group)
        with self.captureOnCommitCallbacks(execute=True):
            group.user_set.remove(self.user)
        revoke.assert_called_once_with(self.user)

    @patch('core.forum.revoke_forum_sessions')
    def test_removing_admin_authority_revokes_native_sessions(self, revoke):
        self.user.is_superuser = True; self.user.save(update_fields=['is_superuser'])
        with self.captureOnCommitCallbacks(execute=True):
            self.user.is_superuser = False; self.user.save(update_fields=['is_superuser'])
        revoke.assert_called_once_with(self.user)

    def test_bad_signature_rejected_before_login(self):
        data = signed(); data['sig'] = '0' * 64
        self.assertEqual(self.client.get('/api/forum/sso/', data).status_code, 400)
        self.assertNotIn('forum_pending_sso', self.client.session)

    def test_signed_external_redirect_rejected(self):
        for url in ['https://evil.example/session/sso_login', BASE + '/session/sso_login?next=evil', BASE + '.evil.example/session/sso_login', 'http://forum.graviquest.com/session/sso_login']:
            with self.subTest(url=url):
                self.assertEqual(self.client.get('/api/forum/sso/', signed({'nonce':'n', 'return_sso_url':url})).status_code, 400)

    def test_duplicate_fields_and_malformed_base64_rejected(self):
        self.assertEqual(self.client.get('/api/forum/sso/', signed({'nonce':['a','b'], 'return_sso_url':BASE + '/session/sso_login'})).status_code, 400)
        p = '!invalid-base64!'
        data = {'sso':p, 'sig':hmac.new(SECRET.encode(), p.encode(), hashlib.sha256).hexdigest()}
        self.assertEqual(self.client.get('/api/forum/sso/', data).status_code, 400)

    def test_pending_login_can_resume_without_open_redirect(self):
        self.client.get('/api/forum/sso/', signed())
        self.sign_in()
        self.assertTrue(self.client.get('/api/forum/resume/?next=https://evil.example').url.startswith('/api/forum/sso/?'))

    def test_missing_secret_is_unavailable(self):
        with override_settings(GRAVITAS_DISCOURSE_CONNECT_SECRET=''):
            self.assertEqual(self.client.get('/api/forum/sso/', signed()).status_code, 503)

    def test_logout_requires_post_and_csrf(self):
        client = Client(enforce_csrf_checks=True); client.force_login(self.user)
        self.assertEqual(client.get('/api/forum/logout/').status_code, 405)
        self.assertEqual(client.post('/api/forum/logout/').status_code, 403)
        self.assertIn('_auth_user_id', client.session)

    def test_native_logout_landing_does_not_allow_get_logout_csrf(self):
        self.sign_in()
        response = self.client.get('/api/forum/signed-out/')
        self.assertContains(response, 'csrfmiddlewaretoken')
        self.assertIn('_auth_user_id', self.client.session)

    @patch('core.forum.revoke_forum_sessions', side_effect=Exception('should not be called'))
    def test_unconfigured_forum_preserves_workspace_logout(self, revoke):
        self.sign_in()
        with override_settings(GRAVITAS_FORUM_URL=''):
            self.assertEqual(self.client.post('/api/auth/logout/').status_code, 200)
        revoke.assert_not_called()

    @patch('core.forum.requests.get', side_effect=requests.ConnectionError)
    @override_settings(GRAVITAS_DISCOURSE_API_KEY='test-only')
    def test_forum_outage_does_not_prevent_local_logout_and_is_retryable(self, get):
        self.sign_in()
        self.assertEqual(self.client.post('/api/auth/logout/').status_code, 200)
        self.assertNotIn('_auth_user_id', self.client.session)
        self.assertTrue(ForumLogout.objects.filter(user=self.user).exists())

    @patch('core.forum.requests.get', side_effect=requests.ConnectionError)
    @override_settings(GRAVITAS_DISCOURSE_API_KEY='test-only')
    def test_account_deletion_keeps_retryable_native_session_revocation(self, get):
        self.sign_in()
        identity = f'graviquest:{self.user.pk}'
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post('/api/auth/delete/',
                {'password':'existing-password', 'confirmation':'delete'}, content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['deleted'])
        self.assertTrue(ForumLogout.objects.filter(external_id=identity, user__isnull=True).exists())


@override_settings(GRAVITAS_FORUM_URL=BASE, GRAVITAS_DISCOURSE_API_KEY='must-never-be-in-public-reads')
class ForumPublicDataTests(TestCase):
    def setUp(self):
        cache.clear()
        self.categories = {'category_list': {'categories': [
            {'id':1,'name':'Open Question','slug':'open-question','topic_count':2},
            {'id':9,'name':'Private research','slug':'research','read_restricted':True},
        ]}}
        self.topic = {'id':5,'category_id':1,'title':'An actual question', 'excerpt':'<b>Published</b> reasoning', 'posts_count':3,'like_count':0}

    @patch('core.forum.requests.get')
    def test_feed_uses_only_anonymous_reads_and_excludes_private_categories(self, get):
        get.side_effect = [upstream(self.categories), upstream({'topic_list':{'topics':[self.topic, {**self.topic, 'id':6,'category_id':9}]}})]
        response = self.client.get('/api/forum/feed/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([x['id'] for x in response.json()['topics']], [5])
        self.assertEqual(response.json()['topics'][0]['reply_count'], 2)
        self.assertEqual(response.json()['topics'][0]['excerpt'], 'Published reasoning')
        for call in get.call_args_list:
            self.assertNotIn('Api-Key', call.kwargs['headers'])
            self.assertFalse(call.kwargs['allow_redirects'])
        self.assertNotContains(response, 'must-never-be-in-public-reads')

    def test_bounded_filters_reject_arbitrary_upstream_paths(self):
        for query in ['sort=../../admin/users','page=-1','page=101','category=private','page=invalid']:
            self.assertEqual(self.client.get('/api/forum/feed/?' + query).status_code, 400)

    @patch('core.forum.requests.get')
    def test_table_metadata_is_native_and_unknown_counts_are_not_invented(self, get):
        topic = {**self.topic, 'views':12, 'posters':[{'user_id':10}, {'user_id':11}]}
        get.side_effect = [upstream(self.categories), upstream({'users':[
            {'id':10,'username':'actual','name':'Actual member','avatar_template':'/user_avatar/forum.graviquest.com/actual/{size}/1.png'},
            {'id':11,'username':'another','avatar_template':'//tracking.example/image.png'},
        ],'topic_list':{'topics':[topic, {'id':6,'category_id':1}]}})]
        first, second = self.client.get('/api/forum/feed/').json()['topics']
        self.assertEqual(first['view_count'],12)
        self.assertEqual(first['participants'][0]['avatar_url'],BASE + '/user_avatar/forum.graviquest.com/actual/48/1.png')
        self.assertIsNone(first['participants'][1]['avatar_url'])
        self.assertIsNone(second['reply_count'])
        self.assertIsNone(second['view_count'])
        self.assertEqual(second['participants'],[])

    def test_permanent_links_only_use_configured_origin_and_published_mappings(self):
        self.assertEqual(self.client.get('/api/forum/start/?next=https://evil.example').url,BASE + '/new-topic')
        self.assertEqual(self.client.get('/api/forum/open/missing/').status_code,404)
        link = ForumDiscussion.objects.create(content_key='published',discourse_topic_id=5,discourse_category_id=1,is_public=True)
        self.assertEqual(self.client.get('/api/forum/open/published/?url=https://evil.example').url,BASE + '/t/5')
        link.is_public=False; link.save()
        self.assertEqual(self.client.get('/api/forum/open/published/').status_code,404)

    @patch('core.forum.requests.get')
    def test_private_category_filter_is_not_found(self, get):
        get.return_value = upstream(self.categories)
        self.assertEqual(self.client.get('/api/forum/feed/?category=9').status_code, 404)
        self.assertEqual(get.call_count, 1)

    @patch('core.forum.requests.get')
    def test_redirect_and_failure_are_never_silently_successful(self, get):
        for code in [301,401,403,404,429,500,502,504]:
            with self.subTest(code=code):
                cache.clear(); get.return_value = upstream({},code)
                response = self.client.get('/api/forum/feed/')
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response['Cache-Control'], 'no-store, max-age=0, no-cache, must-revalidate, private')

    @patch('core.forum.requests.get')
    def test_private_or_unpublished_mapping_never_contacts_discourse(self, get):
        content = ContentItem.objects.create(slug='draft-science',title='Draft')
        link = ForumDiscussion.objects.create(content_key='draft-science',content=content,discourse_topic_id=5,discourse_category_id=1,is_public=True)
        self.assertEqual(self.client.get('/api/forum/discussions/draft-science/').status_code, 404)
        link.content = None; link.is_public = False; link.save()
        self.assertEqual(self.client.get('/api/forum/discussions/draft-science/').status_code, 404)
        get.assert_not_called()

    @patch('core.forum.requests.get')
    def test_mapping_does_not_override_live_private_category_acl(self, get):
        ForumDiscussion.objects.create(content_key='linked',discourse_topic_id=5,discourse_category_id=1,is_public=True)
        get.side_effect = [upstream({**self.topic,'category_id':9}), upstream(self.categories)]
        self.assertEqual(self.client.get('/api/forum/discussions/linked/').status_code, 404)

    @patch('core.forum.requests.get')
    def test_persisted_mapping_returns_native_reply_relationships_and_no_html(self, get):
        ForumDiscussion.objects.create(content_key='linked',discourse_topic_id=5,discourse_category_id=1,is_public=True,content_version='sha256:real-version')
        get.side_effect = [upstream({**self.topic,'post_stream':{'posts':[
            {'id':21,'post_number':1,'username':'member','cooked':'<p>Actual post</p>'},
            {'id':22,'post_number':2,'username':'other','cooked':'<p>A reply</p>','reply_to_post_number':1},
            {'id':23,'post_number':3,'cooked':'Hidden','hidden':True} ]}}), upstream(self.categories)]
        response = self.client.get('/api/forum/discussions/linked/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['posts'][1]['reply_to_post_number'], 1)
        self.assertEqual(len(response.json()['posts']), 2)
        self.assertEqual(response.json()['content_version'], 'sha256:real-version')

    @patch('core.forum.requests.get')
    def test_failure_recovery_reads_real_data(self, get):
        get.side_effect = requests.Timeout
        self.assertEqual(self.client.get('/api/forum/feed/').status_code, 503)
        get.side_effect = [upstream(self.categories),upstream({'topic_list':{'topics':[self.topic]}})]
        self.assertEqual(self.client.get('/api/forum/feed/').json()['topics'][0]['id'],5)

    def test_unsafe_operator_url_is_not_a_redirect_or_ssrf_surface(self):
        for value in ['http://forum.example','https://user:password@forum.example','https://forum.example/admin?x=1']:
            with override_settings(GRAVITAS_FORUM_URL=value):
                self.assertEqual(self.client.get('/api/forum/config/').status_code,503)


class ForumPublishedSourceTests(TestCase):
    @override_settings(PUBLIC_BASE_URL='https://graviquest.com')
    def test_only_published_cms_and_explicitly_linked_static_topic_are_exported(self):
        from core.forum_content import published_manifest
        ContentItem.objects.create(slug='published-science',title='Published science',kind='topic',status='published')
        ContentItem.objects.create(slug='draft-science',title='Draft',kind='topic',status='draft')
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            page=root/'topic-answer-that-looked-right.html'
            page.write_text('<main><h1>The <em>Answer</em> That Looked Right</h1><p>Published material</p></main>')
            self.assertNotIn('answer-that-looked-right',{x['key'] for x in published_manifest(root)['published_content']})
            (root/'index.html').write_text('<a href="topic-answer-that-looked-right.html">Topic 01</a>')
            exported=published_manifest(root)['published_content']
            keys={x['key'] for x in exported}
            self.assertTrue({'published-science','answer-that-looked-right'}.issubset(keys))
            self.assertNotIn('draft-science',keys)
            static=next(x for x in exported if x['source']=='static')
            self.assertEqual(static['title'],'The Answer That Looked Right')
            self.assertIsNone(static['id'])
            self.assertTrue(static['version'].startswith('sha256:'))

    def test_static_manifest_cannot_create_arbitrary_topic_mappings(self):
        from django.core.management import call_command, CommandError
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'links.json'
            path.write_text(json.dumps({'links':[{'key':'invented-science','source':'static','topic_id':5,'category_id':1}]}))
            with self.assertRaises(CommandError):
                call_command('forum_content_manifest',import_links=str(path))
        self.assertFalse(ForumDiscussion.objects.exists())
