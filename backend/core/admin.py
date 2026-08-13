from django.contrib import admin
from .models import ContentItem, NewsletterSubscriber

admin.site.register(ContentItem)
admin.site.register(NewsletterSubscriber)
