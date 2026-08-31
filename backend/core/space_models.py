from django.conf import settings
from django.db import models

from .models import KnowledgeResource, ResearchProject


class SpaceNode(models.Model):
    class Kind(models.TextChoices):
        SUBSPACE = 'subspace', 'Subspace'
        CATEGORY = 'category', 'Category'

    class SyncState(models.TextChoices):
        SYNCED = 'synced', 'Synced'
        PENDING = 'pending', 'Pending'
        CONFLICT = 'conflict', 'Conflict'
        ERROR = 'error', 'Error'

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_space_nodes')
    parent = models.ForeignKey('self', on_delete=models.CASCADE, related_name='children', blank=True, null=True)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    title = models.CharField(max_length=180)
    storage_name = models.CharField(max_length=240)
    folder_path = models.CharField(max_length=1000)
    markdown_path = models.CharField(max_length=1000)
    metadata = models.JSONField(default=dict, blank=True)
    sync_state = models.CharField(max_length=16, choices=SyncState.choices, default=SyncState.PENDING)
    sync_hash = models.CharField(max_length=128, blank=True)
    last_synced_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['folder_path']
        constraints = [
            models.UniqueConstraint(fields=['owner', 'parent', 'storage_name'], name='unique_space_node_sibling'),
        ]


class ProjectSpacePlacement(models.Model):
    project = models.OneToOneField(ResearchProject, on_delete=models.CASCADE, related_name='space_placement')
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_project_space_placements')
    parent = models.ForeignKey(SpaceNode, on_delete=models.PROTECT, related_name='projects')
    storage_name = models.CharField(max_length=240)
    folder_path = models.CharField(max_length=1000)
    markdown_path = models.CharField(max_length=1000)
    sync_state = models.CharField(max_length=16, choices=SpaceNode.SyncState.choices, default=SpaceNode.SyncState.PENDING)
    sync_hash = models.CharField(max_length=128, blank=True)
    last_synced_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class NoteSpacePlacement(models.Model):
    resource = models.OneToOneField(KnowledgeResource, on_delete=models.CASCADE, related_name='space_placement')
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_note_space_placements')
    space_parent = models.ForeignKey(SpaceNode, on_delete=models.PROTECT, related_name='notes', blank=True, null=True)
    project = models.ForeignKey(ResearchProject, on_delete=models.CASCADE, related_name='space_notes', blank=True, null=True)
    parent_note = models.ForeignKey('self', on_delete=models.CASCADE, related_name='children', blank=True, null=True)
    storage_name = models.CharField(max_length=240)
    markdown_path = models.CharField(max_length=1000)
    attachments_path = models.CharField(max_length=1000)
    sync_state = models.CharField(max_length=16, choices=SpaceNode.SyncState.choices, default=SpaceNode.SyncState.PENDING)
    sync_hash = models.CharField(max_length=128, blank=True)
    last_synced_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['markdown_path']


class AIProviderAccount(models.Model):
    class Provider(models.TextChoices):
        NEXTCLOUD = 'nextcloud', 'Nextcloud AI'
        GRAVITAS = 'gravitas', 'Gravitas AI'
        OPENAI = 'openai', 'OpenAI'
        ANTHROPIC = 'anthropic', 'Anthropic'
        GEMINI = 'gemini', 'Google Gemini'
        OPENAI_COMPATIBLE = 'openai_compatible', 'OpenAI-compatible'

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_ai_providers')
    provider = models.CharField(max_length=32, choices=Provider.choices)
    label = models.CharField(max_length=120)
    model = models.CharField(max_length=180, blank=True)
    base_url = models.URLField(max_length=1000, blank=True)
    encrypted_api_key = models.TextField(blank=True)
    enabled = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_default', 'label']
        constraints = [
            models.UniqueConstraint(fields=['user', 'label'], name='unique_user_ai_provider_label'),
        ]
