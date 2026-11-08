"""Executed read-only with the existing backend environment on the host."""
import hashlib
import json
import django
django.setup()
from django.conf import settings
from core.models import ContentItem
from urllib.parse import quote

items = []
for item in ContentItem.objects.filter(status='published', kind__in=['topic','dossier']):
    canonical = json.dumps({'body':item.body, 'data':item.topic_data}, sort_keys=True)
    items.append({'id':item.pk, 'key':item.slug, 'title':item.title,
                  'url':settings.PUBLIC_BASE_URL.rstrip('/') + '/topic.html?slug=' + quote(item.slug),
                  'version':'sha256:' + hashlib.sha256(canonical.encode()).hexdigest()})
print(json.dumps({'published_content':items}))
