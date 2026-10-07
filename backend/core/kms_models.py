from django.conf import settings
from django.db import models


class KMSState(models.Model):
    """Durable per-account state for learning sources, recall and paths.

    Notes themselves stay in KnowledgeResource/workspace pages. This model only
    owns the scheduling/curriculum state that used to live exclusively in
    browser localStorage, so review history follows the account across devices.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_kms_state',
    )
    data = models.JSONField(default=dict, blank=True)
    schema_version = models.PositiveSmallIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['user_id']

    def __str__(self):
        return f'KMS state · {self.user_id}'
