"""First-party Lab usage. No questions, conversation text, IPs or raw user agents."""
import uuid
from django.conf import settings
from django.db import models
from django.utils import timezone


class LabUsageVisit(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    lab = models.ForeignKey('core.InteractiveLab', on_delete=models.CASCADE, related_name='usage_visits')
    visitor_key = models.CharField(max_length=64, db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    published_version = models.PositiveIntegerField(default=0)
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    last_seen_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)
    active_seconds = models.PositiveIntegerField(default=0)
    device = models.CharField(max_length=12, default='desktop')
    browser = models.CharField(max_length=24, default='Other')
    operating_system = models.CharField(max_length=24, default='Other')
    event_count = models.PositiveIntegerField(default=0)
    comparisons = models.PositiveIntegerField(default=0)
    policy_changes = models.PositiveIntegerField(default=0)
    guide_tests = models.PositiveIntegerField(default=0)
    guide_completed = models.BooleanField(default=False)
    atlas_comparisons = models.PositiveIntegerField(default=0)
    source_reads = models.PositiveIntegerField(default=0)
    pulsar_questions = models.PositiveIntegerField(default=0)
    pulsar_answers = models.PositiveIntegerField(default=0)
    pulsar_failures = models.PositiveIntegerField(default=0)
    snapshots = models.PositiveIntegerField(default=0)

    class Meta:
        indexes = [models.Index(fields=['lab', 'started_at'], name='lab_usage_lab_started')]


class LabUsageEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    visit = models.ForeignKey(LabUsageVisit, on_delete=models.CASCADE, related_name='events')
    kind = models.CharField(max_length=40)
    received_at = models.DateTimeField(default=timezone.now, db_index=True)
    data = models.JSONField(default=dict)
    provenance = models.CharField(max_length=24, default='browser_reported')

    class Meta:
        indexes = [models.Index(fields=['visit', 'received_at'], name='lab_usage_visit_event')]
