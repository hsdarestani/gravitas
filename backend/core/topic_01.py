"""Topic 01 as text, for the readers that cannot run the page's JavaScript.

The Topic page is drawn in the browser from its ContentItem, so its static HTML
holds headings and empty containers. Pulsar and the deploy-time page snapshot
read documents rather than browsers, so they get the same record here, in the
shape `sync_public_pages` produces for a static page. An admin's save therefore
reaches Pulsar on its next answer, without waiting for a deploy.
"""
import re

from .models import ContentItem

SLUG = 'answer-that-looked-right'
PAGE = 'topic-answer-that-looked-right'


def _join(rows, *keys):
    return ' '.join(
        ' '.join(str(row.get(key) or '') for key in keys)
        for row in rows if isinstance(row, dict)
    )


def _plain(value):
    """Timeline text may carry [label](url); a reader of plain text wants the label."""
    return re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', value)


def _rows(data, key):
    value = data.get(key)
    return value if isinstance(value, list) else []


def snapshot():
    """Return the page-snapshot fields for the published record, or None."""
    item = ContentItem.objects.filter(slug=SLUG, kind='topic', status='published').first()
    if item is None or not isinstance(item.topic_data, dict):
        return None
    data = item.topic_data
    views = data.get('viewpoints') if isinstance(data.get('viewpoints'), dict) else {}
    polls = _rows(views, 'polls')
    discussion = data.get('discussion') if isinstance(data.get('discussion'), dict) else {}
    sections = [
        ('', item.title, f'{item.title} {data.get("hero_lead") or item.summary}'),
        ('video', 'The Video', ' '.join([
            _join(_rows(data, 'videos'), 'title', 'description', 'duration', 'info'),
            _join(_rows(data, 'cast'), 'name', 'role', 'bio'),
            _join(_rows(data, 'stills'), 'caption'),
            _join(_rows(data, 'transcript'), 'speaker', 'text'),
        ])),
        # The essays' own text comes from their published revisions.
        ('essay', 'The Essays', 'The essays of this Topic.'),
        # The order is the page's. The exercise left the page on 2026-11-12;
        # its record stays, but Pulsar should not send a reader to it.
        ('timeline', 'How the Question Gathered Weight', _plain(_join(_rows(data, 'timeline'), 'date', 'title', 'description', 'why'))),
        ('views', 'Viewpoints', ' '.join([
            str(data.get('viewpoints_intro') or ''), _join(_rows(views, 'items'), 'label', 'text', 'cite'),
            _join(polls, 'question'),
            ' '.join(_join(_rows(poll, 'options'), 'label') for poll in polls if isinstance(poll, dict)),
        ])),
        ('talk', 'Discussion', ' '.join([
            str(discussion.get('question') or ''), str(discussion.get('corrections') or ''),
            _join(_rows(discussion, 'rooms'), 'label', 'question'),
        ])),
        ('sources', 'Sources and Bibliography', ' '.join([
            str(data.get('sources_intro') or ''), _join(_rows(data, 'sources'), 'level_label', 'label'),
        ])),
        ('related', 'Where This Goes Next', _join(_rows(data, 'next'), 'kicker', 'title', 'text')),
    ]
    return {
        'title': item.title,
        'sections': [
            {'id': key, 'title': title, 'text': re.sub(r'\s+', ' ', text).strip()[:60000]}
            for key, title, text in sections if text.strip()
        ],
    }
