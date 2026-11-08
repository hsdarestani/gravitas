"""Synchronize deployed static public copy to Pulsar's database context."""
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from lxml import html

from core.models import PublicPageSnapshot
from core.pulsar_public_context import clean_text, public_topic_catalog, page_observation, public_href

# The workspace, account, preview templates and private research pack are
# deliberately outside the public editorial inventory.
PAGES = (
    'index', 'about', 'brand', 'community', 'education', 'education-de', 'forum', 'forum-thread',
    'game-hypothesis-machine', 'impressum', 'lab', 'lab-prompt-bias', 'lab-protein-stability',
    'lab-scientific-visualization', 'learn', 'newsletter', 'path-ai-in-research', 'privacy',
    'topics', 'topic-answer-that-looked-right',
    'topic-computable-universe', 'topic-machine-hypothesis',
)


def _text(node, limit=30000):
    return clean_text(' '.join(node.itertext()), limit)


def _class(node, name):
    return name in (node.get('class') or '').split()


def _page_content(document, name):
    areas = document.xpath('//main')
    if not areas:
        raise CommandError(f'{name}.html has no public main content')
    main = areas[0]
    for node in main.xpath('.//script|.//style|.//svg|.//template|.//noscript|.//*[@data-public-context-skip]'):
        node.drop_tree()
    heading = main.xpath('.//h1') or document.xpath('//title')
    featured = {}
    if name == 'index':
        href = next(iter(main.xpath('.//*[@data-public-featured-topic]/@data-public-featured-topic')), '')
        if public_href(href):
            featured = {'featured_href': href, 'featured_topic_key': href.lstrip('/').removesuffix('.html')}

    legacy_essays = {}
    for node in main.xpath('.//*[@data-public-context-essay]'):
        depth = node.get('data-public-context-essay')
        if depth in {'overview', 'deep'}:
            legacy_essays.setdefault(depth, []).append(_text(node))
        node.drop_tree()

    actions = [
        {'label': _text(node, 100), 'href': node.get('href')}
        for node in main.xpath('.//a[@href]|.//button')
        if _class(node, 'g-btn') or node.get('href', '').startswith('#')
    ]
    sections = []
    # Walk all text once and group it by the nearest named section. Inline
    # spans, source lists, tables and transcript lines remain in reading order.
    section = {'id': '', 'title': '', 'text': ''}
    parts = []

    def finish_section():
        if parts:
            section['text'] = clean_text(' '.join(parts), 60000)
            if section['text']:
                sections.append(section.copy())
            parts.clear()

    def walk(node):
        previous = None
        if node.tag == 'section':
            finish_section()
            previous = section.copy()
            titles = node.xpath('./h2|./*/h2|./*/h1')
            section.update(id=node.get('id', ''), title=_text(titles[0], 200) if titles else '', text='')
        if node.text:
            parts.append(node.text)
        for child in node:
            walk(child)
            if child.tail:
                parts.append(child.tail)
        if previous is not None:
            finish_section()
            section.update(previous)

    walk(main)
    finish_section()
    catalog = []
    if name == 'topics':
        for node in main.xpath('.//a[.//h3]'):
            if not _class(node, 'entry'):
                continue
            catalog.append({
                'title': _text(node.xpath('.//h3')[0], 220),
                'status': 'planned' if _class(node, 'is-soon') else 'open',
                'href': node.get('href', ''),
            })
    return {
        'observation': page_observation({'heading': _text(heading[0], 180) if heading else '', 'actions': actions}),
        'sections': sections, 'legacy_essays': legacy_essays,
        'topic_catalog': public_topic_catalog(catalog), **featured,
    }


class Command(BaseCommand):
    help = 'Synchronize the deployed public HTML content and Topics catalog to the database.'

    def add_arguments(self, parser):
        parser.add_argument('--source', type=Path, required=True)

    def handle(self, *args, **options):
        source = options['source']
        pages = {}
        for name in PAGES:
            try:
                document = html.document_fromstring(
                    (source / f'{name}.html').read_text(encoding='utf-8'),
                    parser=html.HTMLParser(remove_comments=True),
                )
            except (OSError, ValueError) as exc:
                raise CommandError(f'Could not read public page {name}.html') from exc
            pages[name] = _page_content(document, name)

        home = pages['index']
        featured = pages.get(home.pop('featured_topic_key', ''))
        featured_href = home.pop('featured_href', '')
        if featured and featured_href:
            home['observation'].update(featured_topic=featured['observation']['heading'], featured_href=public_href(featured_href))

        rows = {('/' if name == 'index' else f'/{name}.html'): content for name, content in pages.items()}
        with transaction.atomic():
            existing = PublicPageSnapshot.objects.in_bulk()
            for path, content in rows.items():
                if path not in existing or existing[path].content != content:
                    PublicPageSnapshot.objects.update_or_create(path=path, defaults={'content': content})
            PublicPageSnapshot.objects.exclude(path__in=rows).delete()
        self.stdout.write(self.style.SUCCESS(f'Synchronized {len(rows)} public pages.'))
