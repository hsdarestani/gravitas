"""Release classification must never skip data backups for stateful changes."""
import importlib.util
from pathlib import Path
from django.test import SimpleTestCase

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('release_scope', ROOT / 'ops/release_scope.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseScopeTests(SimpleTestCase):
    def test_only_reviewed_api_modules_can_hot_reload(self):
        self.assertEqual(release.classify(['assets/ws/ws-views.js', 'backend/core/task_board_api.py']), 'code')
        self.assertEqual(release.classify(['assets/ws/ws-app.js', 'scripts/reliability/workspace-browser.mjs']), 'static')

    def test_stateful_or_unknown_paths_always_require_matched_checkpoint(self):
        for path in ['backend/core/models.py', 'backend/core/migrations/0081_new.py',
                     'backend/requirements.txt', 'backend/gravitas_backend/settings.py',
                     'backend/core/canonical_models.py', 'ops/canonical_checkpoint.py',
                     'backend/core/new_api.py', 'unknown']:
            with self.subTest(path=path):
                self.assertEqual(release.classify(['backend/core/task_board_api.py', path]), 'stateful')

    def test_native_format_and_export_changes_never_take_the_read_guard_shortcut(self):
        source = "SPECS = {'OperatingTask': ('title',)}\ndef refresh_file(file):\n    return 'old'\ndef encode(obj):\n    return 'format-v1'\n"
        guard = source.replace("return 'old'", "return 'guarded'")
        self.assertTrue(release.canonical_read_guard_only(source, guard))
        for changed in (guard.replace("('title',)", "('title', 'owner')"),
                        guard.replace("format-v1", "format-v2")):
            self.assertFalse(release.canonical_read_guard_only(source, changed))
        self.assertEqual(release.classify(['backend/core/canonical_projects.py']), 'stateful')
