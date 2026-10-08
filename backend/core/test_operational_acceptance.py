import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
from django.test import TestCase, override_settings
from django.http import JsonResponse
from . import test_canonical_projects as fixtures
from .models import KnowledgeResource, WorkspaceMembership
from .platform_models import MindMap
from .platform_api import PROJECT_FOLDERS
from . import test_work_reports as report_fixtures


def acceptance_module():
    script = Path(__file__).resolve().parents[2] / 'ops/operational_acceptance.py'
    spec = importlib.util.spec_from_file_location('selected_acceptance', script)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


class OperationalAcceptanceTests(TestCase):
    setUp = fixtures.CanonicalProjectTests.setUp

    @override_settings(GRAVITAS_CANONICAL_ADOPTION_ENABLED=False)
    def test_selected_plan_preserves_sources_and_exercises_external_edit_conflict(self):
        for index in range(5):
            KnowledgeResource.objects.create(workspace=self.project.workspace, project=self.project, owner=self.owner,
                kind='note', title=f'Existing source {index}', body=f'Preserved source {index}', metadata={'canonical_source_key': str(index)})
        MindMap.objects.create(workspace=self.project.workspace, project=self.project, owner=self.owner, title='Pulsar · Existing implementation sources')
        WorkspaceMembership.objects.create(workspace=self.project.workspace, user=self.outsider, role='member')
        source_ids = set(KnowledgeResource.objects.filter(project=self.project).values_list('pk', flat=True))
        identity = SimpleNamespace(username='owner')
        def native(method, url, **kwargs):
            if method == 'PUT':
                saved = self.dav.write(url, kwargs['data'].decode(), kwargs['headers']['If-Match'])
                return SimpleNamespace(status_code=204 if saved else 412)
            return SimpleNamespace(content=self.dav.read(url)['content'].encode(), status_code=200)
        module = acceptance_module()
        with TemporaryDirectory() as directory:
            plan = Path(directory) / 'plan.json'
            plan.write_text(json.dumps({'schema': 1, 'operation': 'accept_selected_existing_project', 'project_id': self.project.pk,
                'expected_title': self.project.title, 'expected_source_notes': 5, 'expected_source_maps': 1}))
            with override_settings(CORE_UPLOAD_ROOT=directory), patch('sys.argv', ['acceptance', '--plan', str(plan), '--apply']), \
                 patch('core.canonical_api.listing', return_value=[{'name': name} for name in [*PROJECT_FOLDERS, 'project.md']]), \
                 patch('core.nextcloud_bridge.ensure_user', return_value=identity), \
                 patch('core.cloud._dav_url', side_effect=lambda identity, path: path), \
                 patch('core.cloud._auth', return_value=('test', 'test')), patch('core.cloud._request', side_effect=native), \
                 patch.object(module, 'verify_native_acl_boundary', return_value=403), patch.object(module, 'reconcile_tasks', return_value={'tested_separately': True}), patch.object(module, 'send_owner_checkin', return_value='tested_separately'), \
                 patch('core.assistant_api.assistant_ask', return_value=JsonResponse({'provider': 'fallback', 'sources': []})):
                module.main()
                evidence = KnowledgeResource.objects.get(project=self.project, metadata__acceptance_key='operational-canonical-acceptance-v1')
                self.assertIn('Reviewed conflict resolution verified.', evidence.body)
                self.assertTrue(source_ids.issubset(set(KnowledgeResource.objects.filter(project=self.project).values_list('pk', flat=True))))
                contents = dict(self.dav.files)
                module.main()
                self.assertEqual(contents, self.dav.files)
            from django.conf import settings
            self.assertFalse(settings.GRAVITAS_CANONICAL_ADOPTION_ENABLED)


class OperationalTaskReconciliationTests(TestCase):
    setUp = report_fixtures.DailyWorkReportTests.setUp

    def test_review_and_skill_dependencies_preserve_pending_execution_and_replay(self):
        from django.contrib.auth import get_user_model
        from .operating_models import OperatingTask, OperatingTaskChecklistItem
        self.other.first_name = 'Sajad'; self.other.save()
        ahmad = get_user_model().objects.create_user('ahmad', first_name='Ahmad')
        core = self.task.workspace
        for user in (self.other, ahmad):
            WorkspaceMembership.objects.create(workspace=core, user=user, role='member')
        self.task.title = 'Document the end-to-end video production workflow through a real Research Project'
        self.task.status = 'blocked'; self.task.priority = 'p0'; self.task.save()
        item = OperatingTaskChecklistItem.objects.create(task=self.task, title='Approved design DONE', is_completed=True, created_by=self.user)
        topic = OperatingTask.objects.create(workspace=core, initiative=self.task.initiative, owner=self.user,
            title='Create a real topic in the platform and test the new structure', due_date=self.task.due_date, status='blocked')
        skill = OperatingTask.objects.create(workspace=core, initiative=self.task.initiative, owner=ahmad,
            title='Build reusable Claude Skill from the approved Video Production workflow', due_date=self.task.due_date, status='draft')
        module = acceptance_module()
        first = module.reconcile_tasks(self.user)
        second = module.reconcile_tasks(self.user)
        self.assertEqual(first, second)
        self.task.refresh_from_db(); topic.refresh_from_db(); skill.refresh_from_db(); item.refresh_from_db()
        self.assertEqual((self.task.status, self.task.dependency_id), ('waiting', skill.pk))
        self.assertEqual((topic.status, topic.dependency_id), ('blocked', first['review_task_id']))
        self.assertEqual((skill.status, skill.priority), ('ready', 'p0'))
        self.assertTrue(item.is_completed)
        review = OperatingTask.objects.get(pk=first['review_task_id'])
        self.assertEqual((review.owner_id, review.status), (self.other.pk, 'ready'))

    def test_real_checkin_targets_only_linked_owner_and_replay_does_not_send(self):
        from .operating_models import TaskNotificationPreference, TaskNotificationOutbox
        TaskNotificationPreference.objects.create(user=self.user, telegram_enabled=True, telegram_chat_id=123456)
        module = acceptance_module()
        with patch('core.task_notifications._send_telegram', return_value='sent') as send:
            self.assertEqual(module.send_owner_checkin(self.user, 'a' * 64), 'sent')
            self.assertEqual(module.send_owner_checkin(self.user, 'a' * 64), 'sent')
        send.assert_called_once()
        row = TaskNotificationOutbox.objects.get(event_key='operational-acceptance:' + 'a' * 32)
        self.assertEqual((row.recipient_id, row.status), (self.user.pk, 'sent'))
        self.assertEqual(module.send_owner_checkin(self.other, 'b' * 64), 'owner_not_connected')


class NativeAclBoundaryTests(TestCase):
    setUp = fixtures.CanonicalProjectTests.setUp

    def test_stale_etag_and_same_etag_old_rules_fail_without_mutation_and_owner_is_denied(self):
        module = acceptance_module()
        snapshot = {'etag': '"v1"', 'rules': [{'type': 'user', 'id': 'service', 'mask': 31, 'permissions': 31}]}
        identity = SimpleNamespace(username='owner')
        with patch('core.canonical_acl.read_acl', return_value=snapshot), patch('core.canonical_acl.write_acl', return_value=None) as write, \
             patch('core.cloud._request', return_value=SimpleNamespace(status_code=403)) as request, patch('core.cloud._auth', return_value=('owner', 'test')):
            self.assertEqual(module.verify_native_acl_boundary(self.project, identity), 403)
        self.assertEqual(write.call_count, 2)
        self.assertNotEqual(write.call_args_list[0].args[2]['etag'], snapshot['etag'])
        self.assertEqual(write.call_args_list[1].args[2], {'etag': '"v1"', 'rules': []})
        self.assertEqual(request.call_args.kwargs['expected'], {403})
        self.assertEqual(request.call_args.kwargs['auth'], ('owner', 'test'))


class ReviewedAclIncidentTests(TestCase):
    setUp = fixtures.CanonicalProjectTests.setUp

    def incident(self):
        import uuid
        from . import cloud
        batch = str(uuid.uuid4()); root = cloud.project_mountpoint(self.project)
        path = root + '/06_Archive/CanonicalTransactions/' + batch + '.json'
        old = {'rules': [{'type': 'group', 'id': 'existing', 'mask': 31, 'permissions': 1}], 'etag': '"before"'}
        desired = [{'type': 'user', 'id': 'service', 'mask': 31, 'permissions': 31}]
        current = {'rules': desired, 'etag': '"written"'}
        manifest = {'schema': 1, 'batch_id': batch, 'project_id': self.project.pk, 'state': 'pending',
            'operations': [{'kind': 'acl', 'path': root, 'before': old, 'rules': desired, 'written': None}]}
        self.dav.write(path, json.dumps(manifest))
        review = {'batch_id': batch, 'resolution': 'restore_previous_root_acl', 'reason': 'Reviewed native representation incident'}
        return path, manifest, review, old, current

    def test_reviewed_single_root_acl_conditionally_rolls_back_and_replays(self):
        from .canonical_models import CanonicalWriteCommit
        path, manifest, review, old, current = self.incident()
        def read(target):
            return {'rules': [dict(r) for r in current['rules']], 'etag': current['etag']}
        def write(target, rules, expected):
            self.assertEqual(expected, current)
            current.update(rules=rules, etag='"restored"')
            return read(target)
        with patch('core.canonical_acl.read_acl', side_effect=read), patch('core.canonical_acl.write_acl', side_effect=write) as update, \
             patch('core.canonical_acl.desired_rules', return_value=current['rules']) as policy, patch('core.nextcloud_bridge._project_root_roles', return_value={}), \
             patch('core.cloud.canonical_native_groups', return_value={}):
            module = acceptance_module()
            self.assertEqual(module.review_selected_root_acl_recovery(self.project, review), 'rolled_back')
            self.assertEqual(module.review_selected_root_acl_recovery(self.project, review), 'already_rolled_back')
        update.assert_called_once()
        self.assertEqual(policy.call_args.args[2], 'specific')
        self.assertEqual(current['rules'], old['rules'])
        saved = json.loads(self.dav.files[path]['content'])
        self.assertEqual(saved['state'], 'rolled_back')
        self.assertTrue(saved['operational_review']['permission_policy_matched'])
        self.assertFalse(CanonicalWriteCommit.objects.exists())

    def test_external_acl_or_additional_file_operations_are_not_reviewed_away(self):
        from .canonical_journal import RecoveryRequired
        path, manifest, review, old, current = self.incident()
        original = self.dav.files[path]['content']
        with patch('core.canonical_acl.read_acl', return_value=old), patch('core.canonical_acl.desired_rules', return_value=current['rules']), \
             patch('core.nextcloud_bridge._project_root_roles', return_value={}), patch('core.cloud.canonical_native_groups', return_value={}), \
             patch('core.canonical_acl.write_acl') as write:
            with self.assertRaises(RecoveryRequired):
                acceptance_module().review_selected_root_acl_recovery(self.project, review)
        write.assert_not_called(); self.assertEqual(self.dav.files[path]['content'], original)
        manifest['operations'].append({'kind': 'put', 'path': 'extra'})
        self.dav.external(path, json.dumps(manifest)); original = self.dav.files[path]['content']
        with self.assertRaises(RecoveryRequired):
            acceptance_module().review_selected_root_acl_recovery(self.project, review)
        self.assertEqual(self.dav.files[path]['content'], original)
