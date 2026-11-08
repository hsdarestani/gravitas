from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]
BRIDGE = ROOT / 'assets' / 'production-bridge-core.js'
LOADER = ROOT / 'assets' / 'production-bridge.js'


class PublicHeaderAuthAssetTests(SimpleTestCase):
    def test_header_workspace_link_follows_the_session(self):
        source = BRIDGE.read_text(encoding='utf-8')
        self.assertIn("function setWorkspaceLink(signedIn)", source)
        self.assertIn("document.querySelectorAll('[data-workspace-link]')", source)
        self.assertIn("link.href = signedIn ? '/workspace' : '/signup';", source)
        self.assertIn("setWorkspaceLink(true);", source)
        self.assertIn("setWorkspaceLink(false);", source)

    def test_public_headers_carry_one_workspace_control(self):
        headers = []
        for path in ROOT.glob('*.html'):
            source = path.read_text(encoding='utf-8')
            if 'class="g-header"' not in source or 'lp-header__cta' not in source:
                continue
            headers.append(path.name)
            self.assertNotIn('gh-signin', source, path.name)
            self.assertNotIn('gh-nav-signin', source, path.name)
            self.assertEqual(source.count('data-workspace-link'), 2, path.name)
            self.assertIn('href="/signup" aria-label="Create your free workspace" data-workspace-link', source)
        self.assertTrue(headers)

    def test_public_auth_bridge_loader_is_cache_busted(self):
        source = LOADER.read_text(encoding='utf-8')
        self.assertIn('/assets/production-bridge-core.js?v=20261108-forum1', source)


    def test_public_pages_reference_current_auth_loader_version(self):
        stale = []
        referenced = []
        for path in ROOT.glob('*.html'):
            source = path.read_text(encoding='utf-8')
            if 'production-bridge.js' not in source:
                continue
            referenced.append(path.name)
            if 'production-bridge.js?v=20261108-forum1' not in source:
                stale.append(path.name)

        self.assertTrue(referenced)
        self.assertEqual(stale, [], f'Stale public auth bridge references: {stale}')
