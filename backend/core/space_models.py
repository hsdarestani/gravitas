from django.conf import settings
from django.db import models
from django.db.models import Q


class SpaceNode(models.Model):
    class Kind(models.TextChoices):
        SUBSPACE = 'subspace', 'Subspace'
        CATEGORY = 'category', 'Category'

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_space_nodes',
    )
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        related_name='children',
        blank=True,
        null=True,
    )
    kind = models.CharField(max_length=16, choices=Kind.choices, db_index=True)
    title = models.CharField(max_length=220)
    filesystem_name = models.CharField(max_length=240)
    nextcloud_path = models.CharField(max_length=1000)
    content_hash = models.CharField(max_length=80, blank=True)
    sync_state = models.CharField(max_length=24, default='pending', db_index=True)
    sync_error = models.CharField(max_length=240, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['nextcloud_path']
        constraints = [
            models.UniqueConstraint(fields=['owner', 'nextcloud_path'], name='unique_gravitas_space_path'),
            models.CheckConstraint(
                condition=(Q(kind='subspace', parent__isnull=True) | Q(kind='category')),
                name='gravitas_subspace_is_top_level',
            ),
        ]


class ProjectSpaceLink(models.Model):
    project = models.ForeignKey(
        'core.ResearchProject',
        on_delete=models.CASCADE,
        related_name='space_links',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_project_space_links',
    )
    category = models.ForeignKey(
        SpaceNode,
        on_delete=models.PROTECT,
        related_name='projects',
    )
    folder_path = models.CharField(max_length=1000)
    metadata_path = models.CharField(max_length=1000)
    content_hash = models.CharField(max_length=80, blank=True)
    sync_state = models.CharField(max_length=24, default='pending', db_index=True)
    sync_error = models.CharField(max_length=240, blank=True)
    last_synced_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['project', 'user'], name='unique_gravitas_project_space_user'),
        ]


class NoteSpaceLink(models.Model):
    resource = models.OneToOneField(
        'core.KnowledgeResource',
        on_delete=models.CASCADE,
        related_name='space_link',
    )
    category = models.ForeignKey(
        SpaceNode,
        on_delete=models.PROTECT,
        related_name='notes',
        blank=True,
        null=True,
    )
    parent_note = models.ForeignKey(
        'core.KnowledgeResource',
        on_delete=models.SET_NULL,
        related_name='nested_space_notes',
        blank=True,
        null=True,
    )
    note_path = models.CharField(max_length=1000)
    attachments_path = models.CharField(max_length=1000, blank=True)
    content_hash = models.CharField(max_length=80, blank=True)
    sync_state = models.CharField(max_length=24, default='pending', db_index=True)
    sync_error = models.CharField(max_length=240, blank=True)
    last_synced_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class SpaceManagedItem(models.Model):
    """DB-backed Markdown objects that complete the Space type vocabulary.

    Projects and notes have first-class Gravitas domain models already. These
    four types are intentionally lightweight filesystem-domain objects so a
    user's Space can contain them without requiring an Operating Initiative,
    cycle, or other unrelated workflow object.
    """

    class Kind(models.TextChoices):
        SUBPROJECT = 'subproject', 'Subproject'
        TASK = 'task', 'Task'
        SUBTASK = 'subtask', 'Subtask'
        REPOSITORY = 'repository', 'Repository'

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_space_managed_items',
    )
    project = models.ForeignKey(
        'core.ResearchProject',
        on_delete=models.CASCADE,
        related_name='space_managed_items',
        blank=True,
        null=True,
    )
    category = models.ForeignKey(
        SpaceNode,
        on_delete=models.PROTECT,
        related_name='managed_items',
        blank=True,
        null=True,
    )
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        related_name='children',
        blank=True,
        null=True,
    )
    kind = models.CharField(max_length=20, choices=Kind.choices, db_index=True)
    title = models.CharField(max_length=240)
    body = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    file_path = models.CharField(max_length=1000)
    folder_path = models.CharField(max_length=1000)
    content_hash = models.CharField(max_length=80, blank=True)
    sync_state = models.CharField(max_length=24, default='pending', db_index=True)
    sync_error = models.CharField(max_length=240, blank=True)
    last_synced_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['file_path']
        constraints = [
            models.UniqueConstraint(fields=['owner', 'file_path'], name='unique_gravitas_managed_space_path'),
            models.CheckConstraint(
                condition=(Q(project__isnull=False) | Q(category__isnull=False) | Q(parent__isnull=False)),
                name='gravitas_managed_item_has_parent',
            ),
        ]


class AIProviderCredential(models.Model):
    class Provider(models.TextChoices):
        OPENAI = 'openai', 'OpenAI'
        ANTHROPIC = 'anthropic', 'Anthropic'
        GEMINI = 'gemini', 'Google Gemini'
        OPENAI_COMPATIBLE = 'openai_compatible', 'OpenAI-compatible'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_ai_credentials',
    )
    provider = models.CharField(max_length=32, choices=Provider.choices, db_index=True)
    label = models.CharField(max_length=120)
    model = models.CharField(max_length=220)
    base_url = models.URLField(max_length=1000, blank=True)
    encrypted_api_key = models.TextField()
    is_default = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_default', 'provider', 'label']
        constraints = [
            models.UniqueConstraint(fields=['user', 'provider', 'label'], name='unique_gravitas_ai_provider_label'),
        ]
