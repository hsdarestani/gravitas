"""Confirmed reporting is provenance, not an AI-owned copy of task state."""
import uuid
from django.conf import settings
from django.db import models


class DailyWorkReport(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='daily_work_reports')
    report_date = models.DateField()
    source = models.CharField(max_length=32, default='platform')
    source_key = models.CharField(max_length=180)
    original_text = models.TextField()
    interpretation = models.JSONField(default=dict)
    status = models.CharField(max_length=16, default='pending', choices=[('pending', 'Needs confirmation'), ('confirmed', 'Confirmed by user'), ('cancelled', 'Cancelled')])
    revision = models.PositiveIntegerField(default=1)
    proposal_history = models.JSONField(default=list)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    supersedes = models.ForeignKey('self', null=True, blank=True, on_delete=models.PROTECT, related_name='corrections')
    tasks = models.ManyToManyField('core.OperatingTask', related_name='daily_work_reports', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [models.UniqueConstraint(fields=['user', 'source', 'source_key'], name='unique_confirmed_work_input')]


class DailyCheckIn(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    report_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'report_date'], name='unique_daily_checkin')]
