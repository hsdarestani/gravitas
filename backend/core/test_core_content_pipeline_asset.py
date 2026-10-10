from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]


class CoreContentPipelineAssetTests(SimpleTestCase):
    def read(self, relative_path):
        return (ROOT / relative_path).read_text(encoding='utf-8')

    def test_router_draws_the_operational_pipeline_directly(self):
        # It used to mount over a read-only ws-views board via a subtree
        # MutationObserver; the router now calls it and the copy is gone.
        app = self.read('assets/ws/ws-app.js')
        views = self.read('assets/ws/ws-views.js')
        js = self.read('assets/ws/ws-core-content-actions.js')
        self.assertIn("import { renderCoreContent } from './ws-core-content-actions.js?v=20261011-r4", app)
        self.assertIn("else if (view === 'core-content') renderCoreContent(host);", app)
        self.assertIn('export function renderCoreContent(host)', js)
        self.assertNotIn('new MutationObserver', js)
        self.assertNotIn('export function renderCoreContent', views)
        self.assertNotIn('installCoreContentActions', self.read('workspace.html'))

    def test_pipeline_uses_canonical_content_api_for_crud(self):
        js = self.read('assets/ws/ws-core-content-actions.js')
        self.assertIn("P.call('/platform/content/'", js)
        self.assertIn("method: 'POST'", js)
        self.assertIn("method: 'PATCH'", js)
        self.assertIn("method: 'DELETE'", js)

    def test_pipeline_exposes_full_v1_content_lifecycle(self):
        js = self.read('assets/ws/ws-core-content-actions.js')
        for status in (
            'idea', 'selected', 'research', 'brief', 'script',
            'scientific_review', 'production', 'edit', 'qa', 'published',
        ):
            self.assertIn(f"['{status}'", js)

    def test_pipeline_can_create_research_handoff(self):
        js = self.read('assets/ws/ws-core-content-actions.js')
        self.assertIn("action: 'request_research'", js)
        self.assertIn("'Request research'", js)
        self.assertIn('research_question', js)
        self.assertIn('priority', js)

    def test_pipeline_supports_publish_metadata_and_archive(self):
        js = self.read('assets/ws/ws-core-content-actions.js')
        self.assertIn('published_url', js)
        self.assertIn("'Archive'", js)
        self.assertIn("'Open live'", js)

    def test_pipeline_does_not_ship_demo_fallback(self):
        js = self.read('assets/ws/ws-core-content-actions.js').lower()
        self.assertNotIn('demo fallback', js)
        self.assertNotIn('fake content', js)


    def test_open_card_uses_overlay_modal_and_keeps_board_mounted(self):
        js = self.read('assets/ws/ws-core-content-actions.js')
        css = self.read('assets/ws/ws.css')
        self.assertIn("openContentModal(item, redraw)", js)
        self.assertIn("el('div', 'core-content-modal')", js)
        self.assertNotIn("const view = await detailItemPanel(item, redraw, () => openForm(null))", js)
        self.assertIn(".core-content-modal {", css)
        self.assertIn("position: fixed", css)
