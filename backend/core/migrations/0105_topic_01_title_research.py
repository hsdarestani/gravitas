"""Topic 01's title is "Is AI reliable in research?".

On 2026-11-19, the same day 0104 set it to "Is AI reliable in research and
learning?", the owner shortened Topic 01's title to "Is AI reliable in
research?". The static pages, the seed and the Forum's discussion thread
(backend/core/forum_rooms.json, kept in step on Discourse by
ops/discourse/rooms.rb) change with it in the same commit.

Same rule as 0094, 0099, 0102 and 0104: the live row is swapped only while it
still holds the exact earlier text, so an editor's own title in the CMS is
kept.
"""
from django.db import migrations


SLUG = 'answer-that-looked-right'
OLD = 'Is AI reliable in research and learning?'
NEW = 'Is AI reliable in research?'


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
    dependencies = [('core', '0104_topic_01_title')]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
