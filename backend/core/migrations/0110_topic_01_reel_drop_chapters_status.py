"""Topic 01's home-page reel loses its chapter list and its "Soon on YouTube" tag.

On 2026-11-21 the owner asked for two things to go from the Videos panel of
the home-page reel: the numbered chapter list beside the video ("Thirty
years of proteins", "Meet Pulsar", "The 9.8", "The work that eats a day"),
and the "Soon on YouTube" status on the poster, which stopped being true
once both videos went up on YouTube. The runtime stays.

The frontend no longer reads either field, but the CMS row still carried
them and the seed (topic_seed/topic-01.json) is what a fresh database is
built from, so both lose `landing.chapters` and `landing.video_status`
together and an editor does not find stale copy in Platform Admin.

Only values that still match what was seeded are removed, so wording an
editor has changed since is kept. Backwards puts the seeded values back
when the keys are missing.
"""
from django.db import migrations


SLUG = 'answer-that-looked-right'
SEEDED = {
    'chapters': ['Thirty years of proteins', 'Meet Pulsar', 'The 9.8', 'The work that eats a day'],
    'video_status': 'Soon on YouTube',
}


def _apply(apps, forwards):
    ContentItem = apps.get_model('core', 'ContentItem')
    item = ContentItem.objects.filter(slug=SLUG).first()
    if item is None or not isinstance(item.topic_data, dict):
        return
    landing = item.topic_data.get('landing')
    if not isinstance(landing, dict):
        return
    landing = dict(landing)
    changed = False
    for key, value in SEEDED.items():
        if forwards and key in landing and landing[key] in (value, '', []):
            del landing[key]
            changed = True
        elif not forwards and key not in landing:
            landing[key] = value
            changed = True
    if changed:
        item.topic_data = dict(item.topic_data, landing=landing)
        item.save(update_fields=['topic_data', 'updated_at'])


def forwards(apps, schema_editor):
    _apply(apps, True)


def backwards(apps, schema_editor):
    _apply(apps, False)


class Migration(migrations.Migration):
    dependencies = [('core', '0109_topic_01_opener_poster')]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
