from django.conf import settings
from django.db import models
from django.utils import timezone


class CommunityProfile(models.Model):
    """Community identity for a registered account.

    Anonymous visitors are Viewers and intentionally have no row here.  The
    role is descriptive/community state; it is never sufficient to authorize
    a layer or an object by itself.
    """

    class Role(models.TextChoices):
        MEMBER = 'member', 'Member'
        LEARNER = 'learner', 'Learner'
        RESEARCHER = 'researcher', 'Researcher'
        TEAM = 'team', 'Gravitas+ Team'

    class Status(models.TextChoices):
        INVITED = 'invited', 'Invited'
        ACTIVE = 'active', 'Active'
        SUSPENDED = 'suspended', 'Suspended'

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_community_profile',
    )
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MEMBER, db_index=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    joined_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['user_id']
        indexes = [models.Index(fields=['role', 'status'], name='grav_community_role_state')]

    def __str__(self):
        return f'{self.user} · {self.role}'


class ModuleGrant(models.Model):
    """Layer-level entitlement, independent from community role.

    Object/project ACLs are still checked after this layer gate.  Core is a
    special case: the Core WorkspaceMembership remains authoritative; a Core
    grant can mirror or explicitly disable that membership but cannot create
    it by itself.
    """

    class Module(models.TextChoices):
        DASHBOARD = 'dashboard', 'Member Dashboard'
        LMS = 'lms', 'LMS'
        RESEARCH = 'research', 'Research Workspace'
        CORE = 'core', 'Core Workspace'

    class AccessLevel(models.TextChoices):
        VIEW = 'view', 'View'
        PARTICIPATE = 'participate', 'Participate'
        EDIT = 'edit', 'Edit'
        MANAGE = 'manage', 'Manage'

    class Source(models.TextChoices):
        SYSTEM = 'system', 'System'
        ADMIN = 'admin', 'Administrator'
        ENROLLMENT = 'enrollment', 'Course enrollment'
        PROJECT = 'project', 'Research project'
        TEAM = 'team', 'Core team membership'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_module_grants',
    )
    module = models.CharField(max_length=20, choices=Module.choices, db_index=True)
    access_level = models.CharField(
        max_length=20,
        choices=AccessLevel.choices,
        default=AccessLevel.PARTICIPATE,
    )
    enabled = models.BooleanField(default=True, db_index=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.ADMIN)
    starts_at = models.DateTimeField(blank=True, null=True)
    expires_at = models.DateTimeField(blank=True, null=True)
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='gravitas_module_grants_created',
        blank=True,
        null=True,
    )
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['user_id', 'module']
        constraints = [
            models.UniqueConstraint(fields=['user', 'module'], name='unique_gravitas_user_module_grant'),
        ]
        indexes = [
            models.Index(fields=['module', 'enabled'], name='grav_module_enabled'),
            models.Index(fields=['user', 'module', 'enabled'], name='grav_user_module_state'),
        ]

    def is_effective(self, at=None):
        at = at or timezone.now()
        if not self.enabled:
            return False
        if self.starts_at and self.starts_at > at:
            return False
        if self.expires_at and self.expires_at <= at:
            return False
        return True

    def __str__(self):
        return f'{self.user} · {self.module} · {self.access_level}'


class ActivityEvent(models.Model):
    """Cross-layer audit/activity stream visible to authorized Core admins."""

    class Layer(models.TextChoices):
        SHELL = 'shell', 'Shell / Showcase'
        DASHBOARD = 'dashboard', 'Member Dashboard'
        LMS = 'lms', 'LMS'
        RESEARCH = 'research', 'Research Workspace'
        CORE = 'core', 'Core Workspace'

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='gravitas_activity_events_authored',
        blank=True,
        null=True,
    )
    subject_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='gravitas_activity_events',
        blank=True,
        null=True,
    )
    layer = models.CharField(max_length=20, choices=Layer.choices, db_index=True)
    action = models.CharField(max_length=100, db_index=True)
    object_type = models.CharField(max_length=100, blank=True)
    object_id = models.CharField(max_length=160, blank=True)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['subject_user', 'layer', '-created_at'], name='grav_activity_subject_layer'),
            models.Index(fields=['layer', 'action', '-created_at'], name='grav_activity_layer_action'),
        ]

    def __str__(self):
        return f'{self.layer} · {self.action} · {self.created_at:%Y-%m-%d %H:%M}'
