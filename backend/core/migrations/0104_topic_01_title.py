"""Topic 01's title is "Is AI reliable in research and learning?".

On 2026-11-19 the owner set Topic 01's title, to be used everywhere on the
site. It had been "Can you trust an answer that looks right?". The Topic page,
the home page and the Topics page read the title from this row (the Topic
editor under Platform Admin saves it), so the static pages, the seed and the
Forum's discussion thread (backend/core/forum_rooms.json, kept in step on
Discourse by ops/discourse/rooms.rb) change with it in the same commit.

`topic_seed/topic-01.json` carries the new title, but the seed only fills an
empty database, so the live row is updated here. Same rule as 0094, 0099 and
0102: the title is swapped only while it still holds the exact earlier text,
so an editor's own title in the CMS is kept.
"""
from django.db import migrations


SLUG = 'answer-that-looked-right'
OLD = 'Can you trust an answer that looks right?'
NEW = 'Is AI reliable in research and learning?'


def _swap(apps, old, new):
    ContentItem = apps.get_model('core', 'ContentItem')
    item = ContentItem.objects.filter(slug=SLUG).first()
    if item is not None and item.title == old:
        item.title = new
        item.save(update_fields=['title', 'updated_at'])


def forwards(apps, schema_editor):
    _swap(apps, OLD, NEW)


def backwards(apps, schema_editor):
    _swap(apps, NEW, OLD)


class Migration(migrations.Migration):
    dependencies = [('core', '0103_course_interest_skeptical')]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
