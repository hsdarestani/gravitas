"""Each of Topic 01's two videos gets its own poster.

Since an editor added the 41-second series opener ("Topic 1 videos - Is AI
reliable in research?", youtu.be/3-8GV5mvTnI) under Platform Admin, both of
Topic 01's videos have shown the same still: the "It looked right. Has anyone
checked?" poster drawn on 2026-11-06 for the 5 min 34 s episode
(youtu.be/6-wKSrn51Ro).

On 2026-11-21 the owner asked for a poster per video, and for two that do
not look alike through layout alone: the same Cosmos plate, paper cast and
Pulsar card, no added props.

- the opener: Hulse and Taylor full length on the left, looking up at
  Pulsar's card, the same card as the episode's but holding a question mark
  and "Helps?" / "Misleads?" (the opener's own questions) instead of 9.8;
  Taylor with both arms up, Hulse unconvinced; "How far do we trust it?"
  set flush right;
- the episode: Hulse in close-up filling the right half, squinting through
  his glasses at a small Pulsar card reading "9.8 Correct.", under
  "It looked right."

The files ship in topic_seed/media/, which /api/content/media/ falls back to
when the upload folder does not have them. The old shared poster stays there
too, for anything that still points at it.

Only a video that still carries the shared poster is changed, matched by its
YouTube address, in `videos` and in the legacy `video` mirror of the first
one, so a poster an editor has chosen since is kept. Backwards puts the
shared poster back on the same rows.
"""
from django.db import migrations


SLUG = 'answer-that-looked-right'
SHARED = '/api/content/media/b835e55ced181d6f6265dda7155eae0b.webp/'
POSTERS = {
    '3-8GV5mvTnI': (
        '/api/content/media/7ed470c6749e9bc2b2813ac535c9d8c1.webp/',
        'Taylor with both arms raised and Hulse unconvinced beside her, looking up at a Pulsar card '
        'with a question mark and two labels, Helps? and Misleads?, next to the question How far do we trust it?',
    ),
    '6-wKSrn51Ro': (
        '/api/content/media/b56dd2af5818cb504ed93376a769e051.webp/',
        'Hulse in close-up, squinting through his glasses at a small Pulsar card that reads 9.8, Correct.',
    ),
}


def _swap(apps, forwards):
    ContentItem = apps.get_model('core', 'ContentItem')
    item = ContentItem.objects.filter(slug=SLUG).first()
    if item is None or not isinstance(item.topic_data, dict):
        return
    data = dict(item.topic_data)
    changed = False

    def fix(video):
        nonlocal changed
        if not isinstance(video, dict):
            return video
        url = str(video.get('youtube_url') or '')
        for key, (own, alt) in POSTERS.items():
            if key not in url:
                continue
            old, new, new_alt = (SHARED, own, alt) if forwards else (own, SHARED, '')
            if video.get('poster_url') == old:
                changed = True
                return dict(video, poster_url=new, poster_alt=new_alt)
        return video

    if isinstance(data.get('videos'), list):
        data['videos'] = [fix(video) for video in data['videos']]
    if isinstance(data.get('video'), dict):
        data['video'] = fix(data['video'])
    if changed:
        item.topic_data = data
        item.save(update_fields=['topic_data', 'updated_at'])


def forwards(apps, schema_editor):
    _swap(apps, True)


def backwards(apps, schema_editor):
    _swap(apps, False)


class Migration(migrations.Migration):
    dependencies = [('core', '0108_topic_01_drop_removed_pages')]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
