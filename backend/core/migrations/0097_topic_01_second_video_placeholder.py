"""Give Topic 01 a second, placeholder video.

Requested on 2026-11-12 to see how the home rail and the Topic page behave with
two videos. It is a real row of the record, not something the page invents, so
the site shows exactly what the backend holds, and it is removed or replaced
like any other video: in the Topic editor's Videos tab.

The title and description say plainly that it is a placeholder. It has no
source, runtime or thumbnail, so the page shows an unplayable poster frame and
"Soon", which is the truth about it.

Only a Topic that still has exactly its one seeded video gets the row, so a
re-run, or an admin who has already arranged the videos, is left alone.
"""
from django.db import migrations

SLUG = 'answer-that-looked-right'
PLACEHOLDER = {
    'title': 'Placeholder: the second video',
    'source_type': 'none', 'youtube_url': '', 'self_hosted_url': '',
    'poster_url': '', 'poster_alt': 'Placeholder for the second Topic 01 video',
    'description': 'A placeholder for a second video in this Topic. Replace it with the real video, or remove it, in the Topic editor.',
    'duration': '', 'info': '',
    'companion_label': '', 'companion_url': '', 'transcript_label': '', 'transcript_url': '',
}


def apply(apps, schema_editor):
    ContentItem = apps.get_model('core', 'ContentItem')
    item = ContentItem.objects.filter(slug=SLUG).first()
    if item is None or not isinstance(item.topic_data, dict):
        return
    data = dict(item.topic_data)
    videos = data.get('videos')
    if not isinstance(videos, list) or len(videos) != 1:
        return
    data['videos'] = [videos[0], dict(PLACEHOLDER)]
    item.topic_data = data
    item.save(update_fields=['topic_data', 'updated_at'])


class Migration(migrations.Migration):
    dependencies = [('core', '0096_task_workflows')]
    operations = [migrations.RunPython(apply, migrations.RunPython.noop)]
