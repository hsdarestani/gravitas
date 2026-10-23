from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]
WS = ROOT / 'assets' / 'ws'


class WorkspaceRuntimePerformanceAssetTests(SimpleTestCase):
    def read(self, name):
        return (WS / name).read_text(encoding='utf-8')

    def test_runtime_helpers_filter_text_only_mutations(self):
        source = self.read('ws-runtime-performance.js')
        self.assertIn('document.visibilityState === \'hidden\'', source)
        self.assertIn('node.nodeType === Node.ELEMENT_NODE', source)
        self.assertIn('subtree,', source)

    def test_no_module_watches_the_view_to_patch_it(self):
        # Every screen draws itself; nothing observes #ws-view to repaint it.
        for name in ('ws-space-integration.js', 'ws-notes-performance.js', 'ws-project-actions.js', 'ws-core-content-actions.js'):
            self.assertNotIn('observeSurface', self.read(name), name)
            self.assertNotIn('new MutationObserver', self.read(name), name)

    def test_notes_remote_sync_is_idle_scheduled(self):
        source = self.read('ws-notes-performance.js')
        self.assertIn('scheduleIdle', source)
        self.assertIn('if (busy())', source)

    def test_cross_workspace_task_dialog_avoids_full_board_request(self):
        views = self.read('ws-views.js')
        platform = self.read('ws-platform.js')
        self.assertIn('P.operatingTaskDependencies()', views)
        self.assertIn('const detailData = await P.operatingTaskCard(taskId)', views)
        self.assertIn('Promise.resolve().then(stateLoader)', views)
        self.assertNotIn('const [detailData, boardState] = await Promise.all', views)
        self.assertIn('const result = await P.addOperatingTaskComment(task.id, comment.value.trim(), mentionUserIds)', views)
        self.assertIn('commentsPanel.body.insertBefore(item, commentForm)', views)
        self.assertNotIn('await reloadBoard({ keepDialog: true });\n            } catch (error) {\n              commentNote', views)
        self.assertIn('setTimeout(() => {', views)
        self.assertIn("'/operating/task-board/?mode=dependencies'", platform)

    def test_task_modal_does_not_cancel_slow_mobile_requests_or_discard_preview(self):
        platform = self.read('ws-platform.js')
        views = self.read('ws-views.js')
        self.assertNotIn('controller.abort()', platform)
        self.assertNotIn('setTimeout(() => controller.abort()', platform)
        self.assertIn('P.operatingTaskPreview(taskId).then(showTaskPreview)', views)
        self.assertIn('const showTaskPreview = ({ task: summary, events = [], hierarchy = {} }) =>', views)
        self.assertIn('showEvents(events)', views)
        self.assertIn('if (mobileReader)', views)
        self.assertIn('await previewRequest', views)
        self.assertIn("openTaskDialog(taskId, state, reloadBoard, { forceEditor: true })", views)
        self.assertNotIn('P.operatingTaskHistory(taskId).then((data)', views)
        self.assertIn('if (previewLoaded)', views)
        self.assertIn('Retry full editor', views)

    def test_core_overview_does_not_wait_for_optional_integrations(self):
        home = self.read('ws-home.js')
        core = home.split('function renderCoreBody(', 1)[1].split(
            '/* ---- Research Intelligence', 1)[0]
        self.assertIn("return P.dashboard('core')", core)
        self.assertNotIn("Promise.all([P.dashboard('core')", core)
        self.assertIn('pipelineLoad.then(', core)
        self.assertIn('calendarLoad.then(', core)

    def test_native_notes_full_scan_has_a_navigation_cooldown(self):
        notes = self.read('ws-notes-performance.js')
        self.assertIn('const MIN_GAP = 15 * 60 * 1000', notes)
        self.assertIn('if (busy())', notes)
        self.assertIn('scheduleIdle(', notes)

    def test_every_workspace_asset_carries_one_release_token(self):
        # The same module under two URLs is two modules with two states;
        # one token for the whole workspace keeps every module single.
        import re
        html = (ROOT / 'workspace.html').read_text(encoding='utf-8')
        tokens = set(re.findall(r'/assets/ws/ws(?:-[a-z0-9-]+)?\.(?:js|css)\?v=([A-Za-z0-9._-]+)', html))
        for name in WS.glob('ws-*.js'):
            source = name.read_text(encoding='utf-8')
            tokens |= set(re.findall(r"\./ws-[a-z0-9-]+\.js\?v=([A-Za-z0-9._-]+)", source))
            self.assertNotRegex(source, r"from '\./ws-[a-z0-9-]+\.js'", name.name)
        self.assertEqual(len(tokens), 1, tokens)
