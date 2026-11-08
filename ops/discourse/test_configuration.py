import importlib.util
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent


def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


class DeploymentIsolationTests(unittest.TestCase):
    def test_official_container_is_pinned_and_database_is_isolated(self):
        env = {key:'test-value' for key in ['DISCOURSE_HOSTNAME','DISCOURSE_DEVELOPER_EMAILS',
            'DISCOURSE_SMTP_ADDRESS','DISCOURSE_SMTP_USER_NAME','DISCOURSE_SMTP_PASSWORD',
            'DISCOURSE_NOTIFICATION_EMAIL','GRAVITAS_DISCOURSE_CONNECT_SECRET']}
        data = module('render_config').configuration(env)
        self.assertEqual(data['expose'], ['127.0.0.1:18880:80'])
        self.assertEqual(len(data['params']['version']),40)
        self.assertEqual(data['params']['db_synchronous_commit'],'on')
        self.assertIn('--memory=3g',data['docker_args'])
        self.assertTrue(all(v['volume']['host'].startswith('/var/discourse/shared/graviquest') for v in data['volumes']))
        self.assertNotIn('DISCOURSE_DB_HOST',data['env'])

    def test_incomplete_environment_fails_closed(self):
        with self.assertRaises(ValueError):
            module('render_config').configuration({})

    def test_existing_operator_secrets_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'forum.json'; path.write_text('{"existing":"unchanged"}')
            result=module('prepare_environment').prepare(path,Path(directory)/'backend.env',['admin@example.com'])
            self.assertEqual(result,{'existing':'unchanged'})
            self.assertEqual(path.read_text(),'{"existing":"unchanged"}')

    def test_mail_reuse_keeps_password_characters_without_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'backend.env'
            path.write_text("EMAIL_HOST_PASSWORD='test-$literal-#-$(not-a-command)'\nEMAIL_HOST_USER=mail@example.com\n")
            config=module('prepare_environment').prepare(Path(directory)/'forum.json',path,['admin@example.com'])
            self.assertEqual(config['DISCOURSE_SMTP_PASSWORD'],'test-$literal-#-$(not-a-command)')
            self.assertEqual(config['DISCOURSE_DEVELOPER_EMAILS'],'admin@example.com')
            self.assertEqual(config['DISCOURSE_SMTP_OPENSSL_VERIFY_MODE'],'peer')


if __name__ == '__main__':
    unittest.main()
