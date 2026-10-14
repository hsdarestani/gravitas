"""Nextcloud JSON sidecar comment tests with a single note identity."""
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase, SimpleTestCase

from .anchored_comments import _read, _write, anchored_comments
from .models import KnowledgeResource
from .platform_runtime_v3 import ensure_platform_workspaces


class AnchoredCommentsTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser(
            username='comment-admin', email='comment-admin@example.test', password='test'
        )
        self.workspace = ensure_platform_workspaces(self.user)['research']
        self.note = KnowledgeResource.objects.create(
            owner=self.user, workspace=self.workspace, kind=KnowledgeResource.Kind.NOTE,
            title='Note', body='first line\nsecond line',
            metadata={'ws_space': 'research'},
        )
        self.rf = RequestFactory()

    def post(self, **data):
        request = self.rf.post(
            f'/api/platform/anchored-comments/note/{self.note.id}/',
            data=json.dumps(data), content_type='application/json',
        )
        request.user = self.user
        return anchored_comments(request, 'note', self.note.pk)

    def test_line_anchor_uses_current_text_and_separate_sidecar(self):
        empty = {'schema':1, 'target': {'kind':'note','id':self.note.id}, 'comments':[]}
        with patch('core.anchored_comments._read', return_value=(empty, None)), \
             patch('core.anchored_comments._write', return_value=True) as write:
            response = self.post(field='content', line=2, quote='second line', text='Please cite this.')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(write.call_args.args[2]['comments'][0]['anchor']['line'], 2)
        self.assertEqual(write.call_args.args[2]['comments'][0]['text'], 'Please cite this.')
        self.note.refresh_from_db()
        self.assertEqual(self.note.body, 'first line\nsecond line')

    def test_stale_quote_rejected_without_writing(self):
        empty = {'schema':1, 'target': {'kind':'note','id':self.note.id}, 'comments':[]}
        with patch('core.anchored_comments._read', return_value=(empty, None)), \
             patch('core.anchored_comments._write') as write:
            response = self.post(field='content', line=1, quote='old text', text='Comment')
        self.assertEqual(response.status_code, 409)
        write.assert_not_called()

    def test_locked_file_does_not_claim_comment_posted(self):
        empty = {'schema':1, 'target': {'kind':'note','id':self.note.id}, 'comments':[]}
        with patch('core.anchored_comments._read', return_value=(empty, None)), \
             patch('core.anchored_comments._write', return_value=False):
            response = self.post(field='content', line=1, quote='first line', text='Comment')
        self.assertEqual(response.status_code, 409)


class SidecarCASBoundaryTests(SimpleTestCase):
    @patch('core.anchored_comments.cloud._admin_auth', return_value=('user', 'pass'))
    @patch('core.anchored_comments.cloud._admin_dav_url', return_value='https://fake.invalid/data')
    @patch('core.anchored_comments.cloud.admin_make_folder')
    @patch('core.anchored_comments.cloud._request')
    @patch('core.anchored_comments._read')
    def test_put_uses_if_match_and_readback(self, read, request, _mkdir, _url, _auth):
        data = {'schema': 1, 'target': {'kind':'note', 'id':5},
                'comments': [{'id':'c1'}]}
        request.return_value = SimpleNamespace(status_code=204)
        read.return_value = (data, '"e2"')
        self.assertTrue(_write('note', 5, data, '"e1"'))
        self.assertEqual(request.call_args.kwargs['headers']['If-Match'], '"e1"')

    @patch('core.anchored_comments.cloud._admin_auth', return_value=('user', 'pass'))
    @patch('core.anchored_comments.cloud._admin_dav_url', return_value='https://fake.invalid/data')
    @patch('core.anchored_comments.cloud.admin_make_folder')
    @patch('core.anchored_comments.cloud._request')
    def test_locked_nextcloud_does_not_write_unconditionally(self, request, _mkdir, _url, _auth):
        request.return_value = SimpleNamespace(status_code=423)
        data = {'schema': 1, 'target': {'kind':'task', 'id':6}, 'comments': [{'id':'c'}]}
        self.assertFalse(_write('task', 6, data, None))
        self.assertEqual(request.call_args.kwargs['headers']['If-None-Match'], '*')
