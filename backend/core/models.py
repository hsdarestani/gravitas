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
