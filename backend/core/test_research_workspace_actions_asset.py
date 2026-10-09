from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]


class ResearchWorkspaceActionContractTests(SimpleTestCase):
    def read(self, relative_path):
        return (ROOT / relative_path).read_text(encoding='utf-8')

    def test_workspace_loads_research_action_layer(self):
        html = self.read('workspace.html')
        self.assertIn('ws-research-actions.js', html)
        self.assertIn('installResearchWorkspaceActions()', html)

    def test_page_urls_open_notes_instead_of_the_removed_block_editor(self):
        # The block page editor is gone; every /workspace/page/ URL opens the
        # same note in Notes, so nothing may patch the old editor any more.
        js = self.read('assets/ws/ws-research-actions.js')
        app = self.read('assets/ws/ws-app.js')
        self.assertNotIn('repairEmptyEditor', js)
        self.assertNotIn('ws-editor-canvas', js)
        self.assertIn("if (route.view === 'editor' && route.pageId) {", app)
        self.assertIn('go(notePathFor(route.pageId), { replace: true });', app)
        self.assertNotIn('function renderEditor', app)

    def test_folder_branch_does_not_repeat_editor_page_tree(self):
        js = self.read('assets/ws/ws-research-actions.js')
        for label in ('Files & Data Rooms', 'Datasets', 'Mind Maps', 'Shared with me'):
            self.assertIn(label, js)
        self.assertIn("owner !== 'Folder'", js)
        self.assertIn('row.remove()', js)

    def test_file_and_dataset_views_expose_real_uploads(self):
        js = self.read('assets/ws/ws-research-actions.js')
        self.assertIn('/platform/files/upload/', js)
        self.assertIn("'Upload dataset'", js)
        self.assertIn("'Upload file'", js)
        self.assertIn('project_id', js)
        self.assertIn('workspace_id', js)

    def test_projects_can_be_created_from_research_workspace(self):
        js = self.read('assets/ws/ws-research-actions.js')
        self.assertIn("route() !== '/workspace/research/projects'", js)
        self.assertIn("request('/platform/projects/'", js)
        self.assertIn("'New project'", js)

    def test_mind_maps_expose_create_node_and_edge_actions(self):
        js = self.read('assets/ws/ws-research-actions.js')
        self.assertIn("request('/platform/mindmaps/'", js)
        self.assertIn("action: 'node.create'", js)
        self.assertIn("action: 'edge.create'", js)
        self.assertIn("action: 'node.delete'", js)
        self.assertIn("action: 'edge.delete'", js)

    def test_researcher_profile_is_editable(self):
        js = self.read('assets/ws/ws-research-actions.js')
        self.assertIn("route() !== '/workspace/people'", js)
        self.assertIn("request('/platform/researchers/me/'", js)
        self.assertIn("method: 'PATCH'", js)

    def test_shared_with_me_is_explicitly_read_only(self):
        js = self.read('assets/ws/ws-research-actions.js')
        self.assertIn("route() !== '/workspace/shared'", js)
        self.assertIn('read-only by design', js)
