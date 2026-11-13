"""Bring Topic 01's stored wording in line with the warmer site copy.

On 2026-11-14 the site's copy was reworked toward the community voice and the
gravity vocabulary (weighty, pull, land, carry weight). Six lines of Topic 01
live in the database rather than the HTML: the sources intro, three rail
captions, the poll note and the empty corrections line. `topic_seed/topic-01.json`
now carries the new text, but migration 0095 only seeds a database that has no
Topic 01 row, so a live row would keep the old wording forever and the page
would disagree with the rest of the site.

Same rule as 0094: each line is swapped only while it still holds the exact
seeded text. An editor who has since rewritten a line in the CMS keeps it.
"""
from django.db import migrations


SLUG = 'answer-that-looked-right'

# (path inside topic_data, old seeded text, new text)
LINES = [
    (('sources_intro',),
     'Pick the level you want to enter at, and move up when you feel like it. Every link resolves.',
     'Start wherever feels comfortable, and climb when you’re ready. Every link holds.'),
    (('landing', 'sources_say'),
     'Enter at the level you want, and move up when you feel like it. Nine sources, every DOI resolved.',
     'Start wherever feels comfortable, and climb when you’re ready. Nine sources, every DOI checked.'),
    (('landing', 'discussion_say'),
     'Replies are read by a moderator before they appear. Reading needs no account.',
     'Read along without an account. A moderator reads each reply before it appears.'),
    (('viewpoints', 'poll_note'),
     'Make your case in the discussion below.',
     'Tell us why in the discussion below.'),
    (('viewpoints', 'polls', 0, 'note'),
     'Make your case in the discussion below.',
     'Tell us why in the discussion below.'),
    (('discussion', 'corrections'),
     'None yet. Anything we get wrong is logged here, with what changed and when.',
     'Nothing yet. If you catch something we got wrong, it’s logged here with what changed and when, and our thanks.'),
]


def _parent(data, path):
    node = data
    for key in path[:-1]:
        if isinstance(key, int):
            if not isinstance(node, list) or len(node) <= key:
                return None
        elif not isinstance(node, dict):
            return None
        node = node[key] if isinstance(key, int) else node.get(key)
    return node if isinstance(node, (dict, list)) else None


def _swap(apps, reverse):
    ContentItem = apps.get_model('core', 'ContentItem')
    item = ContentItem.objects.filter(slug=SLUG).first()
    if item is None or not isinstance(item.topic_data, dict):
        return
    changed = False
    for path, old, new in LINES:
        if reverse:
            old, new = new, old
        parent = _parent(item.topic_data, path)
        key = path[-1]
        if isinstance(parent, dict) and parent.get(key) == old:
            parent[key] = new
            changed = True
        elif isinstance(parent, list) and isinstance(key, int) and len(parent) > key and parent[key] == old:
            parent[key] = new
            changed = True
    if changed:
        item.save(update_fields=['topic_data', 'updated_at'])


def forwards(apps, schema_editor):
    _swap(apps, reverse=False)


def backwards(apps, schema_editor):
    _swap(apps, reverse=True)


class Migration(migrations.Migration):
    dependencies = [('core', '0098_topic_essay_levels_and_reactions')]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
