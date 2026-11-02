"""Workspace execution calendar; task facts stay in the existing domain rows."""
from django.db import models


class ExecutionSettings(models.Model):
    workspace = models.OneToOneField('core.Workspace', on_delete=models.CASCADE, related_name='execution_settings')
    timezone = models.CharField(max_length=64, default='UTC')
    inactivity_business_days = models.PositiveSmallIntegerField(default=3)
    business_weekdays = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
