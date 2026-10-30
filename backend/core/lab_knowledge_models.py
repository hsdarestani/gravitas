"""Scientific sources, reproducible scenario atlas and visitor observations.

Computed atlas rows and browser observations are deliberately different records.
Only the release importer writes the former; visitor telemetry is never promoted
to verified science or used as a source for other visitors.
"""
from django.conf import settings
from django.db import models


class LabKnowledgeDocument(models.Model):
    lab = models.ForeignKey('core.InteractiveLab', on_delete=models.CASCADE, related_name='knowledge_documents')
    slug = models.SlugField(max_length=100)
    title = models.CharField(max_length=300)
    markdown = models.TextField()
    source_url = models.URLField(max_length=700, blank=True)
    license = models.CharField(max_length=250, blank=True)
    kind = models.CharField(max_length=30, default='model')
    version = models.PositiveIntegerField(default=1)
    content_hash = models.CharField(max_length=64)
    imported_hash = models.CharField(max_length=64, blank=True)
    sections = models.JSONField(default=list)
    is_published = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['lab', 'slug'], name='lab_document_slug')]
        ordering = ['slug']


class LabScenario(models.Model):
    lab = models.ForeignKey('core.InteractiveLab', on_delete=models.CASCADE, related_name='scenario_atlas')
    signature = models.CharField(max_length=64, unique=True)
    engine_sha = models.CharField(max_length=64, db_index=True)
    family = models.CharField(max_length=100, db_index=True)
    parameters = models.JSONField(default=dict)
    design = models.JSONField(default=dict)
    seed = models.PositiveBigIntegerField()
    days = models.PositiveIntegerField()
    result = models.JSONField(default=dict)
    trajectory = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['family', 'seed']


class LabRunSnapshot(models.Model):
    lab = models.ForeignKey('core.InteractiveLab', on_delete=models.CASCADE)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    signature = models.CharField(max_length=64)
    payload = models.JSONField(default=dict)
    provenance = models.CharField(max_length=30, default='browser_reported')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['lab', 'owner', 'signature'], name='lab_snapshot_owner_signature')]
        ordering = ['-created_at']
