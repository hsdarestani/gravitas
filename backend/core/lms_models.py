import uuid

from django.conf import settings
from django.db import models


class CourseCategory(models.Model):
    slug = models.SlugField(max_length=160, unique=True)
    name = models.CharField(max_length=180, unique=True)
    description = models.TextField(blank=True)
    position = models.PositiveIntegerField(default=0)
    active = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ['position', 'name']

    def __str__(self):
        return self.name


class CourseTag(models.Model):
    slug = models.SlugField(max_length=160, unique=True)
    name = models.CharField(max_length=180, unique=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Course(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'
        ARCHIVED = 'archived', 'Archived'

    class AccessType(models.TextChoices):
        OPEN = 'open', 'Open enrollment'
        LOCKED = 'locked', 'Locked / invite only'
        PAID = 'paid', 'Paid'

    class Provider(models.TextChoices):
        NATIVE = 'native', 'Gravitas native'
        OPENEDX = 'openedx', 'Open edX'

    slug = models.SlugField(max_length=190, unique=True)
    title = models.CharField(max_length=240)
    summary = models.TextField(blank=True)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT, db_index=True)
    access_type = models.CharField(max_length=20, choices=AccessType.choices, default=AccessType.OPEN, db_index=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    currency = models.CharField(max_length=8, default='EUR')
    certificate_enabled = models.BooleanField(default=True)
    provider = models.CharField(max_length=20, choices=Provider.choices, default=Provider.NATIVE, db_index=True)
    openedx_course_key = models.CharField(max_length=255, blank=True, db_index=True)
    openedx_course_url = models.URLField(max_length=1200, blank=True)
    openedx_studio_url = models.URLField(max_length=1200, blank=True)
    category = models.ForeignKey(
        CourseCategory,
        on_delete=models.SET_NULL,
        related_name='courses',
        blank=True,
        null=True,
    )
    tags = models.ManyToManyField(CourseTag, related_name='courses', blank=True)
    registration_schema = models.JSONField(default=list, blank=True)
    payment_config = models.JSONField(default=dict, blank=True)
    learning_config = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='gravitas_courses_created',
    )
    instructors = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through='CourseInstructor',
        related_name='gravitas_courses_taught',
        blank=True,
    )
    published_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-published_at', '-updated_at']
        indexes = [models.Index(fields=['status', 'access_type'], name='grav_course_catalog')]

    def __str__(self):
        return self.title


class CourseInstructor(models.Model):
    class Role(models.TextChoices):
        LEAD = 'lead', 'Lead instructor'
        INSTRUCTOR = 'instructor', 'Instructor'
        ASSISTANT = 'assistant', 'Teaching assistant'

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='instructor_links')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_course_instructor_links',
    )
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.INSTRUCTOR)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['position', 'id']
        constraints = [
            models.UniqueConstraint(fields=['course', 'user'], name='unique_gravitas_course_instructor'),
        ]


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
        PDF = 'pdf', 'PDF'
        AUDIO = 'audio', 'Audio'
        DOCUMENT = 'document', 'Document'
        DATASET = 'dataset', 'Dataset'
        EMBED = 'embed', 'Embedded content'
        LAB = 'lab', 'Interactive Lab'
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
    access_rule = models.JSONField(default=dict, blank=True)
    provider_key = models.CharField(max_length=255, blank=True)
    lab_slug = models.CharField(max_length=190, blank=True)
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
    provider_state = models.JSONField(default=dict, blank=True)
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



class CourseRegistrationProfile(models.Model):
    enrollment = models.OneToOneField(
        CourseEnrollment,
        on_delete=models.CASCADE,
        related_name='registration_profile',
    )
    answers = models.JSONField(default=dict, blank=True)
    completed = models.BooleanField(default=False, db_index=True)
    completed_at = models.DateTimeField(blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)


class LearningAsset(models.Model):
    class Kind(models.TextChoices):
        FILE = 'file', 'File'
        URL = 'url', 'URL'
        EMBED = 'embed', 'Embed'

    logical_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='assets')
    lesson = models.ForeignKey(
        Lesson,
        on_delete=models.SET_NULL,
        related_name='assets',
        blank=True,
        null=True,
    )
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.FILE, db_index=True)
    title = models.CharField(max_length=240)
    folder_path = models.CharField(max_length=700, blank=True, db_index=True)
    version = models.PositiveIntegerField(default=1)
    version_note = models.CharField(max_length=500, blank=True)
    is_current = models.BooleanField(default=True, db_index=True)
    original_name = models.CharField(max_length=255, blank=True)
    storage_path = models.CharField(max_length=1000, blank=True)
    source_url = models.URLField(max_length=1800, blank=True)
    mime_type = models.CharField(max_length=180, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    metadata = models.JSONField(default=dict, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='gravitas_learning_assets',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['folder_path', 'title', '-version', '-updated_at']
        constraints = [
            models.UniqueConstraint(fields=['logical_id', 'version'], name='unique_gravitas_learning_asset_version'),
        ]


class LearningPath(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'
        ARCHIVED = 'archived', 'Archived'

    slug = models.SlugField(max_length=190, unique=True)
    title = models.CharField(max_length=240)
    summary = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT, db_index=True)
    nodes = models.JSONField(default=list, blank=True)
    edges = models.JSONField(default=list, blank=True)
    payment_config = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='gravitas_learning_paths_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']


class SourceConnection(models.Model):
    class Provider(models.TextChoices):
        ZOTERO = 'zotero', 'Zotero'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_source_connections',
    )
    provider = models.CharField(max_length=30, choices=Provider.choices, default=Provider.ZOTERO)
    label = models.CharField(max_length=120, default='Zotero')
    library_type = models.CharField(max_length=20, default='user')
    library_id = models.CharField(max_length=120)
    encrypted_token = models.TextField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        constraints = [
            models.UniqueConstraint(fields=['user', 'provider', 'library_type', 'library_id'], name='unique_gravitas_source_connection'),
        ]


class CourseEvent(models.Model):
    class Kind(models.TextChoices):
        COURSE_OPEN = 'course.open', 'Course open'
        LESSON_VIEW = 'lesson.view', 'Lesson view'
        LESSON_SKIP = 'lesson.skip', 'Lesson skip'
        LESSON_DWELL = 'lesson.dwell', 'Lesson dwell'
        AI_USE = 'ai.use', 'AI use'
        LAB_USE = 'lab.use', 'Lab use'
        EXPORT = 'export', 'Export'
        DISCUSSION_POST = 'discussion.post', 'Discussion post'
        LITERATURE_SEARCH = 'literature.search', 'Literature search'
        NOTEBOOK_OPEN = 'notebook.open', 'Notebook open'
        GIT_PUSH = 'git.push', 'Git push'
        SOCIAL_PUBLISH = 'social.publish', 'Social publish'
        PKM_EXPORT = 'pkm.export', 'PKM export'
        PATH_PERSONALIZE = 'path.personalize', 'Path personalize'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_course_events',
    )
    enrollment = models.ForeignKey(
        CourseEnrollment,
        on_delete=models.SET_NULL,
        related_name='events',
        blank=True,
        null=True,
    )
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='events')
    lesson = models.ForeignKey(
        Lesson,
        on_delete=models.SET_NULL,
        related_name='events',
        blank=True,
        null=True,
    )
    kind = models.CharField(max_length=40, choices=Kind.choices, db_index=True)
    duration_seconds = models.PositiveIntegerField(default=0)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['course', 'kind', '-created_at'], name='grav_lms_event_course_kind'),
            models.Index(fields=['user', 'kind', '-created_at'], name='grav_lms_event_user_kind'),
        ]

class LearnerPathAssignment(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_learning_path_assignments',
    )
    learning_path = models.ForeignKey(
        LearningPath,
        on_delete=models.SET_NULL,
        related_name='learner_assignments',
        blank=True,
        null=True,
    )
    goal = models.TextField()
    nodes = models.JSONField(default=list, blank=True)
    edges = models.JSONField(default=list, blank=True)
    rationale = models.TextField(blank=True)
    active = models.BooleanField(default=True, db_index=True)
    generated_by_ai = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']


class CourseDiscussionMessage(models.Model):
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='discussion_messages')
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_course_discussion_messages',
    )
    reply_to = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        related_name='replies',
        blank=True,
        null=True,
    )
    body = models.TextField(max_length=12000)
    deleted = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at', 'id']
        indexes = [
            models.Index(fields=['course', 'created_at'], name='grav_lms_chat_course_time'),
        ]


class LearningIntegration(models.Model):
    class Provider(models.TextChoices):
        GITHUB = 'github', 'GitHub'
        LINKEDIN = 'linkedin', 'LinkedIn'
        MEDIUM = 'medium', 'Medium'
        ORCID = 'orcid', 'ORCID'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='gravitas_learning_integrations',
    )
    provider = models.CharField(max_length=30, choices=Provider.choices, db_index=True)
    label = models.CharField(max_length=160, blank=True)
    account_id = models.CharField(max_length=320, blank=True)
    encrypted_token = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['provider', '-updated_at']
        constraints = [
            models.UniqueConstraint(fields=['user', 'provider'], name='unique_gravitas_learning_integration'),
        ]


class LearningRepository(models.Model):
    class ReviewStatus(models.TextChoices):
        PENDING = 'pending', 'Pending review'
        NEEDS_CHANGES = 'needs_changes', 'Needs changes'
        APPROVED = 'approved', 'Approved'

    enrollment = models.ForeignKey(
        CourseEnrollment,
        on_delete=models.CASCADE,
        related_name='repositories',
    )
    lesson = models.ForeignKey(
        Lesson,
        on_delete=models.SET_NULL,
        related_name='learning_repositories',
        blank=True,
        null=True,
    )
    provider = models.CharField(max_length=30, default='github')
    owner = models.CharField(max_length=160)
    repository = models.CharField(max_length=220)
    branch = models.CharField(max_length=160, default='main')
    path_prefix = models.CharField(max_length=600, blank=True)
    html_url = models.URLField(max_length=1600, blank=True)
    last_commit_sha = models.CharField(max_length=160, blank=True)
    review_status = models.CharField(max_length=24, choices=ReviewStatus.choices, default=ReviewStatus.PENDING, db_index=True)
    review_note = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='gravitas_learning_repository_reviews',
        blank=True,
        null=True,
    )
    reviewed_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        constraints = [
            models.UniqueConstraint(
                fields=['enrollment', 'lesson', 'provider', 'owner', 'repository', 'path_prefix'],
                name='unique_gravitas_learning_repository',
            ),
        ]


class NotebookWorkspace(models.Model):
    class Runtime(models.TextChoices):
        PYTHON = 'python', 'Python'
        JUPYTER = 'jupyter', 'Jupyter'
        MATHEMATICA = 'mathematica', 'Mathematica'

    enrollment = models.ForeignKey(
        CourseEnrollment,
        on_delete=models.CASCADE,
        related_name='notebooks',
    )
    lesson = models.ForeignKey(
        Lesson,
        on_delete=models.SET_NULL,
        related_name='notebook_workspaces',
        blank=True,
        null=True,
    )
    title = models.CharField(max_length=240)
    runtime = models.CharField(max_length=20, choices=Runtime.choices, default=Runtime.PYTHON)
    code = models.TextField(blank=True)
    environment = models.JSONField(default=dict, blank=True)
    revision = models.PositiveIntegerField(default=1)
    last_run_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

