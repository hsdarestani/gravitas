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
    from django.db.models import Count
    reports = apps.get_model('core', 'DailyWorkReport')
    inventory['report_states'] = dict(reports.objects.values_list('status').annotate(total=Count('pk')))
    from core.pulsar import configured
    inventory['managed_ai_configured'] = bool(configured())
    from pathlib import Path
    plan_path = Path('/var/www/gravitas/ops/operational_acceptance.json')
    if plan_path.is_file():
        plan = json.loads(plan_path.read_text())
        project = apps.get_model('core', 'ResearchProject').objects.filter(pk=plan.get('project_id'), title=plan.get('expected_title')).first()
        identity = apps.get_model('core', 'NextcloudIdentity').objects.filter(user_id=project.owner_id).first() if project else None
        if identity:
            from core import cloud
            try:
                response = cloud._request('PROPFIND', cloud._dav_url(identity, cloud.project_mountpoint(project)), auth=cloud._auth(identity),
                    expected={207, 403, 404}, headers={'Depth': '0'})
                inventory['selected_owner_native_root_status'] = response.status_code
            except cloud.CloudError:
                inventory['selected_owner_native_root_status'] = 'native_request_failed'
    if plan_path.is_file() and project:
        from core import cloud
        from core.canonical_acl import read_acl
        for label, suffix in [('root', ''), ('journal', '/06_Archive/CanonicalTransactions')]:
            target = cloud.project_mountpoint(project) + suffix
            try:
                first, second = read_acl(target), read_acl(target)
                etag = second['etag']
                conditional = cloud._request('HEAD', cloud._admin_dav_url(target), auth=cloud._admin_auth(),
                    expected={200, 207, 301, 302, 403, 404, 405, 412}, headers={'If-Match': etag})
                inventory['native_acl_' + label] = {'rules_count': len(second['rules']),
                    'etag_quoted': etag.startswith('"') and etag.endswith('"'),
                    'etag_stable': first['etag'] == etag,
                    'conditional_head_status': conditional.status_code,
                    'head_etag_matches': conditional.headers.get('ETag') == etag}
            except cloud.CloudError:
                inventory['native_acl_' + label] = 'snapshot_unavailable'
print(json.dumps(inventory, sort_keys=True))
