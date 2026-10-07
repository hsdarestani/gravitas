"""Caches and revision provenance for authoritative Nextcloud project files."""
from django.conf import settings
from django.db import models


class CanonicalProject(models.Model):
    project = models.OneToOneField('core.ResearchProject', on_delete=models.CASCADE, related_name='canonical_storage')
    enabled = models.BooleanField(default=False)
    schema_version = models.PositiveIntegerField(default=1)
    activated_at = models.DateTimeField(null=True, blank=True)
    migration_backup_path = models.CharField(max_length=1000, blank=True)
    last_error = models.TextField(blank=True)


class CanonicalFile(models.Model):
    project = models.ForeignKey('core.ResearchProject', on_delete=models.CASCADE, related_name='canonical_files')
    path = models.CharField(max_length=1000)
    object_type = models.CharField(max_length=80, blank=True)
    object_id = models.PositiveBigIntegerField(null=True, blank=True)
    etag = models.CharField(max_length=240, blank=True)
    file_id = models.CharField(max_length=120, blank=True)
    # Explicitly a revision cache / three-way merge base, never independent content.
    base_content = models.TextField(blank=True)
    deleted = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['project', 'path'], name='unique_canonical_project_path')]


class CanonicalFileRevision(models.Model):
    file = models.ForeignKey(CanonicalFile, on_delete=models.CASCADE, related_name='revisions')
    etag = models.CharField(max_length=240, blank=True)
    content = models.TextField()
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    source = models.CharField(max_length=32, default='gravitas')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
