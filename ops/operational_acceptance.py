"""One-off live acceptance of an explicitly selected existing private project.

Run only after the server wrapper captures and rehearses a matched checkpoint.
This is native DAV/server integration evidence; it does not certify browser,
mobile, collaboration invitations or a human Telegram response.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlencode


def verify_native_acl_boundary(project, identity):
    from django.conf import settings
    from core import cloud
    root = cloud.project_mountpoint(project)
    # Real native permission CAS must reject both stale ETags and a stale rule
    # snapshot with the same ETag; neither probe changes permissions.
    from core.canonical_acl import read_acl, write_acl
    acl_before = read_acl(root)
    if not acl_before['rules']:
        raise ValueError('Adopted project root has no direct permission rules')
    if write_acl(root, acl_before['rules'], dict(acl_before, etag='"stale-native-acceptance"')) is not None:
        raise ValueError('Native ACL accepted a stale ETag')
    if write_acl(root, acl_before['rules'], dict(acl_before, rules=[])) is not None:
        raise ValueError('Native ACL accepted a stale permission snapshot')
    if read_acl(root) != acl_before:
        raise ValueError('Rejected native ACL probes changed permissions')
    boundary = cloud._request('POST', settings.NEXTCLOUD_INTERNAL_URL + '/ocs/v2.php/apps/gravitascanonical/api/v1/acl',
        auth=cloud._auth(identity), expected={403}, headers={'OCS-APIRequest': 'true', 'Accept': 'application/json'},
        data={'path': root, 'expected_etag': acl_before['etag'], 'expected_rules': json.dumps(acl_before['rules']), 'rules': json.dumps(acl_before['rules'])})

    return boundary.status_code


def review_selected_root_acl_recovery(project, review):
    """Explicit reviewed incident only; normal ambiguous recovery stays closed.

    The native incident evidence showed one root ACL operation, no file writes,
    and exact desired rules after the compressed journal ETag failed. Recheck
    that those rules equal the current selected project's permission policy,
    record a reviewed write receipt conditionally, then restore the old rules
    using the existing native CAS recovery. The fresh checkpoint wrapper is
    required before this function is invoked by the apply command.
    """
    import uuid
    from django.db import transaction
    from core import cloud, nextcloud_bridge
    from core.canonical_models import CanonicalWriteCommit
    from core.canonical_projects import dav_read, dav_write
    from core.canonical_acl import desired_rules, normalize, read_acl
    from core.canonical_journal import recover_journal, RecoveryRequired
    if set(review) != {'batch_id', 'resolution', 'reason'} or review['resolution'] != 'restore_previous_root_acl' or not review['reason']:
        raise ValueError('Invalid reviewed ACL recovery plan')
    batch_id = str(uuid.UUID(review['batch_id']))
    root = cloud.project_mountpoint(project)
    path = root + '/06_Archive/CanonicalTransactions/' + batch_id + '.json'
    with transaction.atomic():
        type(project).objects.select_for_update().get(pk=project.pk)
        remote = dav_read(path)
        if not remote:
            raise RecoveryRequired('Reviewed incident journal is missing')
        manifest = json.loads(remote['content'])
        if manifest.get('schema') != 1 or manifest.get('batch_id') != batch_id or manifest.get('project_id') != project.pk:
            raise RecoveryRequired('Reviewed incident journal identity differs')
        if manifest.get('state') == 'rolled_back':
            return 'already_rolled_back'
        operations = manifest.get('operations', [])
        if manifest.get('state') != 'pending' or len(operations) != 1 or CanonicalWriteCommit.objects.filter(pk=batch_id).exists():
            raise RecoveryRequired('Reviewed incident shape or database witness differs')
        op = operations[0]
        if op.get('kind') != 'acl' or op.get('path') != root or op.get('not_written') or op.get('restored'):
            raise RecoveryRequired('Reviewed incident is not the selected root ACL write')
        if not op.get('written'):
            current = read_acl(root)
            policy = desired_rules(cloud.project_group_id(project), nextcloud_bridge._project_root_roles(project),
                'specific', cloud.canonical_native_groups(project).values())
            if current['rules'] != normalize(op['rules']) or current['rules'] != policy:
                raise RecoveryRequired('Current root ACL differs from reviewed incident and current permission policy')
            op['written'] = current
            manifest['operational_review'] = {'resolution': review['resolution'], 'reason': review['reason'],
                'source': 'explicit_selected_recovery_plan', 'permission_policy_matched': True}
            if not dav_write(path, json.dumps(manifest, ensure_ascii=False), remote['etag']):
                raise RecoveryRequired('Reviewed incident journal changed')
        elif manifest.get('operational_review', {}).get('source') != 'explicit_selected_recovery_plan':
            raise RecoveryRequired('Incident receipt is not from this reviewed recovery')
        return recover_journal(path)


def reconcile_tasks(owner):
    """Bind the explicit Topic/Video dependencies without closing execution."""
    from core.operating_models import OperatingTask, WorkStatus
    from core.models import WorkspaceMembership
    from core.platform_access import can_edit
    from core.pulsar_task_service import create_operating_task
    from core.canonical_journal import canonical_operation
    from core.layer_access import record_activity
    from core.layer_models import ActivityEvent
    from core.platform_runtime_v3 import ensure_platform_workspaces
    core = ensure_platform_workspaces(owner)['core']
    titles = {'video': 'Document the end-to-end video production workflow through a real Research Project',
        'topic': 'Create a real topic in the platform and test the new structure',
        'skill': 'Build reusable Claude Skill from the approved Video Production workflow'}
    selected = {key: OperatingTask.objects.filter(workspace=core).exclude(status=WorkStatus.ARCHIVED).select_related('initiative__key_result', 'owner').get(title=title) for key, title in titles.items()}
    video, topic, skill = (selected[key] for key in ('video', 'topic', 'skill'))
    if video.owner_id != owner.pk or topic.owner_id != owner.pk or any(not can_edit(owner, task) for task in selected.values()):
        raise ValueError('Selected task ownership/access changed')
    if (skill.owner.get_full_name() or skill.owner.get_username()).split()[0].casefold() != 'ahmad':
        raise ValueError('Reusable Skill is no longer assigned to the selected Ahmad')
    candidates = [link.user for link in WorkspaceMembership.objects.filter(workspace=topic.workspace, user__is_active=True).select_related('user')
        if (link.user.get_full_name() or link.user.get_username()).split()[0].casefold() == 'sajad']
    if len(candidates) != 1:
        raise ValueError('Unique existing Sajad membership required')
    review_title = 'Review and approve the prepared Topic Template before upload'
    with canonical_operation(owner):
        matches = OperatingTask.objects.filter(workspace=topic.workspace, title=review_title)
        if matches.count() > 1:
            raise ValueError('Ambiguous Topic review task')
        review = matches.first()
        if review is None:
            review = create_operating_task(owner, {'title': review_title, 'owner_id': candidates[0].pk,
                'key_result_id': topic.initiative.key_result_id, 'due_date': str(topic.due_date), 'priority': topic.priority,
                'description': 'Prepared content is complete. Review the existing Topic Template; no upload or publication before approval.',
                'definition_of_done': 'Sajad explicitly approves the existing Topic Template and records any required corrections. Approval releases the prepared-content upload and structure/access/navigation QA step.'}, confirmed=True, source='operational_reconciliation')
            review.status = WorkStatus.READY; review.save()
        if review.owner_id != candidates[0].pk:
            raise ValueError('Topic review owner differs from the selected Sajad')
        changes = [(review, {'status': WorkStatus.READY} if review.status == WorkStatus.DRAFT else {}),
            (video, {'dependency': skill, **({'status': WorkStatus.WAITING} if video.status in {WorkStatus.DRAFT, WorkStatus.BLOCKED, WorkStatus.WAITING} else {})}),
            (topic, {'status': WorkStatus.BLOCKED, 'dependency': review}),
            (skill, {'priority': video.priority, **({'status': WorkStatus.READY} if skill.status == WorkStatus.DRAFT else {})})]
        for task, fields in changes:
            changed = any(getattr(task, field) != value for field, value in fields.items())
            if changed:
                for field, value in fields.items():
                    setattr(task, field, value)
                task.save()
                record_activity(layer=ActivityEvent.Layer.CORE, action='task.operational_reconciliation', actor=owner,
                    subject_user=task.owner, object_type='operating_task', object_id=task.pk,
                    detail={'status': task.status, 'dependency_id': task.dependency_id, 'priority': task.priority})
    return {'video_waiting_on_skill': True, 'topic_blocked_on_review': True, 'review_task_id': review.pk}


def send_owner_checkin(owner, plan_digest):
    """One real check-in to the already linked owner; never impersonate a reply."""
    from django.db import transaction
    from django.utils import timezone
    from core.operating_models import TaskNotificationPreference, TaskNotificationOutbox
    from core.task_notifications import _send_telegram
    if not TaskNotificationPreference.objects.filter(user=owner, telegram_enabled=True, telegram_chat_id__isnull=False).exists():
        return 'owner_not_connected'
    with transaction.atomic():
        row, created = TaskNotificationOutbox.objects.get_or_create(recipient=owner, channel='telegram',
            event_key='operational-acceptance:' + plan_digest[:32], defaults={'event_type': 'operational.acceptance',
                'subject': 'Pulsar · آزمون واقعی گزارش روزانه',
                'body': 'برای آزمون گزارش روزانه، /report و گزارش امروزت را بفرست. پیش از هر تغییر وظیفه، پیشنهاد را برای تأیید، ویرایش یا لغو می‌بینی.'})
        row = TaskNotificationOutbox.objects.select_for_update().get(pk=row.pk)
        if row.status == 'sent':
            return 'sent'
        if not created or row.attempts:
            return 'pending_existing_delivery'
        result = _send_telegram(row)
        row.status = 'sent'; row.sent_at = timezone.now(); row.attempts = 1
        row.last_error = '' if result == 'sent' else 'skipped_by_current_preference'
        row.save(update_fields=['status', 'sent_at', 'attempts', 'last_error', 'updated_at'])
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    plan_bytes = args.plan.read_bytes()
    plan = json.loads(plan_bytes)
    if plan.get('schema') != 1 or plan.get('operation') != 'accept_selected_existing_project' or type(plan.get('project_id')) is not int:
        raise ValueError('Unsupported acceptance plan')
    if not args.apply:
        print('Inspection only: selected existing project; native checkpoint and isolated rehearsal required before apply.')
        return
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'gravitas_backend.settings')
    import django
    django.setup()
    from django.conf import settings
    from django.test import override_settings, RequestFactory
    from core import cloud, nextcloud_bridge
    from core.models import ResearchProject, KnowledgeResource
    from core.platform_models import MindMap
    from core.platform_access import can_manage, can_view, policy_for
    from core.canonical_models import CanonicalFile
    from core.canonical_projects import adopt_project, project_objects, encode, dav_read, relative_path, refresh_project
    from core.canonical_journal import canonical_operation
    from core.canonical_api import listing, project_file_content
    from core.work_report_models import DailyWorkReport
    from core.work_reports import report_overview_api
    from core.assistant_api import assistant_ask

    receipt_dir = Path(settings.CORE_UPLOAD_ROOT) / '.operations'
    receipt_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    receipt = receipt_dir / ('acceptance-' + hashlib.sha256(plan_bytes).hexdigest() + '.json')
    project = ResearchProject.objects.select_related('owner').get(pk=plan['project_id'], archived=False)
    owner = project.owner
    if project.title != plan['expected_title'] or not owner.is_active or not can_manage(owner, project):
        raise ValueError('Selected project identity/access changed')
    sources = KnowledgeResource.objects.filter(project=project, metadata__has_key='canonical_source_key')
    maps = MindMap.objects.filter(project=project, title='Pulsar · Existing implementation sources')
    if sources.count() != plan['expected_source_notes'] or maps.count() != plan['expected_source_maps']:
        raise ValueError('Existing source inventory differs from the reviewed plan')
    task_results = reconcile_tasks(owner)
    if receipt.exists():
        print('Selected acceptance already completed; native writes and Telegram delivery are not repeated. Task dependencies reconciled idempotently.')
        return
    telegram_delivery = send_owner_checkin(owner, hashlib.sha256(plan_bytes).hexdigest())
    print('Linked owner Telegram acceptance check-in: ' + telegram_delivery, flush=True)
    if plan.get('reviewed_acl_recovery'):
        print('Reviewed root ACL incident recovery: ' + review_selected_root_acl_recovery(project, plan['reviewed_acl_recovery']))
    identities = {(obj.__class__.__name__, obj.pk) for obj in project_objects(project)}
    # The explicit CLI plan authorizes only this selected adoption. The global
    # setting remains false; the HTTP adoption endpoint stays unavailable.
    with override_settings(GRAVITAS_CANONICAL_ADOPTION_ENABLED=True):
        adopt_project(project, owner)
        adopt_project(project, owner)
    if identities != {(obj.__class__.__name__, obj.pk) for obj in project_objects(project)}:
        raise ValueError('Adoption changed existing domain identities')
    root = cloud.project_mountpoint(project)
    identity = nextcloud_bridge.ensure_user(owner)
    for obj in project_objects(project):
        file = CanonicalFile.objects.get(project=project, object_type=obj.__class__.__name__, object_id=obj.pk, deleted=False)
        remote = dav_read(root + '/' + file.path)
        if not remote or remote['content'] != encode(obj) or not remote['etag'] or not remote.get('file_id'):
            raise ValueError('Canonical content/identity readback failed')
    names = {row['name'] for row in listing(project, owner, '')}
    from core.platform_api import PROJECT_FOLDERS
    if not set(PROJECT_FOLDERS).issubset(names) or 'project.md' not in names:
        raise ValueError('Owner cannot browse the complete canonical project root')
    native = cloud._request('GET', cloud._dav_url(identity, root + '/project.md'), auth=cloud._auth(identity), expected={200})
    if native.content.decode('utf-8') != encode(project):
        raise ValueError('Owner native project Markdown differs')

    boundary_status = verify_native_acl_boundary(project, identity)

    # Keep QA writes in their own evidence note, preserving all source material.
    key = 'operational-canonical-acceptance-v1'
    with canonical_operation(owner):
        note = KnowledgeResource.objects.filter(project=project, metadata__acceptance_key=key).first()
        if note is None:
            note = KnowledgeResource.objects.create(workspace=project.workspace, project=project, owner=owner,
                kind='note', title='Canonical operational acceptance evidence',
                body='# Native canonical acceptance\n\nSeparate evidence note; imported sources remain preserved.\n', metadata={'acceptance_key': key})
            policy_for(note, create=True, created_by=owner, default_visibility='inherit')
    path = relative_path(note)
    before = dav_read(root + '/' + path)
    if not before:
        raise ValueError('Evidence note canonical export missing')
    # A real owner DAV client edits outside the platform; the supported typed
    # projection must import it on refresh without changing the object ID.
    external = before['content'] + '\nExternal owner DAV edit verified.\n'
    written = cloud._request('PUT', cloud._dav_url(identity, root + '/' + path), auth=cloud._auth(identity),
        expected={200, 201, 204, 412}, headers={'If-Match': before['etag']}, data=external.encode('utf-8'))
    if written.status_code == 412:
        raise ValueError('Evidence note changed; review before retrying')
    refresh_project(project, owner)
    note.refresh_from_db()
    if 'External owner DAV edit verified.' not in note.body:
        raise ValueError('External edit was not imported into its typed projection')

    # Two separate requests observe one revision. Overlapping edits must return
    # an explicit conflict, then a reviewed fresh-revision update can resolve it.
    factory = RequestFactory()
    url = '/api/platform/projects/' + str(project.pk) + '/file-content/?' + urlencode({'path': path})
    def request(method, payload=None):
        req = factory.get(url) if method == 'GET' else factory.put(url, json.dumps(payload), content_type='application/json')
        req.user = owner
        response = project_file_content(req, project.pk)
        return response.status_code, json.loads(response.content)
    status, first = request('GET')
    status2, second = request('GET')
    if status != 200 or status2 != 200 or first['etag'] != second['etag']:
        raise ValueError('Two-client revision read failed')
    marker = 'External owner DAV edit verified.'
    local = first['content'].replace(marker, 'Owner platform edit verified.')
    with canonical_operation(owner):
        status, saved = request('PUT', {'content': local, 'etag': first['etag']})
    if status != 200:
        raise ValueError('Platform conditional edit failed')
    conflicting = second['content'].replace(marker, 'Competing overlapping edit.')
    with canonical_operation(owner):
        status, conflict = request('PUT', {'content': conflicting, 'etag': second['etag']})
    if status != 409 or 'conflict' not in conflict:
        raise ValueError('Overlapping stale edit was not rejected')
    with canonical_operation(owner):
        status, resolved = request('PUT', {'content': local + '\nReviewed conflict resolution verified.\n', 'etag': conflict['conflict']['etag']})
    if status != 200:
        raise ValueError('Fresh-revision manual conflict resolution failed')
    refresh_project(project, owner)
    note.refresh_from_db()
    if 'Reviewed conflict resolution verified.' not in note.body:
        raise ValueError('Resolved note did not persist')
    outsiders = [u for u in project.workspace.memberships.select_related('user') if u.user_id != owner.pk and not can_view(u.user, project)]
    if not outsiders:
        raise ValueError('No existing outsider available to verify private project isolation')
    denied = factory.get(url); denied.user = outsiders[0].user
    if project_file_content(denied, project.pk).status_code != 403:
        raise ValueError('Private project outsider access was not denied')
    overview = factory.get('/api/operating/work-reports/overview/'); overview.user = owner
    overview_status = report_overview_api(overview).status_code
    question = 'Summarize the existing Pulsar implementation sources in this project and distinguish implemented behavior from remaining operational acceptance.'
    synthesis = factory.post('/api/platform/ai/ask/', json.dumps({'question': question, 'surface': 'research', 'project_id': project.pk, 'thread_id': 'primary'}), content_type='application/json')
    synthesis.user = owner
    answer = assistant_ask(synthesis)
    answer_data = json.loads(answer.content)
    provider_verified = answer.status_code == 200 and answer_data.get('provider') not in {None, 'fallback'} and bool(answer_data.get('sources'))
    if provider_verified:
        with canonical_operation(owner):
            output = KnowledgeResource.objects.filter(project=project, metadata__acceptance_key='operational-pulsar-synthesis-v1').first()
            if output is None:
                output = KnowledgeResource.objects.create(workspace=project.workspace, project=project, owner=owner, kind='note',
                    title='Pulsar source synthesis · operational acceptance',
                    body='# Pulsar synthesis of existing implementation\n\nSuggested by Pulsar; acceptance output, not a task-completion decision.\n\n' + answer_data['answer'],
                    metadata={'acceptance_key': 'operational-pulsar-synthesis-v1', 'pulsar_run_id': answer_data.get('run_id'), 'sources': answer_data['sources']})
                policy_for(output, create=True, created_by=owner, default_visibility='inherit')
    result = {'project_id': project.pk, 'canonical_adoption': True, 'global_adoption_enabled': bool(settings.GRAVITAS_CANONICAL_ADOPTION_ENABLED),
        'existing_domain_ids_preserved': True, 'native_acl_stale_snapshots_rejected': True, 'native_acl_service_boundary_status': boundary_status, 'owner_native_markdown_read': True, 'canonical_files_verified': CanonicalFile.objects.filter(project=project, deleted=False).count(),
        'external_owner_dav_edit_imported': True, 'overlapping_conflict_rejected': True, 'manual_resolution_persisted': True,
        'private_outsider_denied': True, 'manager_overview_status': overview_status,
        'pending_owner_reports': DailyWorkReport.objects.filter(user=owner, status='pending').count(),
        'browser_acceptance_complete': False, 'telegram_human_confirmation_complete': False, 'task_reconciliation': task_results,
        'telegram_owner_checkin': telegram_delivery,
        'pulsar_provider_synthesis_verified': provider_verified, 'pulsar_http_status': answer.status_code,
        'pulsar_source_count': len(answer_data.get('sources') or [])}
    temporary = receipt.with_suffix('.tmp')
    with temporary.open('w') as handle:
        json.dump(result, handle); handle.flush(); os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, receipt)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
