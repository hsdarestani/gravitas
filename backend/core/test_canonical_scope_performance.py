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

    def test_core_task_readers_bypass_native_dav_and_transactions(self):
        """Core GET panels must not synchronously sync a Research project."""
        paths = [
            '/api/operating/task-board/726/?mode=preview',
            '/api/operating/task-board/726/',
            '/api/operating/tasks/726/history/',
            '/api/operating/tasks/726/comments/',
            '/api/operating/tasks/726/checklist/',
            '/api/operating/tasks/726/attachments/',
            '/api/operating/tasks/726/attachments/55/download/',
            '/api/calendar/google/tasks/726/status/',
            '/api/platform/tasks/726/',
        ]
        with (
            patch('core.canonical_middleware.project_scope_for',
                  side_effect=AssertionError('No project-wide scope reads for task GET')),
            patch('core.canonical_middleware.refresh_task_scope',
                  side_effect=AssertionError('No remote task refresh for GET')),
            patch('core.canonical_middleware.refresh_project',
                  side_effect=AssertionError('No remote project refresh for GET')),
        ):
            for path in paths:
                with self.subTest(path=path):
                    request = self.factory.get(path)
                    request.user = self.user
                    self.assertIsNone(self.middleware.process_view(
                        request, lambda req: None, (), {'task_id': 726},
                    ))

    def test_task_snapshot_exemption_never_applies_to_writes_or_other_live_reads(self):
        from .canonical_middleware import _committed_task_snapshot_read
        for path in (
            '/api/operating/task-board/726/',
            '/api/operating/tasks/726/comments/',
            '/api/operating/tasks/726/attachments/',
            '/api/calendar/google/tasks/726/status/',
        ):
            with self.subTest(path=path):
                self.assertFalse(_committed_task_snapshot_read(self.factory.patch(path)))
                self.assertFalse(_committed_task_snapshot_read(self.factory.post(path)))
                self.assertFalse(_committed_task_snapshot_read(self.factory.delete(path)))
        self.assertFalse(_committed_task_snapshot_read(
            self.factory.get('/api/platform/projects/71/cockpit/')
        ))
        self.assertFalse(_committed_task_snapshot_read(
            self.factory.get('/api/platform/projects/71/tasks/726/')
        ))

    def test_research_experiments_and_database_gets_skip_remote_refresh(self):
        from .canonical_middleware import _research_project_panel_snapshot_read
        reads = [
            '/api/platform/projects/208/experiments/',
            '/api/platform/projects/208/experiments/33/journal/',
            '/api/platform/projects/208/tools/data/tables/',
            '/api/platform/projects/208/tools/data/tables/12/rows/',
            '/api/platform/projects/208/tools/external/datasets/',
            '/api/platform/projects/208/tools/external/datasets/observations/rows/?limit=50',
        ]
        with (
            patch('core.canonical_middleware.project_scope_for',
                  side_effect=AssertionError('Research panel GET must not scan canonical scope')),
            patch('core.canonical_middleware.refresh_project',
                  side_effect=AssertionError('Research panel GET must not refresh Nextcloud')),
        ):
            for path in reads:
                with self.subTest(path=path):
                    request = self.factory.get(path)
                    request.user = self.user
                    self.assertTrue(_research_project_panel_snapshot_read(request))
                    self.assertIsNone(self.middleware.process_view(
                        request, lambda req: None, (), {'project_id': 208}
                    ))

    def test_all_db_backed_research_panels_reuse_snapshot_read_not_nextcloud(self):
        from .canonical_middleware import _research_project_panel_snapshot_read
        paths = [
            '/api/platform/projects/208/discussions/',
            '/api/platform/projects/208/milestones/',
            '/api/platform/projects/208/deliverables/',
            '/api/platform/projects/208/folders/',
            '/api/platform/projects/208/access-candidates/',
            '/api/platform/projects/208/tasks/',
            '/api/platform/projects/208/tools/git/',
            '/api/platform/projects/208/tools/git/commits/',
            '/api/platform/projects/208/tools/private-git/commits/',
            '/api/platform/projects/208/tools/builtin/',
            '/api/platform/projects/208/tools/providers/',
        ]
        with (
            patch('core.canonical_middleware.project_scope_for',
                  side_effect=AssertionError('DB snapshot GET must not walk DAV')),
            patch('core.canonical_middleware.refresh_project',
                  side_effect=AssertionError('DB snapshot GET must not refresh Nextcloud')),
            patch('core.canonical_middleware.refresh_task_scope',
                  side_effect=AssertionError('DB snapshot GET must not refresh a task')),
        ):
            for path in paths:
                with self.subTest(path=path):
                    req = self.factory.get(path)
                    req.user = self.user
                    self.assertTrue(_research_project_panel_snapshot_read(req))
                    self.assertIsNone(self.middleware.process_view(
                        req, lambda x: None, (), {'project_id': 208}
                    ))

    def test_research_write_routes_and_live_document_reads_are_not_exempt(self):
        from .canonical_middleware import _research_project_panel_snapshot_read
        for path in (
            '/api/platform/projects/208/experiments/',
            '/api/platform/projects/208/experiments/33/journal/',
            '/api/platform/projects/208/tools/data/tables/',
            '/api/platform/projects/208/tools/data/tables/12/rows/',
            '/api/platform/projects/208/discussions/',
            '/api/platform/projects/208/milestones/',
            '/api/platform/projects/208/tasks/',
            '/api/platform/projects/208/folders/',
        ):
            with self.subTest(path=path):
                self.assertFalse(_research_project_panel_snapshot_read(self.factory.post(path)))
                self.assertFalse(_research_project_panel_snapshot_read(self.factory.patch(path)))
                self.assertFalse(_research_project_panel_snapshot_read(self.factory.delete(path)))
        for path in (
            '/api/platform/projects/208/',
            '/api/platform/projects/208/experiments/33/',
            '/api/platform/projects/208/file-content/',
            '/api/platform/projects/208/structure/',
            '/api/platform/projects/208/tasks/',
        ):
            with self.subTest(path=path):
                self.assertFalse(_research_project_panel_snapshot_read(self.factory.get(path)))

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

    def test_isolated_tool_selection_patch_skips_canonical_refresh_only_on_that_route(self):
        request = self.factory.patch(
            '/api/platform/projects/226/tools/selection/',
            data=json.dumps({
                'selected_integrations': ['git'], 'requested_plugins': [],
            }),
            content_type='application/json',
        )
        request.user = self.user
        with (
            patch('core.canonical_middleware.project_scope_for',
                  side_effect=AssertionError('Selection should not inspect canonical scope')),
            patch('core.canonical_middleware.refresh_project',
                  side_effect=AssertionError('Selection should not call DAV')),
        ):
            self.assertIsNone(self.middleware.process_view(request, lambda req: None, (), {'project_id': 226}))

    def test_project_tool_status_reads_bypass_remote_native_sync(self):
        for suffix in ('status', 'plugins', 'providers'):
            request = self.factory.get(
                f'/api/platform/projects/226/tools/{suffix}/'
            )
            request.user = self.user
            with (
                patch('core.canonical_middleware.project_scope_for',
                      side_effect=AssertionError('No scope lookup on tool card GET')),
                patch('core.canonical_middleware.refresh_project',
                      side_effect=AssertionError('No DAV refresh on tool card GET')),
            ):
                self.assertIsNone(
                    self.middleware.process_view(request, lambda req: None, (), {'project_id': 226})
                )

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
