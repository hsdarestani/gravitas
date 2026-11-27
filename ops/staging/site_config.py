"""Patch only the staging vhost's managed root and explicit public routes."""
from pathlib import Path
import sys

from public_pages import PAGES

START = '    # START MANAGED GRAVIQUEST STAGING PUBLIC'
END = '    # END MANAGED GRAVIQUEST STAGING PUBLIC'
FALLBACK = '    location / { return 404; }'


def render(current, previous, release):
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
        '    location = /robots.txt { try_files /.staging-public/robots.txt =404; }',
    ]
    for name in PAGES:
        if name in ('account', 'workspace'):
            continue
        routes.extend(f'    location = /{route} {{ try_files /.staging-public/{name}.html =404; }}'
                      for route in (name, name + '.html'))
    routes.append(END)
    updated = updated.replace(FALLBACK, '\n'.join(routes) + '\n' + FALLBACK, 1)
    return updated.replace('try_files /workspace.html =404;', 'try_files /.staging-public/workspace.html =404;').replace(
        'try_files /account.html =404;', 'try_files /.staging-public/account.html =404;',
    )


if __name__ == '__main__':
    source, destination, previous_root, release_root = sys.argv[1:]
    Path(destination).write_text(render(Path(source).read_text(), previous_root, release_root))
