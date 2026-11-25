"""Persist the public projection and its immutable Markdown snapshots together."""
from django.utils import timezone

from .models import TopicEssayPublication, TopicEssayVersion


def record_publication(current, *, depth, project, path, etag, markdown,
                       publisher=None, change_note='', restored_from=None):
    """Call inside the transaction holding the Topic 01 project row lock."""
    latest = current.versions.values_list('number', flat=True).first() if current else None
    publication = current or TopicEssayPublication(depth=depth)
    publication.project = project
    publication.source_path = path
    publication.source_etag = etag
    publication.markdown = markdown
    publication.published_at = timezone.now()
    publication.published_by = publisher
    publication.save()
    return TopicEssayVersion.objects.create(
        publication=publication, number=(latest or 0) + 1, project=project,
        source_path=path, source_etag=etag, markdown=markdown,
        published_at=publication.published_at, published_by=publisher,
        publisher_name=publisher.get_username() if publisher else '',
        change_note=change_note, restored_from=restored_from,
    )
