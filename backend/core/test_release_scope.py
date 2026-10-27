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
                     'backend/core/canonical_middleware.py', 'ops/canonical_checkpoint.py',
                     'backend/core/new_api.py', 'unknown']:
            with self.subTest(path=path):
                self.assertEqual(release.classify(['backend/core/task_board_api.py', path]), 'stateful')
