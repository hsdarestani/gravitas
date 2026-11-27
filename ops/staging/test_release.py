import tempfile
import unittest
from pathlib import Path

from public_pages import prepare
from release_gate import CI, STAGING, acceptance, approved_environment, verified_run
from site_config import render


class StagingPublicRoutes(unittest.TestCase):
    def test_only_allowlisted_files_are_exported(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'lab.html').write_text('<html><body>Lab</body></html>')
            (root / 'private.html').write_text('private')
            (root / '.env').write_text('fixture')
            prepare(root)
            directory = root / '.staging-public'
            self.assertEqual({p.name for p in directory.iterdir()}, {'robots.txt', 'lab.html'})
            self.assertIn('aria-label="Environment"', (directory / 'lab.html').read_text())
            self.assertIn('Disallow: /', (directory / 'robots.txt').read_text())

    def test_staging_forum_route_cannot_redirect_to_the_production_forum(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            production = 'https://forum.graviquest.com'
            (root / 'forum.html').write_text(f'<script>location.replace("{production}")</script>')
            (root / 'index.html').write_text(f'<head></head><body><a href="{production}/t/1">Forum</a></body>')
            prepare(root)
            forum = (root / '.staging-public/forum.html').read_text()
            homepage = (root / '.staging-public/index.html').read_text()
            self.assertNotIn(production, forum)
            self.assertNotIn(production, homepage)
            self.assertIn('href="/forum.html"', homepage)
            self.assertIn('Content-Security-Policy', homepage)

    def test_switch_and_rollback_preserve_staging_api_and_nextcloud_routes(self):
        original = (
            'server {\n    server_name staging.graviquest.com;\n    root /previous;\n'
            '    location /nextcloud/ { proxy_pass http://127.0.0.1:18081/; }\n'
            '    location /api/ { proxy_pass http://127.0.0.1:18000; }\n'
            '    location / { return 404; }\n}\n'
        )
        deployed = render(original, '/previous', '/new')
        self.assertIn('root /new;', deployed)
        self.assertIn('location = /lab.html', deployed)
        result = render(deployed, '/new', '/previous')
        self.assertEqual(result, render(original, '/previous', '/previous'))
        self.assertIn('root /previous;', result)
        self.assertNotIn('location = /backend', result)
        self.assertIn('proxy_pass http://127.0.0.1:18081/', result)
        self.assertIn('proxy_pass http://127.0.0.1:18000;', result)

    def test_production_and_unexpected_nginx_config_are_rejected(self):
        with self.assertRaises(ValueError):
            render('server_name graviquest.com;\n    root /production;', '/production', '/new')
        with self.assertRaises(ValueError):
            render('server_name staging.graviquest.com;\n    root /previous;', '/previous', '/new')


class ReleaseEvidence(unittest.TestCase):
    sha = 'a' * 40
    repo = 'hsdarestani/gravitas'

    def data(self, path):
        return {
            'repository': {'full_name': self.repo}, 'head_repository': {'full_name': self.repo},
            'head_sha': self.sha, 'path': path, 'status': 'completed', 'conclusion': 'success',
        }

    def test_ci_must_pass_for_exact_commit_and_repository(self):
        data = self.data(CI)
        verified_run(data, self.repo, CI, self.sha)
        for update in (
            {'head_sha': 'b' * 40},
            {'head_repository': {'full_name': 'other/fork'}},
            {'path': STAGING},
            {'conclusion': 'skipped'},
            {'status': 'in_progress'},
        ):
            with self.subTest(update=update), self.assertRaises(ValueError):
                verified_run({**data, **update}, self.repo, CI, self.sha)

    def test_wrong_run_revision_stage_or_unapproved_operation_cannot_release(self):
        data = dict(revision=self.sha, qa='1167/QA-004', run_id='123', operation='accept',
                    environment='staging-final-approval', status='accepted')
        acceptance(data, self.sha, '123')
        for update in ({'revision': 'b' * 40}, {'run_id': '44'}, {'operation': 'deploy'},
                       {'environment': 'workspace-staging'}, {'qa': ''}, {'status': 'healthy'}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                acceptance({**data, **update}, self.sha, '123')

    def test_protection_requires_reviewers_self_review_block_and_branch_policy(self):
        review = dict(type='required_reviewers', reviewers=[{'id': 1}], prevent_self_review=True)
        branches = dict(protected_branches=True, custom_branch_policies=False)
        approved_environment(dict(protection_rules=[review], deployment_branch_policy=branches))
        for update in (
            {'protection_rules': []},
            {'protection_rules': [{**review, 'prevent_self_review': False}]},
            {'deployment_branch_policy': dict(protected_branches=False, custom_branch_policies=False)},
        ):
            with self.subTest(update=update), self.assertRaises(ValueError):
                approved_environment({**dict(protection_rules=[review], deployment_branch_policy=branches), **update})


if __name__ == '__main__':
    unittest.main()
