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

    def test_every_workspace_asset_carries_one_release_token(self):
        # The same module under two URLs is two modules with two states;
        # one token for the whole workspace keeps every module single.
        import re
        html = (ROOT / 'workspace.html').read_text(encoding='utf-8')
        tokens = set(re.findall(r'/assets/ws/ws-[a-z0-9-]+\.(?:js|css)\?v=([A-Za-z0-9._-]+)', html))
        for name in WS.glob('ws-*.js'):
            source = name.read_text(encoding='utf-8')
            tokens |= set(re.findall(r"\./ws-[a-z0-9-]+\.js\?v=([A-Za-z0-9._-]+)", source))
            self.assertNotRegex(source, r"from '\./ws-[a-z0-9-]+\.js'", name.name)
        self.assertEqual(len(tokens), 1, tokens)
