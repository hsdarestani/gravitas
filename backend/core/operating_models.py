from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


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
    board_order = models.PositiveIntegerField(default=0, db_index=True)
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



class GoogleCalendarConnection(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_google_calendar',
    )
    google_email = models.EmailField(blank=True)
    refresh_token_encrypted = models.TextField()
    calendar_id = models.CharField(max_length=255, default='primary')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class GoogleCalendarEventLink(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_google_calendar_events',
    )
    meeting = models.ForeignKey(
        OperatingMeeting,
        on_delete=models.CASCADE,
        related_name='google_calendar_links',
    )
    calendar_id = models.CharField(max_length=255, default='primary')
    event_id = models.CharField(max_length=1024)
    html_link = models.URLField(max_length=1600, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'meeting'],
                name='unique_google_calendar_meeting_user',
            ),
        ]


class GoogleTaskLink(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_google_task_links',
    )
    task = models.ForeignKey(
        OperatingTask,
        on_delete=models.CASCADE,
        related_name='google_task_links',
    )
    tasklist_id = models.CharField(max_length=255, default='@default')
    google_task_id = models.CharField(max_length=1024)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'task'],
                name='unique_google_task_user',
            ),
        ]


class GoogleCalendarMeetingMinute(models.Model):
    workspace = models.ForeignKey(
        'core.Workspace',
        on_delete=models.CASCADE,
        related_name='google_calendar_meeting_minutes',
    )
    ical_uid = models.CharField(max_length=1024)
    google_event_id = models.CharField(max_length=1024, blank=True)
    title = models.CharField(max_length=500, blank=True)
    start_at = models.DateTimeField(blank=True, null=True)
    end_at = models.DateTimeField(blank=True, null=True)
    notes = models.TextField(blank=True)
    reference_url = models.URLField(max_length=1600, blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='gravitas_meeting_minutes_updated',
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-start_at', '-updated_at']
        constraints = [
            models.UniqueConstraint(
                fields=['workspace', 'ical_uid'],
                name='unique_google_calendar_minute_workspace_uid',
            ),
        ]


class GoogleCalendarMeetingAttachment(models.Model):
    minute = models.ForeignKey(
        GoogleCalendarMeetingMinute,
        on_delete=models.CASCADE,
        related_name='attachments',
    )
    uploader = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='gravitas_meeting_minute_attachments',
    )
    name = models.CharField(max_length=255)
    storage_path = models.CharField(max_length=1000)
    mime_type = models.CharField(max_length=160, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']


class OperatingTaskChecklistItem(models.Model):
    task = models.ForeignKey(OperatingTask, on_delete=models.CASCADE, related_name='checklist_items')
    title = models.CharField(max_length=500)
    is_completed = models.BooleanField(default=False, db_index=True)
    position = models.PositiveIntegerField(default=0, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='gravitas_operating_task_checklist_items',
    )
    completed_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['position', 'id']
        indexes = [
            models.Index(
                fields=['task', 'is_completed', 'position'],
                name='grav_check_task_done_pos',
            ),
        ]


class TaskNotificationPreference(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_task_notification_preference',
    )
    email_enabled = models.BooleanField(default=True)
    telegram_enabled = models.BooleanField(default=True)
    task_changes_enabled = models.BooleanField(default=True)
    due_reminders_enabled = models.BooleanField(default=True)
    telegram_chat_id = models.BigIntegerField(blank=True, null=True, unique=True)
    telegram_username = models.CharField(max_length=64, blank=True)
    telegram_link_code = models.CharField(max_length=64, blank=True, unique=True, null=True)
    telegram_link_expires_at = models.DateTimeField(blank=True, null=True)
    telegram_connected_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class TaskNotificationOutbox(models.Model):
    class Channel(models.TextChoices):
        EMAIL = 'email', 'Email'
        TELEGRAM = 'telegram', 'Telegram'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        SENT = 'sent', 'Sent'
        FAILED = 'failed', 'Failed'

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_task_notification_outbox',
    )
    task = models.ForeignKey(
        OperatingTask,
        on_delete=models.SET_NULL,
        related_name='notification_outbox',
        blank=True,
        null=True,
    )
    channel = models.CharField(max_length=16, choices=Channel.choices)
    event_key = models.CharField(max_length=120)
    event_type = models.CharField(max_length=80)
    subject = models.CharField(max_length=300)
    body = models.TextField()
    payload = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING, db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    available_at = models.DateTimeField(default=timezone.now, db_index=True)
    sent_at = models.DateTimeField(blank=True, null=True)
    last_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['recipient', 'channel', 'event_key'],
                name='unique_task_notification_delivery',
            ),
        ]
        indexes = [
            models.Index(
                fields=['status', 'available_at', 'created_at'],
                name='grav_task_notif_queue',
            ),
        ]


class OperatingTaskComment(models.Model):
    task = models.ForeignKey(OperatingTask, on_delete=models.CASCADE, related_name='board_comments')
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='gravitas_operating_task_comments',
    )
    body = models.TextField(max_length=10000)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at', 'id']


class OperatingTaskAttachment(models.Model):
    task = models.ForeignKey(OperatingTask, on_delete=models.CASCADE, related_name='board_attachments')
    uploader = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='gravitas_operating_task_attachments',
    )
    name = models.CharField(max_length=255)
    storage_path = models.CharField(max_length=1000)
    mime_type = models.CharField(max_length=160, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']
