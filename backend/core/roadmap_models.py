from django.db import models


class RoadmapOKRSyncState(models.Model):
    """Tracks the non-destructive binding between Roadmap source keys and Core OKRs."""

    workspace = models.OneToOneField(
        'core.Workspace',
        on_delete=models.CASCADE,
        related_name='roadmap_okr_sync_state',
    )
    source_url = models.URLField(max_length=500, blank=True)
    source_revision = models.CharField(max_length=64, blank=True)
    bindings = models.JSONField(default=dict, blank=True)
    last_attempted_at = models.DateTimeField(blank=True, null=True)
    last_synced_at = models.DateTimeField(blank=True, null=True)
    last_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Roadmap OKR sync state'
        verbose_name_plural = 'Roadmap OKR sync states'

    def __str__(self):
        return f'Roadmap OKR sync · {self.workspace}'
