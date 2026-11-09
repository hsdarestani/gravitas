"""Use the published CMS and explicitly linked legacy Topic, never preview data."""
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote

from django.conf import settings
from core.models import ContentItem

STATIC_TOPICS = {'answer-that-looked-right': 'topic-answer-that-looked-right.html'}


class _Heading(HTMLParser):
    def __init__(self):
        super().__init__(); self.inside = False; self.finished = False; self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == 'h1' and not self.finished:
            self.inside = True

    def handle_endtag(self, tag):
        if tag == 'h1' and self.inside:
            self.inside = False; self.finished = True

    def handle_data(self, data):
        if self.inside:
            self.parts.append(data)


def published_manifest(site_root=None):
    root = Path(site_root or '/var/www/gravitas')
    base = settings.PUBLIC_BASE_URL.rstrip('/')
    items = []
    for item in ContentItem.objects.filter(status='published', kind__in=['topic', 'dossier']):
        canonical = json.dumps({'body':item.body, 'data':item.topic_data}, sort_keys=True)
        items.append({'id':item.pk, 'key':item.slug, 'title':item.title, 'source':'cms',
                      'url':base + '/' + STATIC_TOPICS.get(item.slug, 'topic.html?slug=' + quote(item.slug)),
                      'version':'sha256:' + hashlib.sha256(canonical.encode()).hexdigest()})
    keys = {item['key'] for item in items}
    home = (root/'index.html').read_text() if (root/'index.html').exists() else ''
    for key, filename in STATIC_TOPICS.items():
        # Topic 01 is an existing published static page, not necessarily a CMS
        # row. Require its link in the actual deployed landing before seeding.
        path = root/filename
        if key in keys or filename not in home or not path.is_file():
            continue
        source = path.read_text(); main = source.partition('<main')[2].partition('</main>')[0]
        heading = _Heading(); heading.feed(main)
        title = ' '.join(''.join(heading.parts).split())
        if not title:
            continue
        items.append({'id':None,'key':key,'title':title,'source':'static',
                      'url':base + '/' + filename,
                      'version':'sha256:' + hashlib.sha256(main.encode()).hexdigest()})
    return {'published_content':items}
