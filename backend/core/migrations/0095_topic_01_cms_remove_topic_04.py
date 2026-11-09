"""Make Topic 01 a CMS record and remove Topic 04 from the database.

Topic 01 used to live in static HTML, so nothing an admin saved could reach it.
This creates its ContentItem from the content that page carried, verbatim, in
`topic_seed/topic-01.json`. An existing row is left alone: once an admin has
edited the Topic, a re-run must not put the seed back over their work.

Topic 04 ("computable-universe") is deleted with what hangs off it. Its forum
link goes first because ForumDiscussion.content is PROTECT, and would otherwise
stop the deploy on the row delete. The Discourse thread itself lives outside
this database and is not touched here.

There is no reverse. The Topic 04 rows are gone, by decision, and unapplying
this must not delete a Topic 01 an admin has been editing.
"""
import json
from pathlib import Path

from django.db import migrations
from django.utils import timezone

SEED = Path(__file__).resolve().parent.parent / 'topic_seed' / 'topic-01.json'
TOPIC_04 = 'computable-universe'
TOPIC_04_READER_KEYS = (TOPIC_04, 'topic-computable-universe', 'dossier-computable-universe')


def apply(apps, schema_editor):
    ContentItem = apps.get_model('core', 'ContentItem')
    record = json.loads(SEED.read_text(encoding='utf-8'))
    ContentItem.objects.get_or_create(slug=record['slug'], defaults={
        'kind': 'topic',
        'status': 'published',
        'title': record['title'],
        'summary': record['summary'],
        'body': '',
        'topic_data': record['topic_data'],
        'published_at': timezone.now(),
    })

    apps.get_model('core', 'ForumDiscussion').objects.filter(content_key=TOPIC_04).delete()
    apps.get_model('core', 'Comment').objects.filter(content_key=TOPIC_04).delete()
    apps.get_model('core', 'ReaderSavedItem').objects.filter(item_key__in=TOPIC_04_READER_KEYS).delete()
    apps.get_model('core', 'InteractiveLab').objects.filter(topic_slug=TOPIC_04).update(topic_slug='')
    ContentItem.objects.filter(slug=TOPIC_04).delete()


class Migration(migrations.Migration):
    dependencies = [('core', '0094_discussion_wording')]
    operations = [migrations.RunPython(apply, migrations.RunPython.noop)]
