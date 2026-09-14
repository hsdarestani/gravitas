import uuid

from django.conf import settings
from django.db import models


class Course(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'
        ARCHIVED = 'archived', 'Archived'

    class AccessType(models.TextChoices):
        OPEN = 'open', 'Open enrollment'
        LOCKED = 'locked', 'Locked / invite only'
        PAID = 'paid', 'Paid'

    slug = models.SlugField(max_length=190, unique=True)
    title = models.CharField(max_length=240)
    summary = models.TextField(blank=True)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT, db_index=True)
    access_type = models.CharField(max_length=20, choices=AccessType.choices, default=AccessType.OPEN, db_index=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    currency = models.CharField(max_length=8, default='EUR')
    certificate_enabled = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='gravitas_courses_created',
    )
    published_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-published_at', '-updated_at']
        indexes = [models.Index(fields=['status', 'access_type'], name='grav_course_catalog')]

    def __str__(self):
        return self.title


class CourseModule(models.Model):
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='modules')
    position = models.PositiveIntegerField(default=1)
    title = models.CharField(max_length=240)
    summary = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['position', 'id']
        constraints = [
            models.UniqueConstraint(fields=['course', 'position'], name='unique_gravitas_course_module_position'),
        ]

    def __str__(self):
        return f'{self.course} · {self.position} · {self.title}'


class Lesson(models.Model):
    class Kind(models.TextChoices):
        VIDEO = 'video', 'Video'
        ARTICLE = 'article', 'Article'
        FILE = 'file', 'File / download'
        INTERACTIVE = 'interactive', 'Interactive'
        LIVE = 'live', 'Live session'

    module = models.ForeignKey(CourseModule, on_delete=models.CASCADE, related_name='lessons')
    position = models.PositiveIntegerField(default=1)
    title = models.CharField(max_length=240)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.ARTICLE)
    summary = models.TextField(blank=True)
    body = models.TextField(blank=True)
    content_url = models.URLField(max_length=1200, blank=True)
    duration_seconds = models.PositiveIntegerField(default=0)
    is_preview = models.BooleanField(default=False)
    is_required = models.BooleanField(default=True)
    published = models.BooleanField(default=True, db_index=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['module__position', 'position', 'id']
        constraints = [
            models.UniqueConstraint(fields=['module', 'position'], name='unique_gravitas_lesson_position'),
        ]

    def __str__(self):
        return f'{self.module.course} · {self.title}'


class CourseEnrollment(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        COMPLETED = 'completed', 'Completed'
        PAUSED = 'paused', 'Paused'
        REVOKED = 'revoked', 'Revoked'

    class AccessSource(models.TextChoices):
        OPEN = 'open', 'Open enrollment'
        ADMIN = 'admin', 'Administrator'
        PURCHASE = 'purchase', 'Purchase'
        INVITE = 'invite', 'Invite'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_course_enrollments',
    )
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='enrollments')
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE, db_index=True)
    access_source = models.CharField(max_length=20, choices=AccessSource.choices, default=AccessSource.OPEN)
    progress_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='gravitas_course_enrollments_granted',
        blank=True,
        null=True,
    )
    enrolled_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        constraints = [
            models.UniqueConstraint(fields=['user', 'course'], name='unique_gravitas_course_enrollment'),
        ]
        indexes = [
            models.Index(fields=['user', 'status'], name='grav_enrollment_user_state'),
            models.Index(fields=['course', 'status'], name='grav_enrollment_course_state'),
        ]

    def __str__(self):
        return f'{self.user} · {self.course} · {self.status}'


class LessonProgress(models.Model):
    enrollment = models.ForeignKey(CourseEnrollment, on_delete=models.CASCADE, related_name='lesson_progress')
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name='progress_rows')
    completed = models.BooleanField(default=False, db_index=True)
    progress_seconds = models.PositiveIntegerField(default=0)
    score = models.DecimalField(max_digits=6, decimal_places=2, blank=True, null=True)
    state = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['lesson__module__position', 'lesson__position']
        constraints = [
            models.UniqueConstraint(fields=['enrollment', 'lesson'], name='unique_gravitas_lesson_progress'),
        ]

    def __str__(self):
        return f'{self.enrollment} · {self.lesson}'


class Assessment(models.Model):
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='assessments')
    module = models.ForeignKey(
        CourseModule,
        on_delete=models.SET_NULL,
        related_name='assessments',
        blank=True,
        null=True,
    )
    title = models.CharField(max_length=240)
    instructions = models.TextField(blank=True)
    questions = models.JSONField(default=list, blank=True)
    passing_score = models.DecimalField(max_digits=5, decimal_places=2, default=70)
    max_attempts = models.PositiveIntegerField(default=3)
    required_for_completion = models.BooleanField(default=True)
    published = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['module__position', 'id']

    def __str__(self):
        return f'{self.course} · {self.title}'


class AssessmentAttempt(models.Model):
    enrollment = models.ForeignKey(CourseEnrollment, on_delete=models.CASCADE, related_name='assessment_attempts')
    assessment = models.ForeignKey(Assessment, on_delete=models.CASCADE, related_name='attempts')
    attempt_no = models.PositiveIntegerField()
    answers = models.JSONField(default=dict, blank=True)
    score = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    passed = models.BooleanField(default=False, db_index=True)
    started_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-submitted_at']
        constraints = [
            models.UniqueConstraint(
                fields=['enrollment', 'assessment', 'attempt_no'],
                name='unique_gravitas_assessment_attempt_number',
            ),
        ]

    def __str__(self):
        return f'{self.enrollment} · {self.assessment} · #{self.attempt_no}'


class Certificate(models.Model):
    enrollment = models.OneToOneField(
        CourseEnrollment,
        on_delete=models.CASCADE,
        related_name='certificate',
    )
    code = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    issued_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(blank=True, null=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-issued_at']

    def __str__(self):
        return f'{self.enrollment.course} · {self.enrollment.user} · {self.code}'
