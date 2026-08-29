import uuid

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models
from django.db.models import Q


class WorkspaceProfile(models.Model):
    class Purpose(models.TextChoices):
        PERSONAL = 'personal', 'Personal'
        CORE = 'core', 'Core operations'
        RESEARCH = 'research', 'Scientific research'

    workspace = models.OneToOneField('core.Workspace', on_delete=models.CASCADE, related_name='platform_profile')
    purpose = models.CharField(max_length=16, choices=Purpose.choices, default=Purpose.PERSONAL, db_index=True)
    description = models.TextField(blank=True)
    is_default = models.BooleanField(default=False)
    nextcloud_root = models.CharField(max_length=500, default='Gravitas')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['purpose', 'workspace_id']


class ResearchProjectProfile(models.Model):
    class Category(models.TextChoices):
        INTERNAL = 'internal', 'Internal research'
        CLIENT = 'client', 'Client / revenue research'
        COMMUNITY = 'community', 'Community research'

    class Visibility(models.TextChoices):
        PRIVATE = 'private', 'Private'
        INVITE = 'invite', 'Invite only'
        COMMUNITY = 'community', 'Community'
        PUBLIC = 'public', 'Public'

    class Status(models.TextChoices):
        INTAKE = 'intake', 'Intake'
        ACTIVE = 'active', 'Active'
        REVIEW = 'review', 'Review'
        DELIVERED = 'delivered', 'Delivered'
        ON_HOLD = 'on_hold', 'On hold'
        CLOSED = 'closed', 'Closed'

    class Confidentiality(models.TextChoices):
        INTERNAL = 'internal', 'Internal'
        CONFIDENTIAL = 'confidential', 'Confidential'
        RESTRICTED = 'restricted', 'Restricted data room'
        PUBLIC = 'public', 'Public'

    project = models.OneToOneField('core.ResearchProject', on_delete=models.CASCADE, related_name='platform_profile')
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.INTERNAL, db_index=True)
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.PRIVATE, db_index=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.INTAKE, db_index=True)
    research_question = models.TextField(blank=True)
    client_name = models.CharField(max_length=220, blank=True)
    requester_name = models.CharField(max_length=220, blank=True)
    requester_email = models.EmailField(blank=True)
    confidentiality = models.CharField(max_length=20, choices=Confidentiality.choices, default=Confidentiality.INTERNAL)
    deadline = models.DateField(blank=True, null=True)
    budget = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)
    currency = models.CharField(max_length=8, default='EUR')
    compensation_text = models.CharField(max_length=240, blank=True)
    required_skills = models.JSONField(default=list, blank=True)
    application_open = models.BooleanField(default=False)
    public_slug = models.SlugField(max_length=220, unique=True, blank=True, null=True)
    nextcloud_root = models.CharField(max_length=700, blank=True)
    secure_data_room = models.BooleanField(default=False)
    allow_public_links = models.BooleanField(default=False)
    allow_downloads = models.BooleanField(default=True)
    external_access_expires_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['category', 'status'], name='grav_project_category_status'),
            models.Index(fields=['visibility', 'application_open'], name='grav_project_public_open'),
        ]


class ResearcherProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_researcher_profile')
    headline = models.CharField(max_length=240, blank=True)
    bio = models.TextField(blank=True)
    fields = models.JSONField(default=list, blank=True)
    skills = models.JSONField(default=list, blank=True)
    institution = models.CharField(max_length=240, blank=True)
    orcid = models.CharField(max_length=40, blank=True)
    google_scholar_url = models.URLField(max_length=1000, blank=True)
    github_url = models.URLField(max_length=1000, blank=True)
    languages = models.JSONField(default=list, blank=True)
    availability = models.CharField(max_length=120, blank=True)
    is_public = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['user_id']


class ContentWorkItem(models.Model):
    class Kind(models.TextChoices):
        VIDEO = 'video', 'Video'
        ARTICLE = 'article', 'Article'
        REEL = 'reel', 'Short / Reel'
        PODCAST = 'podcast', 'Podcast'
        DESIGN = 'design', 'Design'
        OTHER = 'other', 'Other'

    class Status(models.TextChoices):
        IDEA = 'idea', 'Idea'
        SELECTED = 'selected', 'Selected'
        RESEARCH = 'research', 'Research'
        BRIEF = 'brief', 'Brief'
        SCRIPT = 'script', 'Script'
        SCIENTIFIC_REVIEW = 'scientific_review', 'Scientific review'
        PRODUCTION = 'production', 'Production'
        EDIT = 'edit', 'Edit'
        QA = 'qa', 'QA'
        PUBLISHED = 'published', 'Published'
        ARCHIVED = 'archived', 'Archived'

    workspace = models.ForeignKey('core.Workspace', on_delete=models.CASCADE, related_name='content_work_items')
    title = models.CharField(max_length=240)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.VIDEO, db_index=True)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.IDEA, db_index=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name='gravitas_content_work_owned', blank=True, null=True)
    description = models.TextField(blank=True)
    due_date = models.DateField(blank=True, null=True)
    linked_content = models.ForeignKey('core.ContentItem', on_delete=models.SET_NULL, related_name='operating_work_items', blank=True, null=True)
    research_project = models.ForeignKey('core.ResearchProject', on_delete=models.SET_NULL, related_name='content_work_items', blank=True, null=True)
    published_url = models.URLField(max_length=1000, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='gravitas_content_work_created')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['status', 'due_date', '-updated_at']
        indexes = [models.Index(fields=['workspace', 'status', 'kind'], name='grav_content_pipeline')]


class ResearchRequest(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        OPEN = 'open', 'Open'
        IN_PROGRESS = 'in_progress', 'In progress'
        REVIEW = 'review', 'Review'
        DONE = 'done', 'Done'
        CANCELLED = 'cancelled', 'Cancelled'

    workspace = models.ForeignKey('core.Workspace', on_delete=models.CASCADE, related_name='research_requests')
    project = models.ForeignKey('core.ResearchProject', on_delete=models.SET_NULL, related_name='research_requests', blank=True, null=True)
    content_work_item = models.ForeignKey(ContentWorkItem, on_delete=models.SET_NULL, related_name='research_requests', blank=True, null=True)
    source_content = models.ForeignKey('core.ContentItem', on_delete=models.SET_NULL, related_name='research_requests', blank=True, null=True)
    source_task = models.ForeignKey('core.OperatingTask', on_delete=models.SET_NULL, related_name='research_requests', blank=True, null=True)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='gravitas_research_requests_created')
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name='gravitas_research_requests_assigned', blank=True, null=True)
    title = models.CharField(max_length=240)
    brief = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN, db_index=True)
    priority = models.CharField(max_length=8, default='p2')
    due_date = models.DateField(blank=True, null=True)
    output_summary = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['priority', 'due_date', '-updated_at']
        indexes = [models.Index(fields=['workspace', 'status'], name='grav_research_request_state')]


class ProjectApplication(models.Model):
    class Status(models.TextChoices):
        SUBMITTED = 'submitted', 'Submitted'
        SHORTLISTED = 'shortlisted', 'Shortlisted'
        ACCEPTED = 'accepted', 'Accepted'
        REJECTED = 'rejected', 'Rejected'
        WITHDRAWN = 'withdrawn', 'Withdrawn'

    project = models.ForeignKey('core.ResearchProject', on_delete=models.CASCADE, related_name='applications')
    applicant_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name='gravitas_project_applications', blank=True, null=True)
    applicant_name = models.CharField(max_length=220)
    applicant_email = models.EmailField()
    message = models.TextField(blank=True)
    skills = models.JSONField(default=list, blank=True)
    profile_url = models.URLField(max_length=1000, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUBMITTED, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['project', 'applicant_user'],
                condition=Q(applicant_user__isnull=False),
                name='unique_gravitas_user_application',
            ),
        ]


class ProjectDeliverable(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        REVIEW = 'review', 'Review'
        APPROVED = 'approved', 'Approved'
        DELIVERED = 'delivered', 'Delivered'

    project = models.ForeignKey('core.ResearchProject', on_delete=models.CASCADE, related_name='deliverables')
    resource = models.ForeignKey('core.KnowledgeResource', on_delete=models.SET_NULL, related_name='deliverables', blank=True, null=True)
    title = models.CharField(max_length=240)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    client_visible = models.BooleanField(default=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='gravitas_deliverables_created')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['status', '-updated_at']


class MindMap(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.CASCADE, related_name='mind_maps')
    project = models.ForeignKey('core.ResearchProject', on_delete=models.SET_NULL, related_name='mind_maps', blank=True, null=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_mind_maps_owned')
    title = models.CharField(max_length=240)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']


class MindMapNode(models.Model):
    class Kind(models.TextChoices):
        CONCEPT = 'concept', 'Concept'
        QUESTION = 'question', 'Question'
        HYPOTHESIS = 'hypothesis', 'Hypothesis'
        NOTE = 'note', 'Note'
        PAPER = 'paper', 'Paper'
        DATASET = 'dataset', 'Dataset'
        TASK = 'task', 'Task'
        OTHER = 'other', 'Other'

    mind_map = models.ForeignKey(MindMap, on_delete=models.CASCADE, related_name='nodes')
    key = models.CharField(max_length=80)
    title = models.CharField(max_length=240)
    body = models.TextField(blank=True)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.CONCEPT)
    linked_content_type = models.ForeignKey(ContentType, on_delete=models.SET_NULL, related_name='+', blank=True, null=True)
    linked_object_id = models.PositiveBigIntegerField(blank=True, null=True)
    linked_object = GenericForeignKey('linked_content_type', 'linked_object_id')
    x = models.FloatField(default=0)
    y = models.FloatField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']
        constraints = [models.UniqueConstraint(fields=['mind_map', 'key'], name='unique_gravitas_mindmap_node_key')]


class MindMapEdge(models.Model):
    mind_map = models.ForeignKey(MindMap, on_delete=models.CASCADE, related_name='edges')
    source = models.ForeignKey(MindMapNode, on_delete=models.CASCADE, related_name='outgoing_edges')
    target = models.ForeignKey(MindMapNode, on_delete=models.CASCADE, related_name='incoming_edges')
    relation = models.CharField(max_length=60, default='related')
    label = models.CharField(max_length=160, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['id']
        constraints = [
            models.UniqueConstraint(fields=['source', 'target', 'relation'], name='unique_gravitas_mindmap_edge'),
            models.CheckConstraint(condition=~Q(source=models.F('target')), name='no_gravitas_mindmap_self_edge'),
        ]


class ObjectPolicy(models.Model):
    class Visibility(models.TextChoices):
        PRIVATE = 'private', 'Private'
        WORKSPACE = 'workspace', 'Workspace'
        PROJECT = 'project', 'Project'
        SPECIFIC = 'specific', 'Specific people'
        LINK = 'link', 'Anyone with link'
        PUBLIC = 'public', 'Public'

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveBigIntegerField()
    content_object = GenericForeignKey('content_type', 'object_id')
    visibility = models.CharField(max_length=20, choices=Visibility.choices, default=Visibility.WORKSPACE, db_index=True)
    allow_download = models.BooleanField(default=True)
    allow_reshare = models.BooleanField(default=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name='gravitas_object_policies_created', blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['content_type', 'object_id'], name='unique_gravitas_object_policy')]
        indexes = [models.Index(fields=['content_type', 'object_id'], name='grav_policy_object')]


class AccessGrant(models.Model):
    class Role(models.TextChoices):
        VIEW = 'view', 'View'
        COMMENT = 'comment', 'Comment'
        EDIT = 'edit', 'Edit'
        MANAGE = 'manage', 'Manage'

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveBigIntegerField()
    content_object = GenericForeignKey('content_type', 'object_id')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_access_grants')
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.VIEW)
    granted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name='gravitas_access_grants_created', blank=True, null=True)
    expires_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['content_type', 'object_id', 'user'], name='unique_gravitas_object_user_grant')]
        indexes = [models.Index(fields=['user', 'content_type', 'object_id'], name='grav_access_user_object')]


class ShareLink(models.Model):
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveBigIntegerField()
    content_object = GenericForeignKey('content_type', 'object_id')
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    role = models.CharField(max_length=16, choices=AccessGrant.Role.choices, default=AccessGrant.Role.VIEW)
    allow_download = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    expires_at = models.DateTimeField(blank=True, null=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_share_links_created')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['content_type', 'object_id', 'active'], name='grav_share_object_active')]


class AccessRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        DENIED = 'denied', 'Denied'

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveBigIntegerField()
    content_object = GenericForeignKey('content_type', 'object_id')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='gravitas_access_requests')
    message = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ['-created_at']


class EntityLink(models.Model):
    source_content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE, related_name='+')
    source_object_id = models.PositiveBigIntegerField()
    source_object = GenericForeignKey('source_content_type', 'source_object_id')
    target_content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE, related_name='+')
    target_object_id = models.PositiveBigIntegerField()
    target_object = GenericForeignKey('target_content_type', 'target_object_id')
    relation = models.CharField(max_length=80, default='related')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name='gravitas_entity_links_created', blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['source_content_type', 'source_object_id', 'target_content_type', 'target_object_id', 'relation'],
                name='unique_gravitas_entity_link',
            ),
        ]
        indexes = [
            models.Index(fields=['source_content_type', 'source_object_id'], name='grav_entity_source'),
            models.Index(fields=['target_content_type', 'target_object_id'], name='grav_entity_target'),
        ]


class ProjectAuditEvent(models.Model):
    project = models.ForeignKey('core.ResearchProject', on_delete=models.CASCADE, related_name='audit_events')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name='gravitas_project_audit_events', blank=True, null=True)
    action = models.CharField(max_length=80)
    object_type = models.CharField(max_length=80, blank=True)
    object_id = models.CharField(max_length=120, blank=True)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['project', '-created_at'], name='grav_project_audit_recent')]
