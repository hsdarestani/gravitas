"""Links to Discourse records, never a second store of forum posts or votes.

Publication is explicit. A private review link must not become public merely
because its scientific ContentItem is published. Discourse remains responsible
for category ACLs, post approval, attachments, notifications and persistence.
"""
from django.conf import settings
from django.db import models


class ForumDiscussion(models.Model):
    content_key = models.SlugField(max_length=190, unique=True)
    content = models.ForeignKey('core.ContentItem', null=True, blank=True, on_delete=models.PROTECT)
    discourse_topic_id = models.PositiveBigIntegerField(unique=True)
    discourse_category_id = models.PositiveIntegerField()
    is_public = models.BooleanField(default=False)
    content_version = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ForumLogout(models.Model):
    """Retryable logout outbox. No credential or session token is stored here."""
    external_id = models.CharField(max_length=80, unique=True)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    requested_at = models.DateTimeField(auto_now=True)
    attempts = models.PositiveIntegerField(default=0)

