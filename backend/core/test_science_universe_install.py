"""Regression tests for the unpublished Science Universe bundle."""
from io import StringIO
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from core.models import InteractiveLab, LabRevision


SOURCE = Path(__file__).resolve().parents[2] / 'lab-sources' / 'science-universe'


class ScienceUniverseInstallTests(TestCase):
    def setUp(self):
        self.User = get_user_model()
        self.owner = self.User.objects.create_superuser(
            username='science-admin', email='science-admin@example.test', password='test'
        )

    def install(self):
        buffer = StringIO()
        call_command('install_science_universe_lab', '--apply', '--auto-owner',
                     '--source', str(SOURCE), stdout=buffer)
        return buffer.getvalue()

    def test_draft_install_is_idempotent_and_unpublished(self):
        result = self.install()
        self.assertIn('Created Lab Studio draft', result)
        lab = InteractiveLab.objects.get(slug='science-universe')
        self.assertEqual(lab.created_by_id, self.owner.pk)
        self.assertEqual(lab.status, InteractiveLab.Status.DRAFT)
        self.assertEqual(lab.published_version, 0)
        self.assertFalse(lab.studio_enabled)
        self.assertFalse(lab.published_files)
        self.assertEqual(len(lab.files), 4)
        self.assertEqual({x['name'] for x in lab.files},
                         {'index.html', 'app.js', 'engine.js', 'styles.css'})
        self.assertEqual(lab.config['components'], ['stage'])
        self.assertTrue(lab.config['pulsar_enabled'])
        self.assertEqual(len(lab.config['sections']), 7)
        self.assertEqual(lab.topic_slug, '')
        self.assertEqual(LabRevision.objects.filter(lab=lab).count(), 1)

        # Repeat a release: do not overwrite admin changes or accidentally publish.
        lab.title = 'Edited in Studio'
        lab.save(update_fields=['title'])
        self.assertIn('already exists', self.install())
        lab.refresh_from_db()
        self.assertEqual(lab.title, 'Edited in Studio')
        self.assertEqual(LabRevision.objects.filter(lab=lab).count(), 1)

    def test_preview_is_private_and_all_source_files_resolve(self):
        self.install()
        lab = InteractiveLab.objects.get(slug='science-universe')
        self.client.force_login(self.owner)
        base = f'/api/platform/admin/labs/{lab.pk}/preview/'
        html = self.client.get(base)
        self.assertEqual(html.status_code, 200, html.content[:200])
        self.assertIn(b'Science Universe', html.content)
        self.assertIn(b'/assets/lab-bridge.js', html.content)
        self.assertIn("sandbox allow-scripts", html["Content-Security-Policy"])
        self.assertIn("connect-src 'none'", html["Content-Security-Policy"])
        for filename in ['app.js', 'engine.js', 'styles.css']:
            response = self.client.get(base+filename)
            self.assertEqual(response.status_code, 200, (filename, response.content[:300]))
            self.assertGreater(len(response.content), 300)
        self.assertEqual(self.client.get('/api/labs/').json()['labs'], [])
        self.assertEqual(self.client.get('/lab-run/science-universe/').status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(base).status_code, 401)

    def test_dry_run_creates_nothing(self):
        call_command('install_science_universe_lab', '--auto-owner', '--source', str(SOURCE),
                     stdout=StringIO())
        self.assertFalse(InteractiveLab.objects.filter(slug='science-universe').exists())

    def test_no_owner_does_not_create_account_or_lab(self):
        self.owner.delete()
        call_command('install_science_universe_lab', '--apply', '--auto-owner',
                     '--source', str(SOURCE), stdout=StringIO())
        self.assertFalse(InteractiveLab.objects.filter(slug='science-universe').exists())

    def test_non_admin_owner_rejected(self):
        self.User.objects.create_user(username='member', email='member@example.test', password='test')
        from django.core.management.base import CommandError
        with self.assertRaises(CommandError):
            call_command('install_science_universe_lab', '--apply', '--user', 'member@example.test',
                         '--source', str(SOURCE), stdout=StringIO())
