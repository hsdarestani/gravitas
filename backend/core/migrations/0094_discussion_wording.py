"""Replace "argument" in the two seeded lines that reach the public site.

The site says "discussion" now, and migration 0020 wrote the old wording into
the computable-universe Topic. Editing that migration would change nothing on a
database that has already run it, so the rows are corrected here. Each line is
swapped only while it still holds the exact seeded text: an editor who has since
rewritten it in the CMS keeps what they wrote.
"""
from django.db import migrations


OLD_INTRO = (
    'We publish the strongest case against our own reading. If the counter-argument '
    'is weak here, that is our failure, not the argument’s.'
)
NEW_INTRO = (
    'We publish the strongest case against our own reading. If the objection '
    'is weak here, that is our failure, not the objection’s.'
)
OLD_TITLE = 'The argument is already running'
NEW_TITLE = 'The discussion is already running'


def _swap(apps, intro_from, intro_to, title_from, title_to):
    ContentItem = apps.get_model('core', 'ContentItem')
    item = ContentItem.objects.filter(slug='computable-universe').first()
    if item is None or not isinstance(item.topic_data, dict):
        return
    data = item.topic_data
    changed = False
    if data.get('viewpoints_intro') == intro_from:
        data['viewpoints_intro'] = intro_to
        changed = True
    landing = data.get('landing')
    if isinstance(landing, dict) and landing.get('discussion_title') == title_from:
        landing['discussion_title'] = title_to
        changed = True
    if changed:
        item.save(update_fields=['topic_data', 'updated_at'])


def forwards(apps, schema_editor):
    _swap(apps, OLD_INTRO, NEW_INTRO, OLD_TITLE, NEW_TITLE)


def backwards(apps, schema_editor):
    _swap(apps, NEW_INTRO, OLD_INTRO, NEW_TITLE, OLD_TITLE)


class Migration(migrations.Migration):
    dependencies = [('core', '0093_publicpagesnapshot_topicessaypublication')]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
