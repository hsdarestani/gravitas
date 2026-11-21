"""Topic 01 stops linking to draft pages that are no longer on the site.

On 2026-11-21 the owner settled that Topic 01 is the only published Topic.
Topic 03 ("Can a machine form a hypothesis?", with its dossier redirect and
its game) and the Learning Path page path-ai-in-research.html are drafts, so
their pages were taken off the site. Naming them in text is fine; a link that
opens them is not.

Topic 01's record linked to both: its two "Where this goes next" cards, and a
"Learning Path: AI in Research" row in its sources that was nothing but that
link. The cards stay, as text, with their address emptied (the Topic page
already shows them disabled, and the home rail draws a card without an
address as plain text). The source row goes, since a source is its link.

`topic_seed/topic-01.json` makes the same change in the same commit, but the
seed only fills an empty database, so the live row is cleaned here. Only
entries whose address is one of the removed pages are touched; anything an
editor has added under Platform Admin is kept.

There is no backwards step: it would restore links to pages that 404.
"""
from django.db import migrations


SLUG = 'answer-that-looked-right'
GONE = {'/path-ai-in-research.html', '/topic-machine-hypothesis.html'}


def forwards(apps, schema_editor):
    ContentItem = apps.get_model('core', 'ContentItem')
    item = ContentItem.objects.filter(slug=SLUG).first()
    if item is None or not isinstance(item.topic_data, dict):
        return
    data = dict(item.topic_data)
    changed = False

    sources = data.get('sources')
    if isinstance(sources, list):
        kept = [row for row in sources if not (isinstance(row, dict) and row.get('url') in GONE)]
        if len(kept) != len(sources):
            data['sources'] = kept
            changed = True

    cards = data.get('next')
    if isinstance(cards, list):
        unlinked = []
        for card in cards:
            if isinstance(card, dict) and card.get('href') in GONE:
                card = dict(card, href='')
                changed = True
            unlinked.append(card)
        data['next'] = unlinked

    if changed:
        item.topic_data = data
        item.save(update_fields=['topic_data', 'updated_at'])


class Migration(migrations.Migration):
    dependencies = [('core', '0107_comment_anchor_and_dislike')]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
