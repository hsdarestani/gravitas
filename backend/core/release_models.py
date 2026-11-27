"""Durable, staging-side release proposals, exact revisions, and evidence."""
from django.conf import settings
from django.db import models


class ReleaseChange(models.Model):
    class Kind(models.TextChoices):
        VISUAL = 'visual', 'Visual edit'
        DEVELOPMENT = 'development', 'Development change'

    class State(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        SUBMITTED = 'submitted', 'Submitted'
        VALIDATING = 'awaiting_validation', 'Awaiting validation'
        READY = 'ready_for_qa', 'Ready for QA'
        REVIEW = 'in_review', 'In review'
        CORRECTIONS = 'changes_requested', 'Changes requested'
        APPROVED = 'approved', 'Approved'
        SCHEDULED = 'scheduled', 'Scheduled'
        RELEASING = 'releasing', 'Releasing'
        RELEASED = 'released', 'Released'
        FAILED = 'failed', 'Failed'
        REJECTED = 'rejected', 'Rejected'
        SUPERSEDED = 'superseded', 'Superseded'
        ROLLED_BACK = 'rolled_back', 'Rolled back'

    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name='+')
    task = models.ForeignKey('core.OperatingTask', on_delete=models.PROTECT, null=True, related_name='+')
    kind = models.CharField(max_length=16, choices=Kind.choices)
    state = models.CharField(max_length=24, choices=State.choices, default=State.DRAFT)
    page = models.CharField(max_length=32, blank=True)
    revision = models.PositiveIntegerField(default=1)
    sequence = models.PositiveIntegerField(default=1)
    approved_revision = models.PositiveIntegerField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        permissions = [
            ('author_release_change', 'Can author release proposals'),
            ('review_release_change', 'Can review release proposals'),
            ('rehearse_release_change', 'Can publish to the isolated release rehearsal target'),
        ]


class ReleaseRevision(models.Model):
    change = models.ForeignKey(ReleaseChange, on_delete=models.PROTECT, related_name='revisions')
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    number = models.PositiveIntegerField()
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['change', 'number'], name='release_revision_number')]


class ReleaseEvent(models.Model):
    change = models.ForeignKey(ReleaseChange, on_delete=models.PROTECT, related_name='events')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    action = models.CharField(max_length=32)
    revision = models.PositiveIntegerField()
    evidence = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)


class VisualRehearsalPage(models.Model):
    """An isolated publication target for testing release mechanics."""
    page = models.CharField(max_length=32, unique=True)
    values = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)
