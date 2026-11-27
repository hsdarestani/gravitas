"""Patch only the staging vhost's managed root and explicit public routes."""
from pathlib import Path
import sys

from public_pages import PAGES

START = '    # START MANAGED GRAVIQUEST STAGING PUBLIC'
END = '    # END MANAGED GRAVIQUEST STAGING PUBLIC'
FALLBACK = '    location / { return 404; }'


def render(current, previous, release, *, keep_workspace_routes=False):
    line = f'    root {previous};'
    if current.count(line) != 1 or 'server_name staging.graviquest.com;' not in current:
        raise ValueError('unexpected staging vhost')
    updated = current.replace(line, f'    root {release};', 1)
    if START in updated:
        head, tail = updated.split(START, 1)
        _, footer = tail.split(END, 1)
        updated = head + footer.lstrip('\n')
    if updated.count(FALLBACK) != 1:
        raise ValueError('unexpected staging routing fallback')
    routes = [
        START,
        '    location = /site { try_files /.staging-public/index.html =404; }',
        '    location ~ ^/api/lms/courses/[0-9]+/(checkout|payment-webhook)/?$ { return 503; }',
        '    location ^~ /lab-run/ { proxy_pass http://127.0.0.1:18000; proxy_read_timeout 30s; }',
        '    location ^~ /content/ { proxy_pass http://127.0.0.1:18000; }',
        '    location ^~ /admin/ { proxy_pass http://127.0.0.1:18000; }',
        '    location ^~ /assets/fonts/ {',
        '        add_header Access-Control-Allow-Origin "*" always;',
        '        add_header X-Content-Type-Options nosniff always;',
        '        add_header X-Robots-Tag "noindex, nofollow" always;',
        '        try_files $uri =404;',
        '    }',
        '    location = /robots.txt { try_files /.staging-public/robots.txt =404; }',
    ]
    if not keep_workspace_routes:
        routes.append('    location = /workspace.html { return 302 /workspace; }')
    for name in PAGES:
        if name in ('account', 'workspace'):
            continue
        routes.extend(f'    location = /{route} {{ try_files /.staging-public/{name}.html =404; }}'
                      for route in (name, name + '.html'))
    routes.append(END)
    updated = updated.replace(FALLBACK, '\n'.join(routes) + '\n' + FALLBACK, 1)
    if keep_workspace_routes:
        return updated
    return (updated
            .replace('location = / { return 302 /workspace-v2; }',
                     'location = / { try_files /.staging-public/index.html =404; }')
            .replace('location = /account.html { try_files $uri =404; }',
                     'location = /account.html { return 302 /login; }')
            .replace('try_files /workspace.html =404;', 'try_files /.staging-public/workspace.html =404;')
            .replace('try_files /account.html =404;', 'try_files /.staging-public/account.html =404;'))


if __name__ == '__main__':
    source, destination, previous_root, release_root, *options = sys.argv[1:]
    if options not in ([], ['--keep-workspace-routes']):
        raise SystemExit('invalid route generation options')
    Path(destination).write_text(render(
        Path(source).read_text(), previous_root, release_root, keep_workspace_routes=bool(options),
    ))
