import json
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from .models import PulsarRun, PulsarThread
from .pulsar_runtime.harness import PulsarHarness
from .pulsar_runtime.types import ProviderResponse
from .telegram_pulsar import TELEGRAM_THREAD_KEY, _interpret


class FakeGateway:
    def configured(self):
        return True

    def status(self):
        return [{'provider': 'fake', 'configured': True}]

    def complete(self, **kwargs):
        return ProviderResponse(
            text='ok',
            provider='fake',
            model='fake-general',
            latency_ms=5,
            input_tokens=10,
            output_tokens=3,
            estimated_cost_usd=0.001,
        )


class PulsarWeek1ReleaseTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='pulsar-week1@example.test',
            email='pulsar-week1@example.test',
            password='Strong-pass-123!',
        )

    @patch('core.pulsar_api.run_text')
    @patch('core.pulsar_api.configured', return_value=True)
    def test_public_website_routes_through_shared_harness_contract(
        self,
        configured,
        run_text,
    ):
        run_text.return_value = SimpleNamespace(
            text='Public answer',
            provider='fake',
            run_id='public-run-1',
        )
        response = self.client.post(
            '/api/pulsar/ask/',
            json.dumps({
                'message': 'What is Gravitas?',
                'thread_id': 'web-thread-1',
                'locale': 'en',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['ok'])
        self.assertEqual(payload['run_id'], 'public-run-1')
        kwargs = run_text.call_args.kwargs
        self.assertEqual(kwargs['surface'], 'public')
        self.assertEqual(kwargs['skill'], 'public')
        self.assertEqual(kwargs['thread_id'], 'web-thread-1')

    @patch('core.telegram_pulsar.complete')
    @patch('core.telegram_pulsar.configured', return_value=True)
    def test_telegram_uses_explicit_shared_primary_thread(
        self,
        configured,
        complete,
    ):
        complete.return_value = json.dumps({
            'intent': 'chat',
            'reply': 'ok',
            'tasks': [],
        })
        context = {
            'members': [],
            'key_results': [],
            'projects': [],
            'tasks': [],
            'courses': [],
        }
        result = _interpret(self.user, 'hello', context)
        self.assertEqual(result['intent'], 'chat')
        kwargs = complete.call_args.kwargs
        self.assertEqual(kwargs['surface'], 'telegram')
        self.assertEqual(kwargs['skill'], 'project_task')
        self.assertEqual(kwargs['thread_id'], TELEGRAM_THREAD_KEY)
        self.assertEqual(TELEGRAM_THREAD_KEY, 'primary')

    def test_authenticated_surfaces_share_thread_and_run_identity_model(self):
        harness = PulsarHarness(models=FakeGateway())
        first = harness.run_text(
            system='system',
            user='telegram turn',
            surface='telegram',
            skill='project_task',
            operation='chat',
            thread_id='primary',
            actor=self.user,
        )
        second = harness.run_text(
            system='system',
            user='core turn',
            surface='core',
            skill='project_task',
            operation='chat',
            thread_id='primary',
            actor=self.user,
        )

        self.assertNotEqual(first.run_id, second.run_id)
        thread = PulsarThread.objects.get(
            user=self.user,
            thread_key='primary',
        )
        self.assertEqual(thread.current_surface, 'core')
        runs = list(
            PulsarRun.objects
            .filter(user=self.user, thread=thread)
            .order_by('created_at')
        )
        self.assertEqual([run.surface for run in runs], ['telegram', 'core'])
        self.assertEqual(
            [run.run_id for run in runs],
            [first.run_id, second.run_id],
        )
        self.assertTrue(all(run.status == PulsarRun.Status.COMPLETED for run in runs))


    def test_workspace_widget_sends_live_surface_and_project_context(self):
        root = Path(settings.BASE_DIR).parent
        api_js = (root / 'assets/ws/ws-api.js').read_text(encoding='utf-8')
        ai_js = (root / 'assets/ws/ws-ai.js').read_text(encoding='utf-8')
        app_js = (root / 'assets/ws/ws-app.js').read_text(encoding='utf-8')

        self.assertIn("if (context.surface) body.surface = context.surface;", api_js)
        self.assertIn("if (context.project_id) body.project_id = context.project_id;", api_js)
        self.assertIn("context.pulsarContext()", ai_js)
        self.assertIn("surface: area === 'core' ? 'core'", app_js)
        self.assertIn("project_id: currentProjectId || undefined", app_js)

    def test_runtime_status_exposes_skill_provider_and_recent_run_contract(self):
        harness = PulsarHarness(models=FakeGateway())
        result = harness.run_text(
            system='system',
            user='status test',
            surface='core',
            skill='project_task',
            operation='chat',
            thread_id='primary',
            actor=self.user,
        )

        self.client.force_login(self.user)
        response = self.client.get('/api/platform/pulsar/runtime-status/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['ok'])
        self.assertIn('providers', payload['runtime'])
        self.assertIn('decision', payload['runtime'])
        self.assertTrue(
            any(row['name'] == 'project_task' for row in payload['runtime']['skills'])
        )
        self.assertEqual(payload['recent_runs'][0]['run_id'], result.run_id)
        self.assertEqual(payload['recent_runs'][0]['surface'], 'core')
        self.assertEqual(
            payload['week1_contract']['authenticated_default_thread'],
            'primary',
        )

    def test_runtime_status_requires_authentication(self):
        response = self.client.get('/api/platform/pulsar/runtime-status/')
        self.assertEqual(response.status_code, 401)

    def test_week1_release_command_passes(self):
        output = StringIO()
        call_command('verify_pulsar_week1', stdout=output)
        self.assertIn('Pulsar Week 1 release contract passed.', output.getvalue())
