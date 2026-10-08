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
    from core.work_reports import my_tasks
    from core import work_reports
    from django.contrib.auth import get_user_model
    open_owner_ids = apps.get_model('core', 'OperatingTask').objects.exclude(status__in=['done', 'archived']).values_list('owner_id', flat=True)
    states = []
    for user in get_user_model().objects.filter(is_active=True, pk__in=open_owner_ids):
        try:
            tasks = my_tasks(user)
        except PermissionError:
            continue
        if any(t.status not in {'done', 'archived'} for t in tasks):
            states.append(work_reports.checkin_status(user, tasks) if hasattr(work_reports, 'checkin_status') else {'telegram_connected': preference.objects.filter(user=user, telegram_enabled=True, telegram_chat_id__isnull=False).exists(), 'confirmed': reports.objects.filter(user=user, report_date=work_reports.report_day(), status='confirmed').exists(), 'due': False})
    inventory['daily_reporting'] = {'timezone': getattr(settings, 'GRAVITAS_DAILY_REPORT_TIMEZONE', 'Asia/Tehran'),
        'hour': getattr(settings, 'GRAVITAS_DAILY_REPORT_HOUR', 18), 'platform_requests_deployed': hasattr(work_reports, 'checkin_status'), 'eligible_members': len(states),
        'telegram_connected_members': sum(s['telegram_connected'] for s in states),
        'confirmed_today': sum(s['confirmed'] for s in states), 'awaiting_reports': sum(s['due'] for s in states)}
    outbox = apps.get_model('core', 'TaskNotificationOutbox')
    inventory['daily_checkin_delivery_states'] = dict(outbox.objects.filter(event_type='daily.checkin').values_list('status').annotate(total=Count('pk')))

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

# Native Telegram metadata only; no bot token, chat identity or webhook secret
# is emitted. A healthy webhook does not certify a human response.
from core.task_notifications import _telegram_api
try:
    info = _telegram_api('getWebhookInfo', {}).get('result', {})
    telegram = {'webhook_matches_platform': info.get('url') == settings.PUBLIC_BASE_URL.rstrip('/') + '/api/task-notifications/telegram/webhook/',
        'pending_updates': info.get('pending_update_count', 0), 'has_last_error': bool(info.get('last_error_date'))}
except RuntimeError:
    telegram = {'inspection': 'native_request_failed'}
print(json.dumps({'telegram_runtime': telegram}, sort_keys=True))

if plan_path.is_file() and project:
    # Read-only evidence from the failed selected acceptance transaction.
    journal_path = cloud.project_mountpoint(project) + '/06_Archive/CanonicalTransactions/4b9efdab-e748-4ace-8ca2-343f7e8d5090.json'
    try:
        first = cloud._request('GET', cloud._admin_dav_url(journal_path), auth=cloud._admin_auth(), expected={200, 404})
        second = cloud._request('GET', cloud._admin_dav_url(journal_path), auth=cloud._admin_auth(), expected={200, 404}, headers={'Accept-Encoding': 'identity'})
        details = {'status': first.status_code, 'identity_status': second.status_code,
            'default_etag_weak': first.headers.get('ETag', '').startswith('W/'),
            'identity_etag_weak': second.headers.get('ETag', '').startswith('W/'),
            'default_encoding': first.headers.get('Content-Encoding', ''),
            'identity_encoding': second.headers.get('Content-Encoding', ''),
            'etag_same': first.headers.get('ETag') == second.headers.get('ETag')}
        if second.status_code == 200:
            for label, response in [('default', first), ('identity', second)]:
                precondition = cloud._request('HEAD', cloud._admin_dav_url(journal_path), auth=cloud._admin_auth(), expected={200, 412},
                    headers={'Accept-Encoding': 'identity', 'If-Match': response.headers.get('ETag', '')})
                details[label + '_etag_conditional_head_status'] = precondition.status_code
            manifest = second.json()
            details['state'] = manifest.get('state')
            from core.canonical_acl import desired_rules
            from core import nextcloud_bridge
            policy = desired_rules(cloud.project_group_id(project), nextcloud_bridge._project_root_roles(project),
                'specific', cloud.canonical_native_groups(project).values())
            details['current_root_matches_policy'] = read_acl(cloud.project_mountpoint(project))['rules'] == policy
            details['operations'] = [{'kind': op.get('kind'), 'write_receipt_recorded': bool(op.get('written') or op.get('written_etag')),
                'acl_equals_before': read_acl(op['path'])['rules'] == op['before']['rules'] if op.get('kind') == 'acl' else None,
                'acl_equals_desired': read_acl(op['path'])['rules'] == op['rules'] if op.get('kind') == 'acl' else None} for op in manifest.get('operations', [])]
        print(json.dumps({'failed_journal_diagnostics': details}, sort_keys=True))
    except (cloud.CloudError, ValueError):
        print(json.dumps({'failed_journal_diagnostics': 'snapshot_unavailable'}))
