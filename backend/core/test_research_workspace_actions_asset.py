from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]


class ResearchWorkspaceActionContractTests(SimpleTestCase):
    """Research screens draw their own actions.

    These used to be painted on by ws-research-actions.js, ws-task-deck-fixes.js
    and ws-space-integration.js after the screens had drawn; all three overlays
    are gone and the actions live in the renderers that own each screen.
    """

    def read(self, relative_path):
        return (ROOT / relative_path).read_text(encoding='utf-8')

    def test_no_research_overlay_is_loaded(self):
        html = self.read('workspace.html')
        for name in ('ws-research-actions.js', 'ws-task-deck-fixes.js', 'ws-task-deck-mirror.js'):
            self.assertNotIn(name, html)
            self.assertFalse((ROOT / 'assets' / 'ws' / name).exists(), name)

    def test_page_urls_open_notes_instead_of_the_removed_block_editor(self):
        app = self.read('assets/ws/ws-app.js')
        self.assertIn("if (route.view === 'editor' && route.pageId) {", app)
        self.assertIn('go(notePathFor(route.pageId), { replace: true });', app)
        self.assertNotIn('function renderEditor', app)

    def test_file_and_dataset_views_upload_in_place(self):
        js = self.read('assets/ws/ws-views.js')
        self.assertIn("P.upload('/platform/files/upload/', form)", js)
        self.assertIn("'Upload dataset'", js)
        self.assertIn("'Upload file'", js)
        self.assertIn("form.append('project_id', project.value)", js)
        self.assertIn('workspace_id', js)
        self.assertNotIn('location.reload()', js)

    def test_projects_and_tasks_are_created_from_one_module(self):
        create = self.read('assets/ws/ws-research-create.js')
        research = self.read('assets/ws/ws-research.js')
        home = self.read('assets/ws/ws-home.js')
        self.assertIn("P.call('/platform/projects/', { method: 'POST'", create)
        self.assertIn('space_category_id', create)
        self.assertIn("P.call(`/platform/projects/${projectId}/tasks/`", create)
        self.assertNotIn('location.reload()', create)
        for source in (research, home):
            self.assertIn('openNewProject({ go })', source)
            self.assertIn('openNewTask({ go })', source)
        self.assertNotIn('enhanceProjectCreate', self.read('assets/ws/ws-space-integration.js'))

    def test_mind_maps_have_one_editor(self):
        js = self.read('assets/ws/ws-views.js')
        for action in ('node.create', 'node.update', 'node.delete', 'edge.create', 'edge.delete'):
            self.assertIn(f"action:'{action}'", js)

    def test_researcher_profile_is_editable(self):
        js = self.read('assets/ws/ws-views.js')
        self.assertIn("P.call('/platform/researchers/me/', { method: 'PATCH'", js)
        self.assertIn("'Edit my profile'", js)

    def test_shared_with_me_is_explicitly_read_only(self):
        self.assertIn('read-only by design', self.read('assets/ws/ws-views.js'))

    def test_research_requests_are_a_view_of_tasks(self):
        research = self.read('assets/ws/ws-research.js')
        self.assertIn("get('show') === 'requests') return renderRequests(host, { go })", research)
        self.assertIn('P.researchRequests()', research)
