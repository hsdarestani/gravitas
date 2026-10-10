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

    def test_heavy_enhancers_do_not_watch_nested_workspace_mutations(self):
        for name in (
            'ws-project-actions.js',
            'ws-space-integration.js',
            'ws-notes-performance.js',
        ):
            source = self.read(name)
            self.assertIn('observeSurface', source, name)
            self.assertIn('subtree: false', source, name)

    def test_notes_remote_sync_is_idle_scheduled(self):
        source = self.read('ws-notes-performance.js')
        self.assertIn('scheduleIdle', source)
        self.assertIn("'syncScheduled'", source)
        self.assertIn('editorIsBusy()', source)

    def test_workspace_cache_busts_all_performance_modules(self):
        html = (ROOT / 'workspace.html').read_text(encoding='utf-8')
        self.assertIn('/assets/ws/ws-project-actions.js?v=20261008-operational2', html)
        self.assertIn('/assets/ws/ws-notes-performance.js?v=20261010-notes2', html)
        self.assertIn('/assets/ws/ws-space-integration.js?v=20261011-r1', html)
