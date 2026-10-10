from pathlib import Path

from django.test import SimpleTestCase


class ResearchProjectActionsAssetTests(SimpleTestCase):
    def test_the_cockpit_draws_its_own_action_bar(self):
        # The bar used to mount itself over the cockpit and fetch it twice.
        root = Path(__file__).resolve().parents[2]
        workspace = (root / 'workspace.html').read_text(encoding='utf-8')
        project = (root / 'assets/ws/ws-project.js').read_text(encoding='utf-8')
        actions = (root / 'assets/ws/ws-project-actions.js').read_text(encoding='utf-8')
        self.assertNotIn('installResearchProjectActions', workspace)
        self.assertIn("head.insertBefore(projectActionBar({ projectId, tab, cockpit, go, refresh: rerender }), head.querySelector('.fl-tabs'));", project)
        self.assertIn('export function projectActionBar(', actions)
        self.assertNotIn('observeSurface', actions)

    def test_project_tabs_expose_mutations_without_native_dialog(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / 'assets/ws/ws-project-actions.js').read_text(encoding='utf-8')
        for text in (
            'Edit project',
            'Project access',
            'New milestone',
            'Edit milestone',
            'New task',
            'Edit task',
            'New project note',
            'Add source',
            'New map',
            'Edit map',
            'Upload dataset',
            'Upload file',
            'New discussion',
            'Manage discussions',
            'New experiment',
            'Edit experiment',
            'New deliverable',
            'Edit deliverable',
            'Open planning',
            "permissions?.can_edit",
            "permissions?.can_manage",
            'item.can_edit',
        ):
            self.assertIn(text, source)
        self.assertNotIn('.showModal(', source)
        self.assertNotIn("createElement('dialog')", source)

    def test_data_room_opens_the_project_team_folder_not_nextcloud_home(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / 'assets/ws/ws-project-actions.js').read_text(encoding='utf-8')
        self.assertIn('/platform/projects/${projectId}/nextcloud/sync/', source)
        self.assertIn('data?.team_folder?.native_url', source)
        self.assertNotIn("`${root}/index.php/apps/files/`", source)

    def test_mind_map_editor_is_interactive_not_a_static_project_row(self):
        root = Path(__file__).resolve().parents[2]
        actions = (root / 'assets/ws/ws-project-actions.js').read_text(encoding='utf-8')
        project = (root / 'assets/ws/ws-project.js').read_text(encoding='utf-8')
        editor = (root / 'assets/ws/ws-mindmap-editor.js').read_text(encoding='utf-8')
        workspace = (root / 'workspace.html').read_text(encoding='utf-8')

        self.assertIn("openMindMapEditor", actions)
        self.assertIn('export function openProjectMindMap(', actions)
        self.assertIn('openProjectMindMap(map.id);', project)
        self.assertIn("Delete map", project)
        self.assertIn("/platform/mindmaps/${map.id}/", project)
        self.assertIn("method: 'DELETE'", project)
        self.assertIn("Add node", editor)
        self.assertIn("Save node", editor)
        self.assertIn("Add connection", editor)
        self.assertIn("node.update", editor)
        self.assertIn("edge.create", editor)
        self.assertIn("edge.update", editor)
        self.assertIn("beginConnection", editor)
        self.assertIn("openNodeCanvasEditor", editor)
        self.assertIn("openEdgeCanvasEditor", editor)
        self.assertIn("dblclick", editor)
        self.assertIn("/assets/ws/ws-mindmap-editor.css?v=20261011-r3", workspace)

    def test_project_actions_use_canonical_endpoints(self):
        root = Path(__file__).resolve().parents[2]
        source = (root / 'assets/ws/ws-project-actions.js').read_text(encoding='utf-8')
        for endpoint in (
            '/platform/projects/${projectId}/milestones/',
            '/platform/projects/${projectId}/milestones/${fields.picker.value}/',
            '/platform/projects/${projectId}/tasks/',
            '/platform/tasks/${fields.picker.value}/',
            '/platform/resources/',
            '/platform/files/upload/',
            '/platform/share/',
            '/platform/projects/${projectId}/deliverables/',
            '/platform/projects/${projectId}/deliverables/${fields.picker.value}/',
        ):
            self.assertIn(endpoint, source)
