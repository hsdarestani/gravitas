"""Regression tests for scoped canonical sync and PostgreSQL-safe note locking."""
import json
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase

from .canonical_middleware import CanonicalProjectMiddleware, project_scope_for


class CanonicalRequestScopeTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.user = get_user_model().objects.create_superuser(
            username='canonical-scope-tester', email='scope@example.test', password='test'
        )
        self.middleware = CanonicalProjectMiddleware(lambda request: None)

    def test_unscoped_notes_get_does_not_perform_any_remote_project_refresh(self):
        request = self.factory.get('/api/platform/nextcloud/notes/')
        request.user = self.user
        with patch('core.canonical_middleware.refresh_project') as refresh:
            result = self.middleware.process_view(
                request, lambda req: None, (), {}
            )
        self.assertIsNone(result)
        refresh.assert_not_called()

    def test_project_id_from_path_and_filter_are_both_scoped(self):
        request = self.factory.get('/api/platform/projects/208/tasks/')
        request.user = self.user
        self.assertEqual(project_scope_for(request, {'project_id': 208}), {208})
        request = self.factory.get('/api/platform/projects/', {'project': 77})
        request.user = self.user
        self.assertEqual(project_scope_for(request, {}), {77})


    def test_task_comment_requests_use_scoped_refresh_not_project_crawl(self):
        # Task-owned auxiliary endpoints should share the same narrow
        # canonical refresh path as task-board edits. A full DAV project
        # refresh before every comment turns one POST into hundreds of reads.
        from pathlib import Path
        source = (Path(__file__).parent / 'canonical_middleware.py').read_text()
        self.assertIn(
            r"/api/operating/tasks/\d+/(?:comments|checklist|attachments|history)/",
            source,
        )
        self.assertIn('refresh_task_scope(state.project, request.user, view_kwargs.get', source)

    def test_post_body_project_scoped_without_crawling_others(self):
        request = self.factory.post(
            '/api/platform/tasks/', data=json.dumps({'project_id': 208, 'title': 'test'}),
            content_type='application/json',
        )
        request.user = self.user
        self.assertEqual(project_scope_for(request, {}), {208})


class NullableNoteLockQueryContractTests(TestCase):
    def test_native_note_editor_locks_only_base_row(self):
        # SQLite cannot reproduce PostgreSQL's FOR UPDATE on nullable
        # outer-join error; retain a guard against reintroducing that query.
        source = (Path(__file__).parent / 'nextcloud_notes.py').read_text(encoding='utf-8')
        self.assertIn(
            'KnowledgeResource.objects.select_for_update().get(pk=resource.pk)',
            source,
        )
        self.assertNotIn(
            "KnowledgeResource.objects.select_for_update().select_related(\n            'project'",
            source,
        )
