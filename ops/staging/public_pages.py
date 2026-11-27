"""Prepare the public staging surface without publishing the repository tree."""
from pathlib import Path
import re
import sys

PAGES = (
    'index', 'about', 'account', 'brand', 'community', 'dossiers', 'education',
    'education-de', 'forum', 'impressum', 'lab', 'learn', 'newsletter', 'privacy',
    'terms', 'topic-answer-that-looked-right', 'topics', 'workspace',
)
BANNER = (
    '<aside aria-label="Environment" style="position:relative;z-index:1;padding:.35rem 1rem;'
    'text-align:center;background:var(--g-bg,#003049);color:var(--g-text,#f1efec);'
    'border-bottom:1px solid currentColor;font:inherit">Staging</aside>'
)


def prepare(source):
    public = source / '.staging-public'
    if public.is_symlink():
        raise ValueError('invalid public directory')
    public.mkdir(exist_ok=True)
    for name in PAGES:
        path = source / (name + '.html')
        if not path.is_file() or path.is_symlink():
            continue
        content = re.sub(r'(<body\b[^>]*>)', r'\1' + BANNER, path.read_text(), count=1, flags=re.I)
        destination = public / path.name
        if destination.is_symlink():
            raise ValueError('invalid public file')
        destination.write_text(content)
    robots = public / 'robots.txt'
    if robots.is_symlink():
        raise ValueError('invalid robots file')
    robots.write_text('User-agent: *\nDisallow: /\n')


if __name__ == '__main__':
    prepare(Path(sys.argv[1]))
