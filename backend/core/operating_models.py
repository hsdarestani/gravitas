from django.conf import settings
from django.db import models
from django.db.models import Q


class Health(models.TextChoices):
    GREEN = 'green', 'Green'
    YELLOW = 'yellow', 'Yellow'
    RED = 'red', 'Red'


class WorkStatus(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    ACTIVE = 'active', 'Active'
    BLOCKED = 'blocked', 'Blocked'
    DONE = 'done', 'Done'
    ARCHIVED = 'archived', 'Archived'


class Priority(models.TextChoices):
    P0 = 'p0', 'P0 · Critical'
    P1 = 'p1', 'P1 · High'
    P2 = 'p2', 'P2 · Normal'
    P3 = 'p3', 'P3 · Low'


class OperatingProcess(models.Model):
    class Key(models.TextChoices):
        CONTENT = 'content', 'Media & Content'
        RESEARCH = 'research', 'Scientific Research'
        COMMERCIAL = 'commercial', 'Commercial Scientific Projects'
        TECHNOLOGY = 'technology', 'Technology & Infrastructure'
        OPERATIONS = 'operations', 'Operations / Management'

    workspace = models.ForeignKey('core.Workspace', on_delete=models.CASCADE, related_name='operating_processes')
    key = models.CharField(max_length=24, choices=Key.choices)
    name = models.CharField(max_length=180)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name='gravitas_processes_owned', blank=True, null=True)
    flow = models.JSONField(default=list, blank=True)
    cadence = models.JSONField(default=list, blank=True)
    kpis = models.JSONField(default=list, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']
        constraints = [models.UniqueConstraint(fields=['workspace', 'key'], name='unique_operating_process_key')]


class StrategicObjective(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.CASCADE, related_name='strategic_objectives')
    title = models.CharField(max_length=240)
    description = models.TextField(blank=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='gravitas_objectives_owned')
    quarter = models.CharField(max_length=32, blank=True)
    start_date = models.DateField(blank=True, null=True)
    due_date = models.DateField(blank=True, null=True)
    health = models.CharField(max_length=12, choices=Health.choices, default=Health.GREEN)
    status = models.CharField(max_length=16, choices=WorkStatus.choices, default=WorkStatus.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']


class KeyResult(models.Model):
    objective = models.ForeignKey(StrategicObjective, on_delete=models.CASCADE, related_name='key_results')
    title = models.CharField(max_length=240)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='gravitas_key_results_owned')
    metric_name = models.CharField(max_length=120, blank=True)
    unit = models.CharField(max_length=32, blank=True)
    baseline_value = models.DecimalField(max_digits=16, decimal_places=4, blank=True, null=True)
    target_value = models.DecimalField(max_digits=16, decimal_places=4, blank=True, null=True)
    current_value = models.DecimalField(max_digits=16, decimal_places=4, blank=True, null=True)
    confidence = models.PositiveSmallIntegerField(default=100)
    due_date = models.DateField(blank=True, null=True)
    health = models.CharField(max_length=12, choices=Health.choices, default=Health.GREEN)
    status = models.CharField(max_length=16, choices=WorkStatus.choices, default=WorkStatus.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['objective_id', 'id']


class Initiative(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.CASCADE, related_name='initiatives')
    key_result = models.ForeignKey(KeyResult, on_delete=models.CASCADE, related_name='initiatives')
    process = models.ForeignKey(OperatingProcess, on_delete=models.PROTECT, related_name='initiatives')
    title = models.CharField(max_length=240)
    description = models.TextField(blank=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='gravitas_initiatives_owned')
    priority = models.CharField(max_length=8, choices=Priority.choices, default=Priority.P2)
    stage = models.CharField(max_length=80, blank=True)
    health = models.CharField(max_length=12, choices=Health.choices, default=Health.GREEN)
    status = models.CharField(max_length=16, choices=WorkStatus.choices, default=WorkStatus.ACTIVE)
    start_date = models.DateField(blank=True, null=True)
    due_date = models.DateField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['priority', '-updated_at']


class OperatingCycle(models.Model):
    class Cadence(models.TextChoices):
        WEEKLY = 'weekly', 'Weekly'
        BIWEEKLY = 'biweekly', 'Biweekly'
        MONTHLY = 'monthly', 'Monthly'
        QUARTERLY = 'quarterly', 'Quarterly'
        AD_HOC = 'ad_hoc', 'Ad hoc'

    workspace = models.ForeignKey('core.Workspace', on_delete=models.CASCADE, related_name='operating_cycles')
    process = models.ForeignKey(OperatingProcess, on_delete=models.PROTECT, related_name='cycles')
    name = models.CharField(max_length=180)
    cadence = models.CharField(max_length=16, choices=Cadence.choices)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='gravitas_cycles_owned')
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=16, choices=WorkStatus.choices, default=WorkStatus.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-start_date']


class OperatingMilestone(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.CASCADE, related_name='operating_milestones')
    initiative = models.ForeignKey(Initiative, on_delete=models.CASCADE, related_name='milestones')
    cycle = models.ForeignKey(OperatingCycle, on_delete=models.SET_NULL, related_name='milestones', blank=True, null=True)
    project = models.ForeignKey('core.ResearchProject', on_delete=models.SET_NULL, related_name='operating_milestones', blank=True, null=True)
    title = models.CharField(max_length=220)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='gravitas_milestones_owned')
    due_date = models.DateField(blank=True, null=True)
    definition_of_done = models.TextField(blank=True)
    health = models.CharField(max_length=12, choices=Health.choices, default=Health.GREEN)
    status = models.CharField(max_length=16, choices=WorkStatus.choices, default=WorkStatus.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['due_date', 'id']


class OperatingWorkPackage(models.Model):
    """Commercial-project execution level explicitly defined by the Operating Model."""
    workspace = models.ForeignKey('core.Workspace', on_delete=models.CASCADE, related_name='operating_work_packages')
    milestone = models.ForeignKey(OperatingMilestone, on_delete=models.CASCADE, related_name='work_packages')
    project = models.ForeignKey('core.ResearchProject', on_delete=models.SET_NULL, related_name='operating_work_packages', blank=True, null=True)
    title = models.CharField(max_length=220)
    description = models.TextField(blank=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='gravitas_work_packages_owned')
    due_date = models.DateField(blank=True, null=True)
    definition_of_done = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=WorkStatus.choices, default=WorkStatus.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['due_date', 'id']


class OperatingMeeting(models.Model):
    class Kind(models.TextChoices):
        WEEKLY = 'weekly_gravitas', 'Gravitas Weekly'
        EDITORIAL = 'content_editorial', 'Content Editorial'
        ACTIVE_PROJECT = 'active_project_review', 'Active Project Review'
        SCIENTIFIC = 'scientific_review', 'Scientific Review'
        TECH = 'tech_sprint', 'Tech Sprint Planning / Review'
        MONTHLY = 'monthly_operating_review', 'Monthly Operating Review'
        OKR_PLANNING = 'okr_planning', 'Strategy & OKR Planning'
        OKR_REVIEW = 'okr_review', 'OKR Review & Retrospective'
        CLIENT = 'client_project_review', 'Client / Project Review'

    workspace = models.ForeignKey('core.Workspace', on_delete=models.CASCADE, related_name='operating_meetings')
    process = models.ForeignKey(OperatingProcess, on_delete=models.SET_NULL, related_name='meetings', blank=True, null=True)
    kind = models.CharField(max_length=36, choices=Kind.choices)
    title = models.CharField(max_length=220)
    scheduled_for = models.DateTimeField()
    duration_minutes = models.PositiveIntegerField(default=60)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='gravitas_meetings_owned')
    decisions = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=WorkStatus.choices, default=WorkStatus.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['scheduled_for']


class OperatingRisk(models.Model):
    """Minimal risk register for the Operations / Management control loop."""
    workspace = models.ForeignKey('core.Workspace', on_delete=models.CASCADE, related_name='operating_risks')
    initiative = models.ForeignKey(Initiative, on_delete=models.SET_NULL, related_name='risks', blank=True, null=True)
    project = models.ForeignKey('core.ResearchProject', on_delete=models.SET_NULL, related_name='operating_risks', blank=True, null=True)
    title = models.CharField(max_length=220)
    description = models.TextField(blank=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='gravitas_risks_owned')
    mitigation = models.TextField(blank=True)
    due_date = models.DateField(blank=True, null=True)
    health = models.CharField(max_length=12, choices=Health.choices, default=Health.YELLOW)
    status = models.CharField(max_length=16, choices=WorkStatus.choices, default=WorkStatus.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['health', 'due_date', '-updated_at']


class OperatingTask(models.Model):
    workspace = models.ForeignKey('core.Workspace', on_delete=models.CASCADE, related_name='operating_tasks')
    initiative = models.ForeignKey(Initiative, on_delete=models.CASCADE, related_name='tasks')
    milestone = models.ForeignKey(OperatingMilestone, on_delete=models.SET_NULL, related_name='tasks', blank=True, null=True)
    work_package = models.ForeignKey(OperatingWorkPackage, on_delete=models.SET_NULL, related_name='tasks', blank=True, null=True)
    cycle = models.ForeignKey(OperatingCycle, on_delete=models.SET_NULL, related_name='tasks', blank=True, null=True)
    project = models.ForeignKey('core.ResearchProject', on_delete=models.SET_NULL, related_name='operating_tasks', blank=True, null=True)
    meeting = models.ForeignKey(OperatingMeeting, on_delete=models.SET_NULL, related_name='action_items', blank=True, null=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='gravitas_tasks_owned')
    title = models.CharField(max_length=240)
    description = models.TextField(blank=True)
    priority = models.CharField(max_length=8, choices=Priority.choices, default=Priority.P2)
    status = models.CharField(max_length=16, choices=WorkStatus.choices, default=WorkStatus.ACTIVE)
    due_date = models.DateField(blank=True, null=True)
    definition_of_done = models.TextField()
    dependency = models.ForeignKey('self', on_delete=models.SET_NULL, related_name='dependants', blank=True, null=True)
    blocked_reason = models.TextField(blank=True)
    completed_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['priority', 'due_date', '-updated_at']
        indexes = [
            models.Index(fields=['workspace', 'status', 'priority'], name='grav_task_status_priority'),
            models.Index(fields=['workspace', 'owner', 'status'], name='grav_task_owner_status'),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(cycle__isnull=False) | Q(due_date__isnull=False),
                name='grav_task_cycle_or_due',
            ),
            models.CheckConstraint(
                condition=Q(meeting__isnull=True) | Q(due_date__isnull=False),
                name='grav_meeting_action_due',
            ),
        ]
