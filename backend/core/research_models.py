from django.conf import settings
from django.db import models


class ResearchExperiment(models.Model):
    """A project-scoped experiment/protocol record.

    The Research Workspace needs an explicit place for hypotheses, protocols
    and results. Files and datasets remain KnowledgeResource rows in
    Nextcloud; this row is the structured experiment record that points people
    at what was tested and what happened.
    """

    class Status(models.TextChoices):
        PLANNED = 'planned', 'Planned'
        RUNNING = 'running', 'Running'
        REVIEW = 'review', 'Under review'
        COMPLETE = 'complete', 'Complete'
        ABANDONED = 'abandoned', 'Abandoned'

    project = models.ForeignKey(
        'core.ResearchProject',
        on_delete=models.CASCADE,
        related_name='experiments',
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='gravitas_experiments_owned',
    )
    title = models.CharField(max_length=240)
    hypothesis = models.TextField(blank=True)
    protocol = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PLANNED, db_index=True)
    started_at = models.DateTimeField(blank=True, null=True)
    completed_at = models.DateTimeField(blank=True, null=True)
    result_summary = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [models.Index(fields=['project', 'status', '-updated_at'], name='grav_experiment_project_state')]

    def __str__(self):
        return f'{self.project_id} · {self.title}'


class ProjectDiscussionMessage(models.Model):
    """Private project discussion inherited from the project's ACL boundary."""

    project = models.ForeignKey(
        'core.ResearchProject',
        on_delete=models.CASCADE,
        related_name='discussion_messages',
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_project_messages',
    )
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        related_name='replies',
        blank=True,
        null=True,
    )
    body = models.TextField(max_length=10000)
    resolved = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at', 'id']
        indexes = [models.Index(fields=['project', 'resolved', 'created_at'], name='grav_project_discussion_state')]

    def __str__(self):
        return f'{self.project_id} · {self.author_id} · {self.created_at:%Y-%m-%d}'


class DocumentAnnotation(models.Model):
    """Threadable comments anchored to a project note/document.

    The first iteration intentionally stores anchors as JSON instead of tying
    them to one editor implementation. Today an anchor can describe a text
    quote/range or simply the whole document; richer highlight semantics can be
    added without migrating the collaboration model again.
    """

    project = models.ForeignKey(
        'core.ResearchProject',
        on_delete=models.CASCADE,
        related_name='document_annotations',
    )
    resource = models.ForeignKey(
        'core.KnowledgeResource',
        on_delete=models.CASCADE,
        related_name='annotations',
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_document_annotations',
    )
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        related_name='replies',
        blank=True,
        null=True,
    )
    body = models.TextField(max_length=10000)
    anchor = models.JSONField(default=dict, blank=True)
    resolved = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at', 'id']
        indexes = [
            models.Index(fields=['resource', 'resolved', 'created_at'], name='grav_annotation_resource_state'),
            models.Index(fields=['project', 'resolved'], name='grav_annotation_project_state'),
        ]

    def __str__(self):
        return f'{self.resource_id} · {self.author_id} · {self.created_at:%Y-%m-%d}'
