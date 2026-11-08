"""Export only published scientific content; import stable Discourse IDs.

No sample research or invented participation is seeded. The importer creates
links only, preserving every existing comment, poll vote and account.
"""
import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from core.forum_models import ForumDiscussion
from core.forum_content import STATIC_TOPICS, published_manifest
from core.models import ContentItem


class Command(BaseCommand):
    help = 'Export published content or import checked Discourse topic mappings.'

    def add_arguments(self, parser):
        group = parser.add_mutually_exclusive_group(required=True)
        group.add_argument('--output')
        group.add_argument('--import-links')

    def handle(self, *args, **options):
        if options['output']:
            manifest = published_manifest()
            Path(options['output']).write_text(json.dumps(manifest, indent=2))
            self.stdout.write(f'Exported {len(manifest["published_content"])} published content records.')
            return
        try:
            data = json.loads(Path(options['import_links']).read_text())
            with transaction.atomic():
                for link in data['links']:
                    key = link['key']; content = None
                    if link.get('content_id'):
                        content = ContentItem.objects.get(pk=link['content_id'], slug=key, status=ContentItem.Status.PUBLISHED)
                    elif key not in ('weekly-thought-experiment', 'next-topic-poll') and not (key in STATIC_TOPICS and link.get('source') == 'static'):
                        raise ValueError('Unexpected non-content link')
                    topic_id, category_id = int(link['topic_id']), int(link['category_id'])
                    if topic_id < 1 or category_id < 1:
                        raise ValueError('Invalid Discourse ID')
                    current = ForumDiscussion.objects.filter(content_key=key).first()
                    if current and current.discourse_topic_id != topic_id:
                        raise ValueError('An existing content link points to a different discussion')
                    ForumDiscussion.objects.update_or_create(content_key=key, defaults={
                        'content':content,'discourse_topic_id':topic_id,
                        'discourse_category_id':category_id,'is_public':True,
                        'content_version':link.get('version','')})
        except (KeyError, TypeError, ValueError, ContentItem.DoesNotExist) as exc:
            raise CommandError('Invalid manifest; existing links were preserved.') from exc
        self.stdout.write(f'Linked {len(data["links"])} official Discourse discussions.')
