"""The 41-second opener becomes the Topic's teaser, and Videos keeps a planned slot.

On 2026-11-22 the owner asked for an Overview at the head of the Topic page:
the 41-second opener (youtu.be/3-8GV5mvTnI) as a teaser beside the Topic's
description, the same on the home-page reel. The opener leaves the Videos
section, which then holds the one episode (youtu.be/6-wKSrn51Ro), and the
place of the second video stays, marked Planned, rather than the list
shrinking to one.

So the opener's row gets `role: "teaser"` (the frontend draws a teaser in
Overview and never in Videos; the Topic editor shows the role as a field),
and loses the "Topic 1 videos - " prefix an editor gave it: no Topic carries
a number anywhere since 2026-11-22. A row titled "Next video" that is not
published (`source_type: "none"`) is added after the episodes; the page draws
an unpublished video as Planned.

Both videos' posters had "GRAVIQUEST · TOPIC 01" set in them; the kicker now
reads GRAVIQUEST alone (new files in topic_seed/media, since the media route
caches a name for a year). A poster is swapped only while it is still the
old file, so a poster an editor has chosen since is kept.

Matched by YouTube address, so an opener an editor has replaced is left
alone, and the planned row is added only when no unpublished row exists.
Backwards takes the role off, puts the old title back and removes the
planned row this added.
"""
from django.db import migrations


SLUG = 'answer-that-looked-right'
TEASER = '3-8GV5mvTnI'
OLD_TITLE = 'Topic 1 videos - Is AI reliable in research?'
NEW_TITLE = 'Is AI reliable in research?'
POSTERS = {
    '/api/content/media/7ed470c6749e9bc2b2813ac535c9d8c1.webp/': '/api/content/media/7ae9121f27d54453d7a727da9cf2b4eb.webp/',
    '/api/content/media/b56dd2af5818cb504ed93376a769e051.webp/': '/api/content/media/d81d44c227b9c4b21b6b34dded1bd157.webp/',
}
PLANNED = {'title': 'Next video', 'source_type': 'none', 'youtube_url': '', 'self_hosted_url': '',
           'poster_url': '', 'poster_alt': '', 'description': '', 'duration': '', 'info': '',
           'companion_label': '', 'companion_url': '', 'transcript_label': '', 'transcript_url': ''}


def _published(video):
    return (video.get('source_type') or 'none') != 'none'


def _apply(apps, forwards):
    ContentItem = apps.get_model('core', 'ContentItem')
    item = ContentItem.objects.filter(slug=SLUG).first()
    if item is None or not isinstance(item.topic_data, dict):
        return
    data = dict(item.topic_data)
    videos = [dict(v) for v in data.get('videos') or [] if isinstance(v, dict)]
    if not videos:
        return
    changed = False
    swap = POSTERS if forwards else {new: old for old, new in POSTERS.items()}
    for video in videos:
        if video.get('poster_url') in swap:
            video['poster_url'] = swap[video['poster_url']]
            changed = True
    if isinstance(data.get('video'), dict) and data['video'].get('poster_url') in swap:
        data['video'] = dict(data['video'], poster_url=swap[data['video']['poster_url']])
        changed = True
    for video in videos:
        if TEASER not in str(video.get('youtube_url') or ''):
            continue
        if forwards:
            if video.get('role') != 'teaser':
                video['role'] = 'teaser'
                changed = True
            if video.get('title') == OLD_TITLE:
                video['title'] = NEW_TITLE
                changed = True
        else:
            if video.pop('role', None) is not None:
                changed = True
            if video.get('title') == NEW_TITLE:
                video['title'] = OLD_TITLE
                changed = True
    if forwards:
        if not any(not _published(v) for v in videos):
            videos.append(dict(PLANNED))
            changed = True
    else:
        kept = [v for v in videos if not (not _published(v) and v.get('title') == PLANNED['title'] and not v.get('description'))]
        if len(kept) != len(videos):
            videos = kept
            changed = True
    if changed:
        data['videos'] = videos
        item.topic_data = data
        item.save(update_fields=['topic_data', 'updated_at'])


def forwards(apps, schema_editor):
    _apply(apps, True)


def backwards(apps, schema_editor):
    _apply(apps, False)


class Migration(migrations.Migration):
    dependencies = [('core', '0111_reader_saved_item_video_essay')]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
