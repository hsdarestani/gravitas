from datetime import date, datetime, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .layer_models import ActivityEvent, ModuleGrant
from .models import KnowledgeResource, ProjectMembership, ResearchProject
from .nextcloud_deck import _pull_card
from .nextcloud_notes import (
    DELETE_DONE_ACTION,
    DELETE_PENDING_ACTION,
    NotesConflict,
    _local_fingerprint,
    _local_payload,
    _split_category,
    clean_folder,
    _remote_fingerprint,
    _snapshot,
    _json,
    _visible_notes_for_user,
    reconcile_notes,
    sync_note_to_nextcloud,
)
from .operating_models import WorkStatus
from .platform_api import ensure_dual_workspaces
from .workspace_api import provision_personal_workspace


class NativeNotesMirrorTests(TestCase):
    def setUp(self):
        self.queue_patcher = patch('core.space_signals._queue_note_sync')
        self.queue_patcher.start()
        self.addCleanup(self.queue_patcher.stop)
        self.user = get_user_model().objects.create_user(
            username='notes-user', email='notes@example.com', password='not-a-real-secret',
        )
        ModuleGrant.objects.update_or_create(
            user=self.user,
            module=ModuleGrant.Module.RESEARCH,
            defaults={
                'enabled': True,
                'access_level': ModuleGrant.AccessLevel.PARTICIPATE,
                'source': ModuleGrant.Source.ADMIN,
            },
        )
        self.workspace = provision_personal_workspace(self.user)

    def note(self, *, title='Local title', body='Local body', space='research'):
        return KnowledgeResource.objects.create(
            workspace=self.workspace,
            owner=self.user,
            kind=KnowledgeResource.Kind.NOTE,
            title=title,
            body=body,
            metadata={
                'ws_space': space,
                'ws_kind': 'note',
                'ws_blocks': [{'id': 'b-1', 'type': 'p', 'text': body}],
            },
        )

    def test_project_member_sees_the_same_canonical_note_in_research_notebook(self):
        member = get_user_model().objects.create_user(
            username='shared-notes-member', email='shared-notes@example.com',
        )
        ModuleGrant.objects.update_or_create(
            user=member,
            module=ModuleGrant.Module.RESEARCH,
            defaults={
                'enabled': True,
                'access_level': ModuleGrant.AccessLevel.PARTICIPATE,
                'source': ModuleGrant.Source.ADMIN,
            },
        )
        research = ensure_dual_workspaces(self.user)['research']
        project = ResearchProject.objects.create(
            workspace=research, owner=self.user, title='Shared animation research',
        )
        ProjectMembership.objects.create(
            project=project, user=self.user, role=ProjectMembership.Role.OWNER,
        )
        ProjectMembership.objects.create(
            project=project, user=member, role=ProjectMembership.Role.VIEWER,
        )
        note = KnowledgeResource.objects.create(
            workspace=research,
            project=project,
            owner=self.user,
            kind=KnowledgeResource.Kind.NOTE,
            title='Storyboard findings',
            body='Project note body',
            metadata={'ws_space': 'research', 'ws_kind': 'note'},
        )

        visible = _visible_notes_for_user(member)
        self.assertIn(note.pk, [item.pk for item in visible])
        payload = _json(note, member)
        self.assertEqual(payload['project_id'], project.pk)
        self.assertEqual(payload['project_title'], project.title)
        self.assertEqual(payload['scope'], 'project')
        self.assertFalse(payload['can_edit'])
        self.assertTrue(payload['readonly'])
        self.assertIsNone(payload['native_url'])

    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    @patch('core.nextcloud_notes._request')
    def test_local_note_creates_native_nextcloud_note_and_mapping(self, request, _ensure):
        resource = self.note()
        remote = {
            'id': 41, 'etag': 'etag-one', 'readonly': False,
            'title': 'Local title', 'content': 'Local body',
            'category': 'Gravitas/Research', 'favorite': False, 'modified': 10,
        }
        request.return_value = (200, remote, {})

        result = sync_note_to_nextcloud(resource)

        self.assertEqual(result['id'], 41)
        resource.refresh_from_db()
        mirror = resource.metadata['nextcloud_notes']
        self.assertEqual(mirror['id'], 41)
        self.assertEqual(mirror['etag'], 'etag-one')
        self.assertEqual(mirror['state'], 'synced')
        self.assertEqual(request.call_args.args[:2], ('POST', '/notes'))
        self.assertEqual(request.call_args.kwargs['body']['category'], 'Gravitas/Research')

    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    @patch('core.nextcloud_notes._request')
    def test_remote_only_edit_is_pulled_into_gravitas(self, request, _ensure):
        resource = self.note()
        original_remote = {
            'id': 52, 'etag': 'etag-a', 'readonly': False,
            'title': resource.title, 'content': resource.body,
            'category': 'Gravitas/Research', 'favorite': False, 'modified': 10,
        }
        metadata = dict(resource.metadata)
        metadata['nextcloud_notes'] = _snapshot(original_remote, _local_fingerprint(resource))
        KnowledgeResource.objects.filter(pk=resource.pk).update(metadata=metadata)
        resource.metadata = metadata

        changed_remote = dict(original_remote, etag='etag-b', title='Edited in Nextcloud', content='Native markdown', modified=20)
        request.return_value = (200, changed_remote, {})

        sync_note_to_nextcloud(resource)

        resource.refresh_from_db()
        self.assertEqual(resource.title, 'Edited in Nextcloud')
        self.assertEqual(resource.body, 'Native markdown')
        self.assertEqual(resource.metadata['nextcloud_notes']['etag'], 'etag-b')
        self.assertEqual(resource.metadata['nextcloud_notes']['state'], 'synced')

    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    @patch('core.nextcloud_notes._request')
    def test_concurrent_note_edits_become_conflict_without_overwrite(self, request, _ensure):
        resource = self.note()
        original_remote = {
            'id': 63, 'etag': 'etag-a', 'readonly': False,
            'title': resource.title, 'content': resource.body,
            'category': 'Gravitas/Research', 'favorite': False, 'modified': 10,
        }
        metadata = dict(resource.metadata)
        metadata['nextcloud_notes'] = _snapshot(original_remote, _local_fingerprint(resource))
        KnowledgeResource.objects.filter(pk=resource.pk).update(metadata=metadata)
        resource.metadata = metadata

        resource.body = 'Changed in Gravitas'
        resource.metadata = dict(resource.metadata)
        resource.metadata['ws_blocks'] = [{'id': 'b-1', 'type': 'p', 'text': resource.body}]
        resource.save(update_fields=['body', 'metadata', 'updated_at'])
        changed_remote = dict(original_remote, etag='etag-b', content='Changed in Nextcloud', modified=20)
        request.return_value = (200, changed_remote, {})

        with self.assertRaises(NotesConflict):
            sync_note_to_nextcloud(resource)

        resource.refresh_from_db()
        self.assertEqual(resource.body, 'Changed in Gravitas')
        self.assertEqual(resource.metadata['nextcloud_notes']['state'], 'conflict')
        self.assertEqual(resource.metadata['nextcloud_notes']['remote_fingerprint'], _remote_fingerprint(changed_remote))
        self.assertEqual(request.call_count, 1, 'conflict detection must not PUT over either side')

    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    @patch('core.nextcloud_notes._list_remote')
    def test_only_gravitas_categories_are_adopted_from_native_notes(self, list_remote, _ensure):
        list_remote.return_value = [
            {
                'id': 70, 'etag': 'a', 'readonly': False, 'title': 'Research native',
                'content': '# Research', 'category': 'Gravitas/Research', 'favorite': True, 'modified': 1,
            },
            {
                'id': 71, 'etag': 'b', 'readonly': False, 'title': 'Private native',
                'content': 'personal', 'category': 'Personal', 'favorite': False, 'modified': 1,
            },
        ]

        result = reconcile_notes(self.user)

        self.assertEqual(result['counts']['adopted'], 1)
        adopted = KnowledgeResource.objects.get(owner=self.user, title='Research native')
        self.assertEqual(adopted.metadata['ws_space'], 'research')
        self.assertTrue(adopted.metadata['ws_bookmarked'])
        self.assertFalse(KnowledgeResource.objects.filter(owner=self.user, title='Private native').exists())

    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    @patch('core.nextcloud_notes._list_remote')
    def test_remote_notes_are_adopted_only_for_entitled_layers(self, list_remote, _ensure):
        User = get_user_model()
        member = User.objects.create_user(username='plain-member', email='plain@example.com')
        provision_personal_workspace(member)
        list_remote.return_value = [
            {'id': 80, 'etag': 'a', 'readonly': False, 'title': 'Core native', 'content': '', 'category': 'Gravitas/Core', 'favorite': False, 'modified': 1},
            {'id': 81, 'etag': 'b', 'readonly': False, 'title': 'Research native', 'content': '', 'category': 'Gravitas/Research', 'favorite': False, 'modified': 1},
            {'id': 82, 'etag': 'c', 'readonly': False, 'title': 'Learning native', 'content': '', 'category': 'Gravitas/Learning', 'favorite': False, 'modified': 1},
        ]

        result = reconcile_notes(member)

        self.assertEqual(result['counts']['adopted'], 1)
        self.assertTrue(KnowledgeResource.objects.filter(owner=member, title='Learning native').exists())
        self.assertFalse(KnowledgeResource.objects.filter(owner=member, title='Research native').exists())
        self.assertFalse(KnowledgeResource.objects.filter(owner=member, title='Core native').exists())

    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    @patch('core.nextcloud_notes._request')
    def test_remote_deletion_becomes_conflict_instead_of_recreating_note(self, request, _ensure):
        resource = self.note()
        original_remote = {
            'id': 90, 'etag': 'etag-a', 'readonly': False,
            'title': resource.title, 'content': resource.body,
            'category': 'Gravitas/Research', 'favorite': False, 'modified': 10,
        }
        metadata = dict(resource.metadata)
        metadata['nextcloud_notes'] = _snapshot(original_remote, _local_fingerprint(resource))
        KnowledgeResource.objects.filter(pk=resource.pk).update(metadata=metadata)
        resource.metadata = metadata
        request.return_value = (404, None, {})

        with self.assertRaises(NotesConflict):
            sync_note_to_nextcloud(resource)

        resource.refresh_from_db()
        self.assertEqual(resource.metadata['nextcloud_notes']['state'], 'conflict')
        self.assertEqual(resource.metadata['nextcloud_notes']['error'], 'deleted_in_nextcloud')
        self.assertEqual(request.call_args.args[:2], ('GET', '/notes/90'))
        self.assertEqual(request.call_count, 1)

    @patch('core.nextcloud_notes._delete_remote', return_value=True)
    @patch('core.nextcloud_notes._list_remote')
    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    def test_legacy_local_delete_uses_tombstone_and_never_readopts_remote_note(self, _ensure, list_remote, delete_remote):
        resource = self.note()
        remote = {
            'id': 91, 'etag': 'etag-a', 'readonly': False,
            'title': resource.title, 'content': resource.body,
            'category': 'Gravitas/Research', 'favorite': False, 'modified': 10,
        }
        metadata = dict(resource.metadata)
        metadata['nextcloud_notes'] = _snapshot(remote, _local_fingerprint(resource))
        KnowledgeResource.objects.filter(pk=resource.pk).update(metadata=metadata)
        resource.metadata = metadata
        resource.delete()
        self.assertTrue(ActivityEvent.objects.filter(action=DELETE_PENDING_ACTION, object_id='91').exists())
        list_remote.return_value = [remote]

        result = reconcile_notes(self.user)

        delete_remote.assert_called_once()
        self.assertEqual(result['counts']['deleted'], 1)
        self.assertFalse(KnowledgeResource.objects.filter(owner=self.user, title='Local title').exists())
        self.assertTrue(ActivityEvent.objects.filter(action=DELETE_DONE_ACTION, object_id='91').exists())

    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    @patch('core.nextcloud_notes._get_remote', return_value=None)
    def test_user_can_accept_native_deletion_to_resolve_conflict(self, _get_remote, _ensure):
        resource = self.note()
        remote = {
            'id': 92, 'etag': 'etag-a', 'readonly': False,
            'title': resource.title, 'content': resource.body,
            'category': 'Gravitas/Research', 'favorite': False, 'modified': 10,
        }
        metadata = dict(resource.metadata)
        metadata['nextcloud_notes'] = _snapshot(remote, _local_fingerprint(resource), state='conflict', error='deleted_in_nextcloud')
        KnowledgeResource.objects.filter(pk=resource.pk).update(metadata=metadata)
        self.client.force_login(self.user)

        response = self.client.post(
            f'/api/platform/nextcloud/notes/{resource.pk}/resolve/',
            data='{"winner":"nextcloud"}',
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()['deleted'])
        self.assertFalse(KnowledgeResource.objects.filter(pk=resource.pk).exists())

    def test_native_notes_api_requires_authentication(self):
        response = self.client.get('/api/platform/nextcloud/notes/')
        self.assertEqual(response.status_code, 401)

    def test_folder_paths_are_cleaned_and_split_from_native_categories(self):
        self.assertEqual(clean_folder(' Thesis / ../Chapter 1//. '), 'Thesis/Chapter 1')
        self.assertEqual(clean_folder('a\\b'), 'a/b')
        self.assertEqual(clean_folder(''), '')
        self.assertEqual(_split_category('Gravitas/Research'), ('research', ''))
        self.assertEqual(_split_category('Gravitas/Research/Thesis/Ch 1'), ('research', 'Thesis/Ch 1'))
        self.assertEqual(_split_category('Gravitas/Researchers'), (None, ''))
        self.assertEqual(_split_category('Personal'), (None, ''))

    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    @patch('core.nextcloud_notes._request')
    def test_folder_is_the_native_subcategory(self, request, _ensure):
        resource = self.note()
        resource.metadata = dict(resource.metadata, ws_folder='Thesis/Chapter 1')
        resource.save(update_fields=['metadata'])
        request.return_value = (200, {
            'id': 43, 'etag': 'e', 'readonly': False, 'title': 'Local title', 'content': 'Local body',
            'category': 'Gravitas/Research/Thesis/Chapter 1', 'favorite': False, 'modified': 10,
        }, {})

        sync_note_to_nextcloud(resource)

        self.assertEqual(request.call_args.kwargs['body']['category'], 'Gravitas/Research/Thesis/Chapter 1')
        self.assertEqual(_json(resource, self.user)['folder'], 'Thesis/Chapter 1')

    def test_a_note_without_a_folder_keeps_its_fingerprint(self):
        # Adding folders must not make every existing note look edited and
        # push it to Nextcloud again.
        resource = self.note()
        self.assertEqual(_local_payload(resource)['category'], 'Gravitas/Research')

    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    @patch('core.nextcloud_notes._request')
    def test_a_note_moved_between_folders_in_nextcloud_moves_here(self, request, _ensure):
        resource = self.note()
        original = {
            'id': 53, 'etag': 'etag-a', 'readonly': False, 'title': resource.title, 'content': resource.body,
            'category': 'Gravitas/Research', 'favorite': False, 'modified': 10,
        }
        metadata = dict(resource.metadata)
        metadata['nextcloud_notes'] = _snapshot(original, _local_fingerprint(resource))
        KnowledgeResource.objects.filter(pk=resource.pk).update(metadata=metadata)
        resource.metadata = metadata
        request.return_value = (200, dict(original, etag='etag-b', category='Gravitas/Research/Reading'), {})

        sync_note_to_nextcloud(resource)

        resource.refresh_from_db()
        self.assertEqual(resource.metadata['ws_folder'], 'Reading')
        self.assertEqual(resource.metadata['ws_space'], 'research')

    @patch('core.nextcloud_notes.ensure_user', return_value=object())
    @patch('core.nextcloud_notes._list_remote')
    def test_native_subfolders_are_adopted_into_their_folder(self, list_remote, _ensure):
        list_remote.return_value = [{
            'id': 72, 'etag': 'a', 'readonly': False, 'title': 'Filed natively',
            'content': '', 'category': 'Gravitas/Research/Reading/2026', 'favorite': False, 'modified': 1,
        }]

        reconcile_notes(self.user)

        adopted = KnowledgeResource.objects.get(owner=self.user, title='Filed natively')
        self.assertEqual(adopted.metadata['ws_folder'], 'Reading/2026')

    @patch('core.nextcloud_notes.sync_note_to_nextcloud')
    def test_a_day_is_one_note_however_often_it_is_opened(self, _sync):
        self.client.force_login(self.user)
        body = '{"title":"Sat, 10 Oct 2026","kind":"journal","journal_date":"2026-10-10","space":"research"}'

        first = self.client.post('/api/platform/nextcloud/notes/', data=body, content_type='application/json')
        second = self.client.post('/api/platform/nextcloud/notes/', data=body, content_type='application/json')

        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 200, second.content)
        self.assertTrue(second.json()['existing'])
        self.assertEqual(first.json()['item']['id'], second.json()['item']['id'])
        item = first.json()['item']
        self.assertEqual((item['kind'], item['journal_date'], item['folder']), ('journal', '2026-10-10', 'Journal'))
        self.assertEqual(KnowledgeResource.objects.filter(owner=self.user, metadata__ws_journal_date='2026-10-10').count(), 1)

    @patch('core.nextcloud_notes.sync_note_to_nextcloud')
    def test_a_day_page_from_the_old_editor_is_reused(self, _sync):
        legacy = self.note(title='Fri, 9 Oct 2026')
        legacy.metadata = dict(legacy.metadata, ws_kind='journal', ws_journal_date='2026-10-09')
        legacy.save(update_fields=['metadata'])
        self.client.force_login(self.user)

        response = self.client.post(
            '/api/platform/nextcloud/notes/',
            data='{"title":"Fri, 9 Oct 2026","kind":"journal","journal_date":"2026-10-09"}',
            content_type='application/json',
        )

        self.assertEqual(response.json()['item']['id'], legacy.pk)

    @patch('core.nextcloud_notes.sync_note_to_nextcloud')
    def test_an_invalid_day_is_refused(self, _sync):
        self.client.force_login(self.user)
        response = self.client.post(
            '/api/platform/nextcloud/notes/',
            data='{"title":"x","kind":"journal","journal_date":"2026-02-30"}',
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    @patch('core.nextcloud_notes.sync_note_to_nextcloud')
    def test_notes_are_filed_and_unfiled_by_patch(self, _sync):
        resource = self.note()
        self.client.force_login(self.user)
        url = f'/api/platform/nextcloud/notes/{resource.pk}/'

        filed = self.client.patch(url, data='{"folder":"Reading / Papers"}', content_type='application/json')
        self.assertEqual(filed.json()['item']['folder'], 'Reading/Papers')
        unfiled = self.client.patch(url, data='{"folder":""}', content_type='application/json')
        self.assertEqual(unfiled.json()['item']['folder'], '')
        resource.refresh_from_db()
        self.assertNotIn('ws_folder', resource.metadata)


class DeckBidirectionalMirrorTests(TestCase):
    def task(self, *, updated_at, status=WorkStatus.ACTIVE, title='Local task', due_date=date(2026, 9, 20), cycle_id=1):
        task = SimpleNamespace(
            pk=9,
            title=title,
            status=status,
            due_date=due_date,
            cycle_id=cycle_id,
            updated_at=updated_at,
            completed_at=None,
        )
        task.save = MagicMock()
        return task

    def current(self, task, *, stack='Active', title='Local task', due='2026-09-20T17:00:00+00:00', marker=None, modified=0):
        marker = task.updated_at.timestamp() if marker is None else marker
        return {
            'stack_title': stack,
            'stack_id': 2,
            'card': {
                'id': 88,
                'title': title,
                'duedate': due,
                'lastModified': modified,
                'description': f'<!-- gravitas-task:9 -->\n<!-- gravitas-task-updated:{marker:.6f} -->',
            },
        }

    def test_richer_states_survive_a_newer_legacy_backlog_metadata_edit(self):
        from .nextcloud_deck import _stack_for_task
        changed_at = datetime(2026, 9, 14, 12, 0, tzinfo=dt_timezone.utc)
        for status, lane in [(WorkStatus.READY, 'Ready'), (WorkStatus.WAITING, 'Waiting on owner'), (WorkStatus.REVIEW, 'Needs review'), (WorkStatus.RETEST, 'Acceptance retest')]:
            with self.subTest(status=status):
                task = self.task(updated_at=changed_at, status=status)
                current = self.current(task, stack='Backlog', title='Edited in Deck', modified=changed_at.timestamp() + 30)
                self.assertEqual(_pull_card(task, current), 'pulled')
                self.assertEqual(task.title, 'Edited in Deck')
                self.assertEqual(task.status, status)
                self.assertEqual(_stack_for_task(task), lane)
                self.assertEqual(_pull_card(task, self.current(task, stack=lane, title=task.title, modified=changed_at.timestamp()+60)), 'unchanged')
                self.assertEqual(_pull_card(task, self.current(task, stack='Done', title=task.title, modified=changed_at.timestamp()+90)), 'pulled')
                self.assertEqual(task.status, WorkStatus.DONE)

    def test_newer_deck_execution_state_is_pulled_when_local_is_unchanged(self):
        changed_at = datetime(2026, 9, 14, 12, 0, tzinfo=dt_timezone.utc)
        task = self.task(updated_at=changed_at)
        current = self.current(
            task,
            stack='Done',
            title='Renamed in Deck',
            due='2026-09-22T17:00:00+00:00',
            modified=changed_at.timestamp() + 30,
        )

        result = _pull_card(task, current)

        self.assertEqual(result, 'pulled')
        self.assertEqual(task.title, 'Renamed in Deck')
        self.assertEqual(task.status, WorkStatus.DONE)
        self.assertEqual(task.due_date, date(2026, 9, 22))
        self.assertIsNotNone(task.completed_at)
        task.save.assert_called_once()

    def test_newer_deck_edit_wins_when_both_sides_changed(self):
        changed_at = datetime(2026, 9, 14, 12, 5, tzinfo=dt_timezone.utc)
        task = self.task(updated_at=changed_at, title='Changed in Gravitas')
        previous_push = changed_at.timestamp() - 60
        current = self.current(
            task,
            title='Changed in Deck',
            marker=previous_push,
            modified=changed_at.timestamp() + 30,
        )

        result = _pull_card(task, current)

        self.assertEqual(result, 'pulled')
        self.assertEqual(task.title, 'Changed in Deck')
        task.save.assert_called_once()

    def test_newer_gravitas_edit_wins_when_both_sides_changed(self):
        changed_at = datetime(2026, 9, 14, 12, 5, tzinfo=dt_timezone.utc)
        task = self.task(updated_at=changed_at, title='Changed in Gravitas')
        previous_push = changed_at.timestamp() - 60
        current = self.current(
            task,
            title='Changed in Deck',
            marker=previous_push,
            modified=changed_at.timestamp() - 30,
        )

        result = _pull_card(task, current)

        self.assertEqual(result, 'local_newer')
        self.assertEqual(task.title, 'Changed in Gravitas')
        task.save.assert_not_called()

    def test_deck_cannot_clear_last_due_date_without_cycle(self):
        changed_at = datetime(2026, 9, 14, 12, 0, tzinfo=dt_timezone.utc)
        task = self.task(updated_at=changed_at, cycle_id=None)
        current = self.current(task, due=None, modified=changed_at.timestamp() + 10)

        result = _pull_card(task, current)

        self.assertEqual(result, 'unchanged')
        self.assertEqual(task.due_date, date(2026, 9, 20))
        task.save.assert_not_called()
