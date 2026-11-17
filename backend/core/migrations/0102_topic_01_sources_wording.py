"""Say what Topic 01's sources are, not how many there are.

The home page's Sources panel read "Nine sources, every DOI checked". A count
told the visitor nothing they could use, and it would go stale the first time
a source was added. On 2026-11-17 the owner asked for the panel to say the
thing that matters instead: everything in a Topic rests on scientific sources,
and those sources are sorted into levels a reader can climb.

`topic_seed/topic-01.json` carries the new text, but the seed only fills an
empty database, so the live row is updated here. Same rule as 0094 and 0099:
a line is swapped only while it still holds the exact earlier text, so an
editor's own rewrite in the CMS is kept.
"""
from django.db import migrations


SLUG = 'answer-that-looked-right'

# (key inside topic_data['landing'], old text, new text)
LINES = [
    ('sources_title',
     'Three levels, every link checked',
     'Every claim has a source'),
    ('sources_say',
     'Start wherever feels comfortable, and climb when you’re ready. Nine sources, every DOI checked.',
     'Everything in this Topic rests on scientific sources, sorted into three levels so you can climb from a gentle start to primary papers.'),
]


def _swap(apps, reverse):
    ContentItem = apps.get_model('core', 'ContentItem')
    item = ContentItem.objects.filter(slug=SLUG).first()
    if item is None or not isinstance(item.topic_data, dict):
        return
    landing = item.topic_data.get('landing')
    if not isinstance(landing, dict):
        return
    changed = False
    for key, old, new in LINES:
        if reverse:
            old, new = new, old
        if landing.get(key) == old:
            landing[key] = new
            changed = True
    if changed:
        item.save(update_fields=['topic_data', 'updated_at'])


def forwards(apps, schema_editor):
    _swap(apps, reverse=False)


def backwards(apps, schema_editor):
    _swap(apps, reverse=True)


class Migration(migrations.Migration):
    dependencies = [('core', '0101_course_interest')]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
