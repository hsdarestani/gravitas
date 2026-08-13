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
