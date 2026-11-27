"""The contract between versioned presentation fields and source markup."""
from pathlib import Path
import re

from django.conf import settings
from lxml import etree, html


PAGES = {
    'home': ('Homepage', 'index.html'),
    'topics': ('Topics', 'topics.html'),
    'lab': ('Lab', 'lab.html'),
    'education': ('Education', 'education.html'),
    'about': ('About', 'about.html'),
}
FIELDS = {
    'title': ('Page title', 'text', 160),
    'description': ('Search description', 'text', 300),
    'heading': ('Main heading', 'text', 220),
    'summary': ('Hero description', 'text', 400),
    'cta_label': ('Topics button label', 'text', 72),
    'cta_link': ('Topics button destination', 'link', 100),
    'hero_spacing': ('Hero spacing', 'spacing', 16),
}
HOME_FIELDS = ('summary', 'cta_label', 'cta_link', 'hero_spacing')
LINKS = ('/topics', '/lab', '/learn', '/education', '/community', '/about',
         '/topic-answer-that-looked-right')


def fields_for(page):
    return ('title', 'description', 'heading', *HOME_FIELDS) if page == 'home' else ('title', 'description', 'heading')


def source(page):
    if page not in PAGES:
        raise ValueError('unknown_page')
    return Path(settings.BASE_DIR).parent / PAGES[page][1]


def document(page):
    return html.document_fromstring(source(page).read_text(encoding='utf-8'))


def element(root, field):
    matches = root.xpath('//*[@data-visual-field=$field]', field=field)
    if len(matches) != 1:
        raise ValueError('invalid_source_registry')
    return matches[0]


def values_for(page):
    root = document(page)
    result = {}
    for field in fields_for(page):
        node = element(root, field)
        if field == 'description':
            value = node.get('content')
        elif field == 'cta_link':
            value = node.get('href')
        elif field == 'hero_spacing':
            value = node.get('data-visual-spacing', 'standard')
        else:
            value = ' '.join(node.text_content().split())
        result[field] = value
    return result


def validate_edits(page, edits):
    if not isinstance(edits, dict) or not edits or set(edits) - set(fields_for(page)):
        raise ValueError('unsupported_visual_fields')
    clean = {}
    for field, value in edits.items():
        _, kind, limit = FIELDS[field]
        if not isinstance(value, str) or not value.strip() or len(value) > limit or re.search(r'[<>\x00-\x1f\x7f]', value):
            raise ValueError('invalid_visual_value')
        value = value.strip()
        if ((kind == 'link' and value not in LINKS)
                or (kind == 'spacing' and value not in ('standard', 'compact', 'roomy'))):
            raise ValueError('unsupported_visual_value')
        clean[field] = value
    return clean


def preview(page, overrides):
    root = document(page)
    if overrides:
        for field, value in validate_edits(page, overrides).items():
            node = element(root, field)
            if field == 'description':
                node.set('content', value)
            elif field == 'cta_link':
                node.set('href', value)
            elif field == 'hero_spacing':
                node.set('data-visual-spacing', value)
            else:
                for child in list(node):
                    node.remove(child)
                node.text = value
    # Scripts in the published website are permitted only outside this editor.
    for node in root.xpath('//script|//iframe|//object|//embed|//base|//meta[@http-equiv]'):
        node.drop_tree()
    for node in root.xpath('//*[@src or @href or @srcset or @poster]'):
        for name in ('src', 'href', 'srcset', 'poster'):
            value = node.get(name)
            if value:
                node.set(name, re.sub(r'(^|[ ,])(?:\./)?(assets/)', r'\1/\2', value))
    stylesheet = etree.SubElement(root.find('head'), 'link', rel='stylesheet')
    stylesheet.set('href', '/assets/ws/ws-release-center.css')
    return html.tostring(root, encoding='unicode', doctype='<!doctype html>')
