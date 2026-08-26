from django.conf import settings
from django.db import models
from django.db.models import Q


class NewsletterSubscriber(models.Model):
    email = models.EmailField(unique=True)
    is_active = models.BooleanField(default=True)
    source = models.CharField(max_length=80, default='website')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.email


class ContentItem(models.Model):
    class Kind(models.TextChoices):
        ARTICLE = 'article', 'Article'
        DOSSIER = 'dossier', 'Dossier'
        LEARNING = 'learning', 'Learning path'
        LAB = 'lab', 'Lab / Interactive'

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'

    kind = models.CharField(max_length=24, choices=Kind.choices, default=Kind.ARTICLE)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    slug = models.SlugField(max_length=180, unique=True)
    title = models.CharField(max_length=220)
    summary = models.TextField(blank=True)
    body = models.TextField(blank=True)
    published_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-published_at', '-created_at']

    def __str__(self):
        return self.title


class ContentTranslation(models.Model):
    class Locale(models.TextChoices):
        GERMAN = 'de', 'Deutsch'
        PERSIAN = 'fa', 'فارسی'

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'

    content = models.ForeignKey(
        ContentItem,
        on_delete=models.CASCADE,
        related_name='translations',
    )
    locale = models.CharField(max_length=8, choices=Locale.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    title = models.CharField(max_length=220)
    summary = models.TextField(blank=True)
    body = models.TextField(blank=True)
    published_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['content_id', 'locale']
        constraints = [
            models.UniqueConstraint(
                fields=['content', 'locale'],
                name='unique_content_translation_locale',
            ),
        ]

    def __str__(self):
        return f'{self.content.title} · {self.locale}'


class Comment(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending review'
        PUBLISHED = 'published', 'Published'
        HIDDEN = 'hidden', 'Hidden'

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_comments',
    )
    content_key = models.SlugField(max_length=190, db_index=True)
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        related_name='replies',
        blank=True,
        null=True,
    )
    body = models.TextField(max_length=5000)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(
                fields=['content_key', 'status', 'created_at'],
                name='grav_comment_state_created',
            ),
        ]

    def __str__(self):
        return f'{self.author} · {self.content_key} · {self.status}'


class LabProgress(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_lab_progress',
    )
    lab_key = models.SlugField(max_length=190)
    state = models.JSONField(default=dict, blank=True)
    result = models.JSONField(default=dict, blank=True)
    score = models.FloatField(blank=True, null=True)
    completed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'lab_key'], name='unique_user_lab_progress'),
        ]
        ordering = ['-updated_at']

    def __str__(self):
        return f'{self.user} · {self.lab_key}'


class Organization(models.Model):
    name = models.CharField(max_length=180)
    slug = models.SlugField(max_length=180, unique=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_organizations_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class OrganizationMembership(models.Model):
    class Role(models.TextChoices):
        OWNER = 'owner', 'Owner'
        ADMIN = 'admin', 'Admin'
        MEMBER = 'member', 'Member'

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_org_memberships')
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.MEMBER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['organization', 'user'], name='unique_gravitas_org_member'),
        ]


class Workspace(models.Model):
    class Kind(models.TextChoices):
        PERSONAL = 'personal', 'Personal'
        TEAM = 'team', 'Team'

    name = models.CharField(max_length=180)
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.PERSONAL)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='owned_gravitas_workspaces',
        blank=True,
        null=True,
    )
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name='workspaces',
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['owner'],
                condition=Q(kind='personal'),
                name='one_personal_workspace_per_user',
            ),
            models.CheckConstraint(
                condition=(Q(kind='personal', owner__isnull=False, organization__isnull=True) |
                           Q(kind='team', organization__isnull=False)),
                name='valid_workspace_principal',
            ),
        ]

    def __str__(self):
        return self.name


class WorkspaceMembership(models.Model):
    class Role(models.TextChoices):
        OWNER = 'owner', 'Owner'
        ADMIN = 'admin', 'Admin'
        MEMBER = 'member', 'Member'

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_workspace_memberships')
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.MEMBER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'user'], name='unique_gravitas_workspace_member'),
        ]


class StoragePlan(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_storage_plan')
    tier = models.CharField(max_length=40, default='free')
    quota_bytes = models.BigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class NextcloudIdentity(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_nextcloud')
    username = models.CharField(max_length=80, unique=True)
    encrypted_password = models.TextField()
    provisioned_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class ResearchProject(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='projects')
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_projects_owned')
    title = models.CharField(max_length=220)
    description = models.TextField(blank=True)
    archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']


class ProjectMembership(models.Model):
    class Role(models.TextChoices):
        OWNER = 'owner', 'Owner'
        EDITOR = 'editor', 'Editor'
        VIEWER = 'viewer', 'Viewer'

    project = models.ForeignKey(ResearchProject, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_project_memberships')
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.VIEWER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['project', 'user'], name='unique_gravitas_project_member'),
        ]


class Collection(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='collections')
    project = models.ForeignKey(ResearchProject, on_delete=models.CASCADE, related_name='collections', blank=True, null=True)
    parent = models.ForeignKey('self', on_delete=models.CASCADE, related_name='children', blank=True, null=True)
    name = models.CharField(max_length=180)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_collections_created')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'parent', 'name'], name='unique_gravitas_collection_name'),
        ]


class Tag(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='tags')
    name = models.CharField(max_length=80)
    slug = models.SlugField(max_length=90)
    color = models.CharField(max_length=16, default='#7566f6')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'slug'], name='unique_gravitas_tag_slug'),
        ]


class KnowledgeResource(models.Model):
    class Kind(models.TextChoices):
        NOTE = 'note', 'Note'
        FILE = 'file', 'File'
        DATASET = 'dataset', 'Dataset'
        PAPER = 'paper', 'Paper / reference'

    class IngestionStatus(models.TextChoices):
        NOT_QUEUED = 'not_queued', 'Not queued'
        PENDING = 'pending', 'Pending'
        PROCESSING = 'processing', 'Processing'
        READY = 'ready', 'Ready'
        FAILED = 'failed', 'Failed'

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='resources')
    project = models.ForeignKey(ResearchProject, on_delete=models.SET_NULL, related_name='resources', blank=True, null=True)
    collection = models.ForeignKey(Collection, on_delete=models.SET_NULL, related_name='resources', blank=True, null=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_resources_owned')
    kind = models.CharField(max_length=16, choices=Kind.choices, db_index=True)
    title = models.CharField(max_length=240)
    description = models.TextField(blank=True)
    body = models.TextField(blank=True)
    source_url = models.URLField(max_length=1000, blank=True)
    storage_path = models.CharField(max_length=1000, blank=True)
    original_name = models.CharField(max_length=255, blank=True)
    mime_type = models.CharField(max_length=160, blank=True)
    file_size = models.BigIntegerField(default=0)
    checksum = models.CharField(max_length=128, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    ingestion_status = models.CharField(max_length=24, choices=IngestionStatus.choices, default=IngestionStatus.NOT_QUEUED)
    ingestion_error = models.TextField(blank=True)
    tags = models.ManyToManyField(Tag, related_name='resources', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['workspace', 'kind', '-updated_at'], name='grav_resource_recent'),
            models.Index(fields=['workspace', 'project'], name='grav_resource_project'),
        ]


class KnowledgeLink(models.Model):
    source = models.ForeignKey(KnowledgeResource, on_delete=models.CASCADE, related_name='outgoing_links')
    target = models.ForeignKey(KnowledgeResource, on_delete=models.CASCADE, related_name='incoming_links')
    relation = models.CharField(max_length=40, default='related')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['source', 'target', 'relation'], name='unique_gravitas_knowledge_link'),
            models.CheckConstraint(condition=~Q(source=models.F('target')), name='no_self_gravitas_knowledge_link'),
        ]


class KnowledgeActivity(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='activities')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name='gravitas_activities', blank=True, null=True)
    resource = models.ForeignKey(KnowledgeResource, on_delete=models.CASCADE, related_name='activities', blank=True, null=True)
    project = models.ForeignKey(ResearchProject, on_delete=models.CASCADE, related_name='activities', blank=True, null=True)
    action = models.CharField(max_length=40)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
