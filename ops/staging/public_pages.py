"""Prepare the public staging surface without publishing the repository tree."""
from pathlib import Path
import re
import sys
from tempfile import NamedTemporaryFile

PAGES = (
    'index', 'about', 'account', 'brand', 'community', 'dossiers', 'education',
    'education-de', 'forum', 'forum-thread', 'impressum', 'lab', 'lab-prompt-bias',
    'lab-protein-stability', 'lab-scientific-visualization', 'learn', 'newsletter',
    'prelaunch-feedback', 'privacy', 'science-evidence', 'terms', 'topic',
    'topic-answer-that-looked-right', 'topics', 'workspace',
)
BANNER = (
    '<aside aria-label="Environment" style="position:relative;z-index:1;padding:.35rem 1rem;'
    'text-align:center;background:var(--g-bg,#003049);color:var(--g-text,#f1efec);'
    'border-bottom:1px solid currentColor;font:inherit">Staging</aside>'
)


POLICY = """<meta http-equiv="Content-Security-Policy" content="connect-src 'self'; form-action 'self'">"""
FORUM_NOTICE = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
    '<title>Staging forum</title></head><body><main><h1>Forum</h1>'
    '<p>An isolated Discourse instance is required to test forum accounts, posts and moderation.</p>'
    '<p><a href="/site">Return to staging</a></p></main></body></html>'
)
FORUM_ORIGIN = re.compile(r"""https?://forum[.]graviquest[.]com(?:/[^"'\s<>]*)?""", re.I)


def staging_html(content):
    content = re.sub(
        r"""(?i)(\bhref=["'])(?:https?://(?:www[.])?graviquest[.]com)?/(?:index[.]html)?(?=["'])""",
        lambda match: match[1] + '/site', content,
    )
    content = FORUM_ORIGIN.sub('/forum.html', content)
    content = re.sub(r'(<head\b[^>]*>)', lambda match: match[0] + POLICY, content, count=1, flags=re.I)
    return re.sub(r'(<body\b[^>]*>)', lambda match: match[0] + BANNER, content, count=1, flags=re.I)


def write_page(path, content):
    with NamedTemporaryFile(mode='w', dir=path.parent, encoding='utf-8', delete=False) as temporary:
        staged = Path(temporary.name)
        temporary.write(content)
    try:
        staged.chmod(0o644)
        staged.replace(path)
    finally:
        staged.unlink(missing_ok=True)


def prepare(source):
    public = source / '.staging-public'
    if public.is_symlink():
        raise ValueError('invalid public directory')
    public.mkdir(exist_ok=True)
    for name in PAGES:
        path = source / (name + '.html')
        if not path.is_file() or path.is_symlink():
            continue
        content = FORUM_NOTICE if name in ('forum', 'forum-thread') else path.read_text()
        destination = public / path.name
        if destination.is_symlink():
            raise ValueError('invalid public file')
        write_page(destination, staging_html(content))
    robots = public / 'robots.txt'
    if robots.is_symlink():
        raise ValueError('invalid robots file')
    write_page(robots, 'User-agent: *\nDisallow: /\n')


if __name__ == '__main__':
    prepare(Path(sys.argv[1]))
