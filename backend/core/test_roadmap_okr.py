import json
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import WorkspaceMembership
from .operating_models import KeyResult, StrategicObjective
from .roadmap_okr import parse_roadmap_okr, sync_workspace_okr
from .roadmap_models import RoadmapOKRSyncState


def _roadmap_fixture(suffix=''):
    cards = [
        ('O1 — Content engine', 'Repeatable English science content.'),
        ('O2 — Active community', 'People return and take meaningful actions.'),
        ('O3 — Revenue model', 'Prove willingness to pay.'),
        ('O4 — Operating system', 'Build a data-driven operating system.'),
    ]
    keys = [
        ('ساختن موتور محتوایی قابل‌تشخیص و تکرار', 'Build a recognizable content engine'),
        ('تبدیل مخاطب گذری به جامعه‌ای فعال', 'Turn viewers into an active community'),
        ('اعتبارسنجی مدل درآمدی', 'Validate the revenue model'),
        ('ساختن سیستم اجرایی مبتنی بر داده', 'Build a data-driven operating system'),
    ]
    card_js = ','.join(
        '{ title: %s, text: %s }' % (json.dumps(title), json.dumps(text))
        for title, text in cards
    )
    parts = [
        'const EN = {',
        '%s: { cards: [%s] },' % (
            json.dumps('چهار نتیجه‌ای که باید تا پایان ماه ششم ثابت شوند', ensure_ascii=False),
            card_js,
        ),
    ]
    for objective_index, (source_key, title) in enumerate(keys, start=1):
        bullets = []
        for kr_index in range(1, 9):
            if kr_index == 1:
                bullets.append(f'{10 * objective_index} measurable outputs{suffix}')
            elif kr_index == 2:
                bullets.append(f'Improve quality by {10 + objective_index}%{suffix}')
            else:
                bullets.append(f'{kr_index} roadmap outcome {objective_index}.{kr_index}{suffix}')
        parts.append(
            '%s: { title: %s, bullets: [%s] },' % (
                json.dumps(source_key, ensure_ascii=False),
                json.dumps(title),
                ','.join(json.dumps(item) for item in bullets),
            )
        )
    parts.append('};')
    return '\n'.join(parts)


@override_settings(
    GRAVITAS_DEFAULT_QUOTA_BYTES=1024 * 1024 * 100,
    GRAVITAS_MAX_UPLOAD_BYTES=1024 * 1024 * 10,
    SECURE_SSL_REDIRECT=False,
)
class RoadmapOKRSyncTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username='admin@example.com', email='admin@example.com', password='test-pass-123'
        )
        self.member = User.objects.create_user(
            username='member@example.com', email='member@example.com', password='test-pass-123'
        )
        self.researcher = User.objects.create_user(
            username='researcher@example.com', email='researcher@example.com', password='test-pass-123'
        )
        self.client.force_login(self.admin)
        bootstrap = self.client.get('/api/platform/bootstrap/').json()
        self.core_id = bootstrap['workspaces']['core']['id']
        WorkspaceMembership.objects.create(workspace_id=self.core_id, user=self.member, role='member')

    def test_parser_reads_four_objectives_and_32_key_results(self):
        parsed = parse_roadmap_okr(_roadmap_fixture())
        self.assertEqual([item['key'] for item in parsed], ['O1', 'O2', 'O3', 'O4'])
        self.assertEqual(sum(len(item['key_results']) for item in parsed), 32)
        self.assertEqual(parsed[0]['title'], 'O1 · Content engine')

    def test_sync_is_idempotent_and_does_not_touch_manual_okrs(self):
        core = self.admin.gravitas_workspace_memberships.get(workspace_id=self.core_id).workspace
        manual = StrategicObjective.objects.create(
            workspace=core,
            title='Manual objective',
            description='Keep me',
            owner=self.admin,
        )
        first = sync_workspace_okr(core, actor=self.admin, source_text=_roadmap_fixture())
        self.assertEqual(first['created_objectives'], 4)
        self.assertEqual(first['created_key_results'], 32)
        self.assertEqual(StrategicObjective.objects.filter(workspace=core).count(), 5)
        self.assertEqual(KeyResult.objects.filter(objective__workspace=core).count(), 32)

        state = RoadmapOKRSyncState.objects.get(workspace=core)
        kr_id = state.bindings['key_results']['O1-KR1']
        kr = KeyResult.objects.get(pk=kr_id)
        kr.current_value = Decimal('7')
        kr.owner = self.member
        kr.save(update_fields=['current_value', 'owner'])

        second = sync_workspace_okr(core, actor=self.admin, source_text=_roadmap_fixture(' updated'))
        self.assertEqual(second['created_objectives'], 0)
        self.assertEqual(second['created_key_results'], 0)
        self.assertEqual(StrategicObjective.objects.filter(workspace=core).count(), 5)
        self.assertEqual(KeyResult.objects.filter(objective__workspace=core).count(), 32)
        self.assertTrue(StrategicObjective.objects.filter(pk=manual.pk, title='Manual objective').exists())

        kr.refresh_from_db()
        self.assertEqual(kr.current_value, Decimal('7'))
        self.assertEqual(kr.owner_id, self.member.pk)
        self.assertIn('updated', kr.title)

    def test_manual_planning_override_survives_sync_and_can_be_resumed(self):
        core = self.admin.gravitas_workspace_memberships.get(workspace_id=self.core_id).workspace
        sync_workspace_okr(core, actor=self.admin, source_text=_roadmap_fixture())
        bindings = RoadmapOKRSyncState.objects.get(workspace=core).bindings
        objective_id = bindings['objectives']['O1']
        kr_id = bindings['key_results']['O1-KR1']
        other = StrategicObjective.objects.create(
            workspace=core, title='Another destination', owner=self.admin,
        )
        modified_objective = self.client.patch(
            '/api/operating/objectives/%s/' % objective_id,
            data=json.dumps({'title': 'Manager owned objective', 'status': 'archived'}),
            content_type='application/json',
        )
        self.assertEqual(modified_objective.status_code, 200, modified_objective.content)
        modified_kr = self.client.patch(
            '/api/operating/key-results/%s/' % kr_id,
            data=json.dumps({'title': 'Manager owned result', 'objective_id': other.pk,
                             'target_value': '75'}),
            content_type='application/json',
        )
        self.assertEqual(modified_kr.status_code, 200, modified_kr.content)
        sync_workspace_okr(core, actor=self.admin, source_text=_roadmap_fixture(' updated'))
        objective = StrategicObjective.objects.get(pk=objective_id)
        kr = KeyResult.objects.get(pk=kr_id)
        self.assertTrue(objective.source_locked)
        self.assertEqual(objective.title, 'Manager owned objective')
        self.assertEqual(objective.status, 'archived')
        self.assertTrue(kr.source_locked)
        self.assertEqual(kr.title, 'Manager owned result')
        self.assertEqual(kr.objective_id, other.pk)
        self.assertEqual(kr.target_value, Decimal('75'))

        unlocked = self.client.patch(
            '/api/operating/key-results/%s/' % kr_id,
            data=json.dumps({'source_locked': False}), content_type='application/json',
        )
        self.assertEqual(unlocked.status_code, 200, unlocked.content)
        sync_workspace_okr(core, actor=self.admin, source_text=_roadmap_fixture(' return'))
        kr.refresh_from_db()
        self.assertFalse(kr.source_locked)
        self.assertEqual(kr.objective_id, objective_id)
        self.assertIn('return', kr.title)

    @patch('core.roadmap_okr._fetch_source', return_value=_roadmap_fixture())
    def test_strategy_sync_endpoint_auto_imports_for_core(self, fetch_source):
        response = self.client.get('/api/operating/roadmap-sync/')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data['sync']['counts']['objectives'], 4)
        self.assertEqual(data['sync']['counts']['key_results'], 32)
        self.assertTrue(data['can_sync'])
        self.assertEqual(fetch_source.call_count, 1)

        response = self.client.get('/api/operating/roadmap-sync/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(fetch_source.call_count, 1, 'fresh sync state should prevent repeated remote fetches')

    @patch('core.roadmap_okr._fetch_source', return_value=_roadmap_fixture())
    def test_member_can_view_status_but_cannot_force_sync(self, _fetch_source):
        self.client.force_login(self.member)
        response = self.client.get('/api/operating/roadmap-sync/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()['can_sync'])
        response = self.client.post('/api/operating/roadmap-sync/', data='{}', content_type='application/json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error'], 'core_admin_required')

    def test_external_researcher_cannot_access_core_roadmap_sync(self):
        self.client.force_login(self.researcher)
        response = self.client.get('/api/operating/roadmap-sync/')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error'], 'core_workspace_for_internal_team_only')
