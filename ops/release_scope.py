"""Fail-closed release classification for the small HTTP-only hot-reload surface.

Model/schema/settings/dependency/native-storage changes always require the full
matched checkpoint path. An API-only release can roll code back while retaining
all current database writes; restoring an older data snapshot would be wrong.
"""
from pathlib import PurePosixPath
import sys

HOT_RELOAD_API = {'backend/core/task_board_api.py', 'backend/core/research_task_api.py',
                  'backend/core/project_cockpit.py', 'backend/core/platform_access.py',
                  'backend/gravitas_backend/wsgi.py'}


def classify(paths):
    scope = 'static'
    for name in paths:
        path = PurePosixPath(name)
        if name in HOT_RELOAD_API:
            scope = 'code' if scope == 'static' else scope
        elif (name.startswith(('assets/', '.github/workflows/', 'scripts/', 'docs/'))
              or (name.startswith('backend/core/test_') and name.endswith('.py'))
              or name in {'ops/release_scope.py', 'ops/readonly_runtime_diagnostics.py',
                          'backend/gravitas_backend/postgres_test_settings.py'}
              or (len(path.parts) == 1 and path.suffix in {'.html', '.htm', '.webmanifest'})
              or name in {'favicon.ico', 'robots.txt', 'sitemap.xml', 'workspace-sw.js'}):
            continue
        else:
            return 'stateful'
    return scope


if __name__ == '__main__':
    print(classify(sys.stdin.read().split('\0')[:-1]))
