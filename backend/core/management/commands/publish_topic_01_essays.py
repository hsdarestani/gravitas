"""Initial publication of the two explicitly selected Nextcloud documents."""
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from core import cloud
from core.canonical_models import CanonicalFile
from core.models import ResearchProject, TopicEssayPublication
from core.platform_access import downloads_allowed
from core.topic_essay_api import read_essay_markdown
from core.topic_essay_sources import SOURCE_PATHS

# Only the two essays that existed before the reading levels. A level file is
# published by an editor after review, never by a deploy, and a deploy must
# not fail because a level has not been written yet.
INITIAL_SLOTS = ('overview', 'deep')


class Command(BaseCommand):
    help = 'Publish the selected Topic 01 Nextcloud essays into empty publication slots.'

    def handle(self, *args, **options):
        project = ResearchProject.objects.filter(pk=settings.TOPIC_01_RESEARCH_PROJECT_ID, archived=False).first()
        if not project or not downloads_allowed(project):
            raise CommandError('The Topic 01 project does not permit importing its essay sources.')

        occupied = set(TopicEssayPublication.objects.values_list('depth', flat=True))
        candidates = {}
        for slot in INITIAL_SLOTS:
            path = SOURCE_PATHS[slot]
            if slot in occupied:
                continue
            if CanonicalFile.objects.filter(project=project, path=path).exists():
                raise CommandError('The initial import expects ordinary project Markdown files.')
            try:
                with cloud.admin_download(f'{cloud.project_mountpoint(project)}/{path}') as source:
                    etag = source.headers.get('ETag', '')
                    markdown = read_essay_markdown(source)
                if not etag or len(etag) > 255 or not markdown.strip() or '\x00' in markdown:
                    raise ValueError('invalid source')
            except (cloud.CloudError, ImproperlyConfigured, ValueError) as exc:
                raise CommandError(f'The approved source for {slot} could not be read from Nextcloud.') from exc
            candidates[slot] = {'project': project, 'source_path': path, 'source_etag': etag, 'markdown': markdown}

        with transaction.atomic():
            locked = ResearchProject.objects.select_for_update().get(pk=project.pk)
            if locked.archived or not downloads_allowed(locked):
                raise CommandError('The Topic 01 project no longer permits importing its essay sources.')
            count = 0
            for slot, source in candidates.items():
                # The normal publisher locks the same project. An editor who
                # published while this command was reading the source wins.
                if TopicEssayPublication.objects.filter(project=project, source_path=source['source_path']).exists():
                    continue
                _, created = TopicEssayPublication.objects.get_or_create(
                    depth=slot, defaults={**source, 'published_at': timezone.now()},
                )
                count += created
        self.stdout.write(f'Published {count} previously unbound Topic 01 essays.')
