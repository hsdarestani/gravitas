"""Bounded project plugin references and private edit buffers.

Credentials never appear in these rows. The operational aliases resolve only
to administrator-supplied server settings; no arbitrary network locations
are accepted from research users.
"""
from django.conf import settings
from django.db import models


class ProjectProviderBinding(models.Model):
    class Kind(models.TextChoices):
        PRIVATE_GIT = 'private_git', 'Private GitHub'
        REMOTE_DB = 'remote_db', 'External database'

    project = models.ForeignKey(
        'core.ResearchProject', on_delete=models.CASCADE, related_name='provider_bindings',
    )
    kind = models.CharField(max_length=24, choices=Kind.choices)
    credential_alias = models.CharField(max_length=80)
    resource = models.CharField(max_length=210, blank=True)
    last_verified_at = models.DateTimeField(null=True, blank=True)
    configured_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name='gravitas_provider_bindings',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=['project', 'kind'], name='unique_project_provider_kind'
        )]


class ProjectBufferedDraft(models.Model):
    """User-owned buffered edit of a canonical Nextcloud file.

    The base snapshot and ETag are captured from DAV, not user supplied.
    Only an explicit push may send the draft to Nextcloud.
    """
    file = models.ForeignKey(
        'core.CanonicalFile', on_delete=models.CASCADE, related_name='buffered_drafts',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='gravitas_buffered_drafts',
    )
    base_etag = models.CharField(max_length=240)
    base_content = models.TextField()
    content = models.TextField()
    revision = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=['file', 'user'], name='unique_user_file_buffer'
        )]
