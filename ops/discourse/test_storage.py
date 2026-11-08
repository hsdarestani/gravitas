import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


def storage():
    spec=importlib.util.spec_from_file_location('graviquest_storage',Path(__file__).with_name('storage.py'))
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


class StorageIsolationTests(unittest.TestCase):
    def test_s3_connection_preserves_existing_sso_and_mail_credentials(self):
        app=storage()
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); app.BASE=root; app.FORUM_CONFIG=root/'forum.json'
            existing={'GRAVITAS_DISCOURSE_CONNECT_SECRET':'unchanged-sso','DISCOURSE_SMTP_PASSWORD':'unchanged-mail'}
            app.FORUM_CONFIG.write_text(json.dumps(existing))
            (root/'credentials.json').write_text(json.dumps({'forum':{'access_key':'own-test-key','secret_key':'own-test-secret'}}))
            (root/'acceptance.json').write_text('{"private_denial_verified":true}')
            app.connect()
            actual=json.loads(app.FORUM_CONFIG.read_text())
            self.assertEqual({key:actual[key] for key in existing},existing)
            self.assertEqual(actual['DISCOURSE_S3_ENDPOINT'],'https://forum.graviquest.com')
            self.assertEqual(app.FORUM_CONFIG.stat().st_mode&0o777,0o600)

    def test_invalid_nginx_change_restores_previous_forum_and_storage_routes(self):
        app=storage()
        with tempfile.TemporaryDirectory() as folder:
            app.NGINX=Path(folder)
            for directory in ['sites-available','sites-enabled','snippets']:(app.NGINX/directory).mkdir()
            site=app.NGINX/'sites-available/graviquest-forum'
            old='# Managed GraviQuest Discourse\nserver { listen 80; }\n'; site.write_text(old)
            link=app.NGINX/'sites-enabled/graviquest-forum'; link.symlink_to(site)
            snippet=app.NGINX/'snippets/graviquest-storage.conf'; snippet.write_text('previous storage routes')
            with patch.object(app,'command',side_effect=[subprocess.CalledProcessError(1,['nginx','-t']),None]):
                with self.assertRaises(RuntimeError): app.nginx(True)
            self.assertEqual(site.read_text(),old)
            self.assertEqual(snippet.read_text(),'previous storage routes')
            self.assertEqual(link.resolve(),site)

    def test_unmanaged_vhost_is_rejected_before_mutation(self):
        app=storage()
        with tempfile.TemporaryDirectory() as folder:
            app.NGINX=Path(folder)
            site=app.NGINX/'sites-available/graviquest-forum';site.parent.mkdir()
            site.write_text('# unrelated operator configuration')
            with self.assertRaises(AssertionError): app.nginx(True)
            self.assertEqual(site.read_text(),'# unrelated operator configuration')
