from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]
BRIDGE = ROOT / 'assets' / 'production-bridge-core.js'
LOADER = ROOT / 'assets' / 'production-bridge.js'


class PublicHeaderAuthAssetTests(SimpleTestCase):
    def test_authenticated_header_hides_join_ctas(self):
        source = BRIDGE.read_text(encoding='utf-8')
        self.assertIn("function setJoinVisibility(visible)", source)
        self.assertIn("document.querySelectorAll('.gh-nav-join, .lp-header__cta')", source)
        self.assertIn("setJoinVisibility(false);", source)
        self.assertIn("setJoinVisibility(true);", source)

    def test_public_auth_bridge_loader_is_cache_busted(self):
        source = LOADER.read_text(encoding='utf-8')
        self.assertIn('/assets/production-bridge-core.js?v=20260920-auth3', source)
