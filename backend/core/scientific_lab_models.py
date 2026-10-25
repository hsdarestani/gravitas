"""Additive, immutable protocol snapshots; existing research records remain canonical."""
import uuid
from django.conf import settings
from django.db import models


class ScientificLabRun(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    experiment = models.OneToOneField('core.ResearchExperiment', on_delete=models.PROTECT, related_name='scientific_run')
    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    idempotency_key = models.UUIDField()
    protocol = models.JSONField()
    protocol_hash = models.CharField(max_length=64)
    state = models.CharField(max_length=32, default='draft', db_index=True)
    trials = models.JSONField(default=list)
    error = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['creator', 'idempotency_key'], name='gq_lab_idempotency')]


class ScientificLabEvent(models.Model):
    run = models.ForeignKey(ScientificLabRun, on_delete=models.PROTECT, related_name='events')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    kind = models.CharField(max_length=40)
    detail = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['id']
