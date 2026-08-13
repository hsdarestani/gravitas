from django.conf import settings
from django.db import models


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
            models.Index(fields=['content_key', 'status', 'created_at']),
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


class AnalyticsEvent(models.Model):
    class Name(models.TextChoices):
        PAGE_VIEW = 'page_view', 'Page view'
        DOSSIER_OPEN = 'dossier_open', 'Dossier open'
        ARTICLE_OPEN = 'article_open', 'Article open'
        LAB_STARTED = 'lab_started', 'Lab started'
        LAB_COMPLETED = 'lab_completed', 'Lab completed'
        COMMENT_SUBMITTED = 'comment_submitted', 'Comment submitted'
        NEWSLETTER_SIGNUP = 'newsletter_signup', 'Newsletter signup'
        ACCOUNT_CREATED = 'account_created', 'Account created'
        LEARNING_STEP = 'learning_step', 'Learning step'

    name = models.CharField(max_length=40, choices=Name.choices, db_index=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='gravitas_analytics_events',
        blank=True,
        null=True,
    )
    session_key = models.CharField(max_length=64, blank=True, db_index=True)
    content_key = models.SlugField(max_length=190, blank=True, db_index=True)
    path = models.CharField(max_length=500, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['name', 'created_at']),
            models.Index(fields=['content_key', 'created_at']),
        ]

    def __str__(self):
        return f'{self.name} · {self.content_key or self.path}'
