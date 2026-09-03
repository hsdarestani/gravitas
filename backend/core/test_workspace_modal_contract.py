from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]


class WorkspaceModalContractTests(SimpleTestCase):
    def read(self, relative_path):
        return (ROOT / relative_path).read_text(encoding='utf-8')

    def test_dialog_compat_loads_before_workspace_runtime(self):
        html = self.read('workspace.html')
        compat = html.index('/assets/dialog-compat.js')
        runtime = html.index('function add(src,onload)')
        self.assertLess(compat, runtime)

    def test_dialog_compat_disables_native_top_layer_for_every_dialog(self):
        compat = self.read('assets/dialog-compat.js')
        self.assertIn('HTMLDialogElement.prototype', compat)
        self.assertIn('proto.showModal=function()', compat)
        self.assertIn("dialog.setAttribute('open','')", compat)
        self.assertIn('g-dom-dialog-backdrop', compat)

    def test_all_workspace_dialog_entry_points_are_covered(self):
        sources = [
            'assets/workspace.js',
            'assets/platform-v2.js',
            'assets/operating.js',
            'assets/operating-enhancements.js',
            'assets/operating-task-detail.js',
            'assets/initiative-planner.js',
            'assets/initiative-task-editor.js',
            'assets/mindmap-editor-v2.js',
            'assets/nextcloud-native.js',
        ]
        native_dialog_sources = []
        for source in sources:
            text = self.read(source)
            if '.showModal()' in text or "createElement('dialog')" in text:
                native_dialog_sources.append(source)
        self.assertGreaterEqual(len(native_dialog_sources), 6)
        self.assertIn('assets/operating-task-detail.js', native_dialog_sources)
        self.assertIn('assets/mindmap-editor-v2.js', native_dialog_sources)
        self.assertIn('assets/nextcloud-native.js', native_dialog_sources)

    def test_project_cockpit_open_is_intercepted_before_rerender(self):
        fix = self.read('assets/note-ux-fixes.js')
        research = self.read('assets/research-v5.js')
        platform = self.read('assets/platform-v2.js')
        self.assertIn('[data-open-resource]', fix)
        self.assertIn('event.stopImmediatePropagation()', fix)
        self.assertIn('openResourceOverlay', fix)
        self.assertIn('data-open-resource', research)
        self.assertIn('if(t.dataset.openResource)return openResource', platform)
