from django.conf import settings
from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class TeamMember(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        INVITED = 'invited', 'Invited'
        PAUSED = 'paused', 'Paused'

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='hq_member')
    title = models.CharField(max_length=120, blank=True)
    role_label = models.CharField(max_length=120, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE, db_index=True)

    class Meta:
        ordering = ['user__first_name', 'user__email']

    def __str__(self):
        return self.user.get_full_name() or self.user.email or self.user.username


class SectionAccess(TimeStampedModel):
    class Section(models.TextChoices):
        DASHBOARD = 'dashboard', 'Dashboard'
        STRATEGY = 'strategy', 'Strategy'
        PROJECTS = 'projects', 'Projects & tasks'
        CONTENT = 'content', 'Content Studio'
        RESEARCH = 'research', 'Research & evidence'
        ASSETS = 'assets', 'Assets'
        TEAM = 'team', 'Team & permissions'
        COMMUNITY = 'community', 'Community Ops'
        ANALYTICS = 'analytics', 'Analytics & KPI'

    class Level(models.IntegerChoices):
        NONE = 0, 'No access'
        VIEW = 10, 'View'
        COMMENT = 20, 'Comment'
        EDIT = 30, 'Edit'
        MANAGE = 40, 'Manage'

    member = models.ForeignKey(TeamMember, on_delete=models.CASCADE, related_name='section_access')
    section = models.CharField(max_length=24, choices=Section.choices)
    level = models.PositiveSmallIntegerField(choices=Level.choices, default=Level.VIEW)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['member', 'section'], name='hq_unique_member_section')]
        ordering = ['member_id', 'section']

    def __str__(self):
        return f'{self.member} · {self.section} · {self.get_level_display()}'


class StrategyDocument(TimeStampedModel):
    class Kind(models.TextChoices):
        VISION = 'vision', 'Vision'
        ROADMAP = 'roadmap', 'Roadmap'
        AUDIENCE = 'audience', 'Audience'
        CONTENT = 'content', 'Content thesis'
        PRINCIPLES = 'principles', 'Principles'
        REVENUE = 'revenue', 'Revenue model'
        GOALS = 'goals', 'Goals / OKRs'
        OTHER = 'other', 'Other'

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        ACTIVE = 'active', 'Active'
        ARCHIVED = 'archived', 'Archived'

    title = models.CharField(max_length=220)
    slug = models.SlugField(max_length=180, unique=True)
    kind = models.CharField(max_length=24, choices=Kind.choices, default=Kind.OTHER, db_index=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT, db_index=True)
    summary = models.TextField(blank=True)
    body = models.TextField(blank=True)
    version = models.PositiveIntegerField(default=1)
    owner = models.ForeignKey(TeamMember, on_delete=models.SET_NULL, null=True, blank=True, related_name='strategy_owned')
    updated_by = models.ForeignKey(TeamMember, on_delete=models.SET_NULL, null=True, blank=True, related_name='strategy_updated')

    class Meta:
        ordering = ['kind', 'title']

    def __str__(self):
        return self.title


class Objective(TimeStampedModel):
    class Status(models.TextChoices):
        PLANNED = 'planned', 'Planned'
        ACTIVE = 'active', 'Active'
        AT_RISK = 'at_risk', 'At risk'
        ACHIEVED = 'achieved', 'Achieved'
        PAUSED = 'paused', 'Paused'

    title = models.CharField(max_length=220)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PLANNED, db_index=True)
    owner = models.ForeignKey(TeamMember, on_delete=models.SET_NULL, null=True, blank=True, related_name='objectives')
    strategy_document = models.ForeignKey(StrategyDocument, on_delete=models.SET_NULL, null=True, blank=True, related_name='objectives')
    target_date = models.DateField(null=True, blank=True)
    metric_name = models.CharField(max_length=120, blank=True)
    target_value = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    current_value = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ['target_date', 'title']

    def __str__(self):
        return self.title


class Project(TimeStampedModel):
    class Kind(models.TextChoices):
        CONTENT = 'content', 'Content'
        PRODUCT = 'product', 'Product'
        RESEARCH = 'research', 'Research'
        CAMPAIGN = 'campaign', 'Campaign'
        OPERATIONS = 'operations', 'Operations'
        PARTNERSHIP = 'partnership', 'Partnership'

    class Status(models.TextChoices):
        PLANNED = 'planned', 'Planned'
        ACTIVE = 'active', 'Active'
        BLOCKED = 'blocked', 'Blocked'
        DONE = 'done', 'Done'
        ARCHIVED = 'archived', 'Archived'

    class Priority(models.TextChoices):
        LOW = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH = 'high', 'High'
        URGENT = 'urgent', 'Urgent'

    name = models.CharField(max_length=220)
    slug = models.SlugField(max_length=180, unique=True)
    kind = models.CharField(max_length=24, choices=Kind.choices, default=Kind.CONTENT, db_index=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PLANNED, db_index=True)
    priority = models.CharField(max_length=16, choices=Priority.choices, default=Priority.MEDIUM, db_index=True)
    description = models.TextField(blank=True)
    objective = models.ForeignKey(Objective, on_delete=models.SET_NULL, null=True, blank=True, related_name='projects')
    owner = models.ForeignKey(TeamMember, on_delete=models.SET_NULL, null=True, blank=True, related_name='projects_owned')
    start_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ['status', 'due_date', 'name']

    def __str__(self):
        return self.name


class ProjectMember(TimeStampedModel):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='memberships')
    member = models.ForeignKey(TeamMember, on_delete=models.CASCADE, related_name='project_memberships')
    role = models.CharField(max_length=120, blank=True)
    can_manage_tasks = models.BooleanField(default=False)
    can_approve = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['project', 'member'], name='hq_unique_project_member')]
        ordering = ['project_id', 'member_id']

    def __str__(self):
        return f'{self.project} · {self.member}'


class Milestone(TimeStampedModel):
    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        DONE = 'done', 'Done'

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='milestones')
    title = models.CharField(max_length=220)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.OPEN)
    due_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ['due_date', 'title']

    def __str__(self):
        return f'{self.project} · {self.title}'


class Task(TimeStampedModel):
    class Status(models.TextChoices):
        BACKLOG = 'backlog', 'Backlog'
        TODO = 'todo', 'To do'
        IN_PROGRESS = 'in_progress', 'In progress'
        REVIEW = 'review', 'Review'
        BLOCKED = 'blocked', 'Blocked'
        DONE = 'done', 'Done'

    class Priority(models.TextChoices):
        LOW = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH = 'high', 'High'
        URGENT = 'urgent', 'Urgent'

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='tasks')
    milestone = models.ForeignKey(Milestone, on_delete=models.SET_NULL, null=True, blank=True, related_name='tasks')
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='subtasks')
    title = models.CharField(max_length=240)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TODO, db_index=True)
    priority = models.CharField(max_length=16, choices=Priority.choices, default=Priority.MEDIUM, db_index=True)
    assignee = models.ForeignKey(TeamMember, on_delete=models.SET_NULL, null=True, blank=True, related_name='tasks')
    due_at = models.DateTimeField(null=True, blank=True)
    estimate_minutes = models.PositiveIntegerField(null=True, blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    dependencies = models.ManyToManyField('self', symmetrical=False, blank=True, related_name='dependents')

    class Meta:
        ordering = ['sort_order', 'due_at', 'created_at']

    def __str__(self):
        return self.title


class ContentProduction(TimeStampedModel):
    class Stage(models.TextChoices):
        IDEA = 'idea', 'Idea'
        TOPIC_SCORE = 'topic_score', 'Topic score'
        BRIEF = 'brief', 'Brief'
        EVIDENCE = 'evidence', 'Evidence map'
        SCRIPT = 'script', 'Script'
        SCIENTIFIC_REVIEW = 'scientific_review', 'Scientific review'
        PRODUCTION = 'production', 'Production'
        COMPANION = 'companion', 'Companion page'
        DISTRIBUTION = 'distribution', 'Distribution'
        POSTMORTEM = 'postmortem', 'Post-mortem'
        DONE = 'done', 'Done'

    project = models.OneToOneField(Project, on_delete=models.CASCADE, related_name='content_production')
    public_content = models.ForeignKey('core.ContentItem', on_delete=models.SET_NULL, null=True, blank=True, related_name='hq_productions')
    working_title = models.CharField(max_length=240)
    central_question = models.TextField(blank=True)
    stage = models.CharField(max_length=32, choices=Stage.choices, default=Stage.IDEA, db_index=True)
    topic_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    brief = models.TextField(blank=True)
    script = models.TextField(blank=True)
    scientific_notes = models.TextField(blank=True)
    distribution_notes = models.TextField(blank=True)
    postmortem = models.TextField(blank=True)
    planned_publish_at = models.DateTimeField(null=True, blank=True)
    youtube_url = models.URLField(blank=True)

    class Meta:
        ordering = ['planned_publish_at', 'working_title']

    def __str__(self):
        return self.working_title


class EvidenceSource(TimeStampedModel):
    class Kind(models.TextChoices):
        PAPER = 'paper', 'Paper'
        DATASET = 'dataset', 'Dataset'
        BOOK = 'book', 'Book'
        ARTICLE = 'article', 'Article / report'
        INTERVIEW = 'interview', 'Interview'
        VIDEO = 'video', 'Video'
        OTHER = 'other', 'Other'

    title = models.CharField(max_length=300)
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.PAPER, db_index=True)
    url = models.URLField(blank=True)
    doi = models.CharField(max_length=180, blank=True)
    authors = models.CharField(max_length=400, blank=True)
    publisher = models.CharField(max_length=220, blank=True)
    published_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    added_by = models.ForeignKey(TeamMember, on_delete=models.SET_NULL, null=True, blank=True, related_name='sources_added')

    class Meta:
        ordering = ['-published_date', 'title']

    def __str__(self):
        return self.title


class Claim(TimeStampedModel):
    class Confidence(models.TextChoices):
        LOW = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH = 'high', 'High'

    production = models.ForeignKey(ContentProduction, on_delete=models.CASCADE, related_name='claims')
    statement = models.TextField()
    confidence = models.CharField(max_length=12, choices=Confidence.choices, default=Confidence.MEDIUM)
    notes = models.TextField(blank=True)
    owner = models.ForeignKey(TeamMember, on_delete=models.SET_NULL, null=True, blank=True, related_name='claims_owned')

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return self.statement[:120]


class ClaimEvidence(TimeStampedModel):
    class Stance(models.TextChoices):
        SUPPORTS = 'supports', 'Supports'
        CHALLENGES = 'challenges', 'Challenges'
        CONTEXT = 'context', 'Context'

    claim = models.ForeignKey(Claim, on_delete=models.CASCADE, related_name='evidence_links')
    source = models.ForeignKey(EvidenceSource, on_delete=models.CASCADE, related_name='claim_links')
    stance = models.CharField(max_length=16, choices=Stance.choices, default=Stance.SUPPORTS)
    locator = models.CharField(max_length=240, blank=True, help_text='Page, figure, timestamp, section, etc.')
    note = models.TextField(blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['claim', 'source', 'stance'], name='hq_unique_claim_source_stance')]
        ordering = ['claim_id', 'source_id']

    def __str__(self):
        return f'{self.claim_id} · {self.stance} · {self.source}'


class AssetReference(TimeStampedModel):
    class AssetType(models.TextChoices):
        VIDEO = 'video', 'Video'
        AUDIO = 'audio', 'Audio'
        IMAGE = 'image', 'Image'
        DESIGN = 'design', 'Design file'
        DOCUMENT = 'document', 'Document'
        DATASET = 'dataset', 'Dataset'
        OTHER = 'other', 'Other'

    class Provider(models.TextChoices):
        NEXTCLOUD = 'nextcloud', 'Nextcloud'
        YOUTUBE = 'youtube', 'YouTube'
        GOOGLE_DRIVE = 'google_drive', 'Google Drive'
        FRAME_IO = 'frame_io', 'Frame.io'
        VIMEO = 'vimeo', 'Vimeo'
        CLOUDFLARE_R2 = 'cloudflare_r2', 'Cloudflare R2'
        S3 = 's3', 'S3 compatible'
        EXTERNAL = 'external', 'External URL'

    class Status(models.TextChoices):
        WORKING = 'working', 'Working'
        REVIEW = 'review', 'Review'
        APPROVED = 'approved', 'Approved'
        FINAL = 'final', 'Final'
        ARCHIVED = 'archived', 'Archived'

    title = models.CharField(max_length=240)
    asset_type = models.CharField(max_length=20, choices=AssetType.choices, default=AssetType.OTHER, db_index=True)
    provider = models.CharField(max_length=24, choices=Provider.choices, default=Provider.NEXTCLOUD, db_index=True)
    url = models.URLField(max_length=1200)
    external_id = models.CharField(max_length=240, blank=True)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, null=True, blank=True, related_name='assets')
    production = models.ForeignKey(ContentProduction, on_delete=models.CASCADE, null=True, blank=True, related_name='assets')
    version = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.WORKING, db_index=True)
    size_bytes = models.BigIntegerField(null=True, blank=True, help_text='Metadata only; binary is stored externally.')
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(TeamMember, on_delete=models.SET_NULL, null=True, blank=True, related_name='assets_added')

    class Meta:
        ordering = ['-updated_at', 'title']

    def __str__(self):
        return self.title
