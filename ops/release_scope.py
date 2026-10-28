"""Fail-closed release classification for the small HTTP-only hot-reload surface.

Model/schema/settings/dependency/native-storage changes always require the full
matched checkpoint path. An API-only release can roll code back while retaining
all current database writes; restoring an older data snapshot would be wrong.
"""
from pathlib import PurePosixPath
import argparse
import ast
import subprocess
import sys

HOT_RELOAD_API = {'backend/core/task_board_api.py', 'backend/core/research_task_api.py',
                  'backend/core/project_cockpit.py', 'backend/core/platform_access.py',
                  'backend/core/canonical_middleware.py',
                  'backend/core/canonical_task_outbox.py',
                  'backend/gravitas_backend/wsgi.py',
                  'scripts/reliability/deploy-api-release.sh'}


def canonical_read_guard_only(before, after):
    """Only refresh_file and its queue import may change without a native checkpoint.

    In particular, SPECS, encode/decode, export, adoption and restore behavior
    must remain identical. Unknown changes fail closed to the matched backup.
    """
    class StripReadGuard(ast.NodeTransformer):
        def visit_FunctionDef(self, node):
            if node.name == 'refresh_file':
                node.body = [ast.Pass()]
            return node
        def visit_ImportFrom(self, node):
            if node.module == 'canonical_models':
                node.names = [item for item in node.names if item.name != 'CanonicalTaskSyncOutbox']
            return node
    try:
        def stable(source):
            return ast.dump(StripReadGuard().visit(ast.parse(source)), include_attributes=False)
        return stable(before) == stable(after)
    except (SyntaxError, ValueError):
        return False


def classify(paths, base=None, head=None):
    scope = 'static'
    for name in paths:
        path = PurePosixPath(name)
        if name == 'backend/core/canonical_projects.py':
            if not base or not head:
                return 'stateful'
            try:
                before = subprocess.check_output(['git', 'show', f'{base}:{name}'], text=True)
                after = subprocess.check_output(['git', 'show', f'{head}:{name}'], text=True)
            except (OSError, subprocess.CalledProcessError):
                return 'stateful'
            if not canonical_read_guard_only(before, after):
                return 'stateful'
            scope = 'code'
        elif name in HOT_RELOAD_API:
            scope = 'code' if scope == 'static' else scope
        elif (name.startswith(('assets/', '.github/workflows/', 'scripts/', 'docs/'))
              or (name.startswith('backend/core/test_') and name.endswith('.py'))
              or name in {'ops/release_scope.py', 'ops/readonly_runtime_diagnostics.py', 'ops/e2e-identity.sh',
                          'backend/gravitas_backend/postgres_test_settings.py'}
              or (len(path.parts) == 1 and path.suffix in {'.html', '.htm', '.webmanifest'})
              or name in {'favicon.ico', 'robots.txt', 'sitemap.xml', 'workspace-sw.js'}):
            continue
        else:
            return 'stateful'
    return scope


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base')
    parser.add_argument('--head')
    args = parser.parse_args()
    print(classify(sys.stdin.read().split('\0')[:-1], args.base, args.head))
