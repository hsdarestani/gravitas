"""Production inventory only; no user content, identifiers or secrets in logs."""
import json
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'gravitas_backend.settings')
import django
django.setup()
from django.apps import apps
from django.conf import settings
from django.db import connection, transaction

inventory = {}
with transaction.atomic():
    if connection.vendor != 'postgresql':
        raise RuntimeError('Production inspection requires PostgreSQL read-only transaction')
    with connection.cursor() as cursor:
        cursor.execute('SET TRANSACTION READ ONLY')
    for model_name in ('ResearchProject', 'KnowledgeResource', 'OperatingTask', 'MindMap', 'Course', 'Lesson', 'CourseEnrollment'):
        model = apps.get_model('core', model_name)
        inventory[model_name] = model.objects.count()
    for model_name in ('CanonicalProject', 'DailyWorkReport'):
        try:
            model = apps.get_model('core', model_name)
        except LookupError:
            inventory[model_name] = 'not_deployed'
        else:
            inventory[model_name] = model.objects.count()
    preference = apps.get_model('core', 'TaskNotificationPreference')
    inventory['connected_telegram_accounts'] = preference.objects.filter(telegram_chat_id__isnull=False).count()
    # Configuration state only. Values/keys never leave this process.
    inventory['nextcloud_configured'] = bool(getattr(settings, 'NEXTCLOUD_ADMIN_USER', '') and getattr(settings, 'NEXTCLOUD_ADMIN_PASSWORD', ''))
    inventory['canonical_adoption_enabled'] = bool(getattr(settings, 'GRAVITAS_CANONICAL_ADOPTION_ENABLED', False))
    inventory['database_read_only'] = True
print(json.dumps(inventory, sort_keys=True))
