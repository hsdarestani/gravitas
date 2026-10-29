"""Protect production Nginx routing against static-only release misclassification."""
import unittest

from release_scope import classify


class ReleaseScopeTests(unittest.TestCase):
    def test_nginx_deploy_changes_require_server_bootstrap(self):
        self.assertEqual(classify(['.github/workflows/deploy.yml']), 'stateful')
        self.assertEqual(
            classify(['.github/workflows/deploy.yml', 'assets/site.css']),
            'stateful',
        )

    def test_regular_static_changes_still_skip_bootstrap(self):
        self.assertEqual(classify(['assets/site.css']), 'static')


if __name__ == '__main__':
    unittest.main()
