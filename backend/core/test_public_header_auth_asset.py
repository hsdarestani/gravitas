from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]
BRIDGE = ROOT / 'assets' / 'production-bridge-core.js'
LOADER = ROOT / 'assets' / 'production-bridge.js'


class PublicHeaderAuthAssetTests(SimpleTestCase):
    def test_header_account_link_follows_the_session(self):
        # Since 2026-11-17 the header's one account control is Join Us, and a
        # signed-in member is sent to the Forum: the workspace is off the
        # public site and opens only by its address.
        source = BRIDGE.read_text(encoding='utf-8')
        self.assertIn("function setAccountLink(signedIn)", source)
        self.assertIn("document.querySelectorAll('[data-account-link]')", source)
        self.assertIn("link.href = signedIn ? FORUM_HOME : '/signup';", source)
        self.assertIn("var FORUM_HOME = '/api/forum/resume/';", source)
        self.assertIn("setAccountLink(true);", source)
        self.assertIn("setAccountLink(false);", source)

    def test_sign_in_never_lands_in_the_workspace(self):
        for path in (BRIDGE, ROOT / 'assets' / 'site.js'):
            source = path.read_text(encoding='utf-8')
            self.assertNotIn("'/workspace'", source, path.name)
            self.assertNotIn('/workspace/kms/library', source, path.name)

    def test_public_headers_carry_one_account_control(self):
        headers = []
        for path in ROOT.glob('*.html'):
            source = path.read_text(encoding='utf-8')
            if 'class="g-header"' not in source or 'lp-header__cta' not in source:
                continue
            headers.append(path.name)
            self.assertNotIn('gh-signin', source, path.name)
            self.assertNotIn('gh-nav-signin', source, path.name)
            self.assertNotIn('data-workspace-link', source, path.name)
            self.assertEqual(source.count('data-account-link'), 2, path.name)
            self.assertIn('href="/signup" aria-label="Create your account" data-account-link', source)
        self.assertTrue(headers)

    def test_public_pages_do_not_link_to_the_workspace(self):
        linked = []
        for path in ROOT.glob('*.html'):
            if path.name in ('workspace.html', 'GraviQuest Redesign.html'):
                continue
            source = path.read_text(encoding='utf-8')
            if 'href="/workspace' in source or 'href="workspace.html' in source:
                linked.append(path.name)
        self.assertEqual(linked, [])

    def test_public_auth_bridge_loader_is_cache_busted(self):
        source = LOADER.read_text(encoding='utf-8')
        self.assertIn('/assets/production-bridge-core.js?v=20261117-forum5', source)

    def test_public_pages_reference_current_auth_loader_version(self):
        stale = []
        referenced = []
        for path in ROOT.glob('*.html'):
            source = path.read_text(encoding='utf-8')
            if 'production-bridge.js' not in source:
                continue
            referenced.append(path.name)
            # Only account.html needs a new loader cache key for the email-
            # confirmation recovery UI. Preserve other public page assets.
            expected = '20261117-forum5' if path.name == 'account.html' else '20261117-forum4'
            if f'production-bridge.js?v={expected}' not in source:
                stale.append(path.name)

        self.assertTrue(referenced)
        self.assertEqual(stale, [], f'Stale public auth bridge references: {stale}')
