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
        self.assertIn("setButton(link, signedIn ? 'Forum' : 'Join Us', signedIn ? FORUM_HOME : '/signup',", source)
        # A member's control carries the Forum's own mark, not Join Us's
        # figure-and-plus (2026-11-19).
        self.assertIn('signedIn ? FORUM_ICON', source)
        self.assertIn("var FORUM_HOME = '/api/forum/resume/';", source)
        self.assertIn("setAccountLink(true);", source)
        self.assertIn("setAccountLink(false);", source)

    def test_a_member_can_sign_out_without_the_workspace(self):
        # The workspace's Settings were the only way out until 2026-11-18, and
        # the workspace is off the public site. The phone menu (site.js) and
        # the sign-in page (production-bridge-core.js) carry Sign out, shown
        # once the session answer says signed in, posting Django's logout.
        site = (ROOT / 'assets' / 'site.js').read_text(encoding='utf-8')
        self.assertIn("signOutTool.setAttribute('data-sign-out', '')", site)
        self.assertIn('signOutTool.hidden = true;', site)
        # And on a wide screen, in the header row, for a member only.
        self.assertIn("headerSignOut.setAttribute('data-sign-out', '')", site)
        self.assertIn('headerSignOut.hidden = true;', site)
        source = BRIDGE.read_text(encoding='utf-8')
        self.assertIn('showSignOut(note);', source)
        self.assertIn("apiPost('/api/auth/logout/', {})", source)
        self.assertIn("closest('[data-sign-out]')", source)

    def test_the_account_card_offers_a_member_the_forum(self):
        # Community's "Join the discussion." card: Create an Account and Sign
        # in for a visitor; the Forum and the Topics for a member. Only admins
        # open threads on the Forum, so nothing offers a member a new one.
        source = BRIDGE.read_text(encoding='utf-8')
        self.assertIn('markJoinCard();', source)
        self.assertIn("document.querySelectorAll('.join__act')", source)
        # Through setButton, never textContent: a g-btn--lead button keeps its
        # icon slot, or its label sits off centre.
        self.assertIn("setButton(primary, 'Enter Forum', FORUM_HOME, FORUM_ICON);", source)
        self.assertIn("setButton(secondary, 'Explore Topics', '/topics');", source)
        self.assertNotIn("'Start a Thread'", source)
        self.assertNotIn('primary.textContent', source)
        page = (ROOT / 'community.html').read_text(encoding='utf-8')
        self.assertIn('<div class="join__act">', page)

    def test_hero_join_us_becomes_the_forum_for_a_member(self):
        # A hero's Join Us means nothing to someone who has joined.
        source = BRIDGE.read_text(encoding='utf-8')
        self.assertIn('markHeroes();', source)
        self.assertIn("setButton(a, 'Enter Forum', FORUM_HOME, FORUM_ICON);", source)
        self.assertIn('data-member-forum', (ROOT / 'index.html').read_text(encoding='utf-8'))
        community = (ROOT / 'community.html').read_text(encoding='utf-8')
        self.assertIn('data-member-forum', community)
        self.assertIn('data-member-start', community)

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
        self.assertIn('/assets/production-bridge-core.js?v=20261123-saved1', source)

    def test_public_pages_reference_current_auth_loader_version(self):
        stale = []
        referenced = []
        for path in ROOT.glob('*.html'):
            source = path.read_text(encoding='utf-8')
            if 'production-bridge.js' not in source:
                continue
            referenced.append(path.name)
            # One loader key on every page since the sign-out controls
            # (2026-11-18), which every public page carries.
            expected = '20261123-saved1'
            if f'production-bridge.js?v={expected}' not in source:
                stale.append(path.name)

        self.assertTrue(referenced)
        self.assertEqual(stale, [], f'Stale public auth bridge references: {stale}')
