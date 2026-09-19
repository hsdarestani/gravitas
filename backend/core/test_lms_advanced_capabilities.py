from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[2]


class AdvancedLmsCapabilityContractTests(SimpleTestCase):
    def read(self, path):
        return (ROOT / path).read_text(encoding='utf-8')

    def test_advanced_learning_models_exist(self):
        models = self.read('backend/core/lms_models.py')
        for marker in (
            'class LearnerPathAssignment',
            'class CourseDiscussionMessage',
            'class LearningIntegration',
            'class LearningRepository',
            'class NotebookWorkspace',
            'class CoursePayment',
            "PENDING = 'pending'",
            "NEEDS_CHANGES = 'needs_changes'",
            "APPROVED = 'approved'",
        ):
            self.assertIn(marker, models)

    def test_advanced_lms_routes_are_publicly_wired(self):
        urls = self.read('backend/core/urls.py')
        for path in (
            "lms/paths/personalize/",
            "lms/integrations/",
            "lms/courses/<int:course_id>/discussion/",
            "lms/courses/<int:course_id>/literature/",
            "lms/courses/<int:course_id>/notebooks/",
            "lms/courses/<int:course_id>/git/",
            "lms/courses/<int:course_id>/publish/",
            "lms/courses/<int:course_id>/pkm/<str:target>/",
            "platform/admin/lms/repositories/",
            "platform/admin/lms/payments/",
            "lms/courses/<int:course_id>/checkout/",
            "lms/courses/<int:course_id>/payment-webhook/",
            "lms/certificates/<uuid:code>/download/",
        ):
            self.assertIn(path, urls)

    def test_learner_surface_contains_requested_research_learning_tools(self):
        js = self.read('assets/ws/ws-member-lms.js')
        for marker in (
            "section('Personal learning path'",
            "section('Course group'",
            "section('Related papers'",
            "section('Reproducible notebook'",
            "section('Versioning · GitHub'",
            "section('Publish an achievement'",
            "section('Export to PKM'",
            "Save offline",
            "Continue to checkout",
            "Download certificate",
            "Publish to ",
        ):
            self.assertIn(marker, js)

    def test_admin_can_configure_learning_policy_and_git_review(self):
        js = self.read('assets/ws/ws-admin.js')
        for marker in (
            "Hints only · never reveal final answer",
            "Course discussion group enabled",
            "Paper recommendations enabled",
            "Notebook workspace enabled",
            "Git/GitHub exercise push enabled",
            "Limited offline read mode enabled",
            "section('Exercise repository review'",
            "Checkout enabled",
            "Checkout URL",
            "section('Course payments'",
            "Path nodes",
            "Path edges",
        ):
            self.assertIn(marker, js)

    def test_tutor_policy_supports_hint_only_guidance(self):
        api = self.read('backend/core/lms_extended_api.py')
        self.assertIn("'hint_only'", api)
        self.assertIn('Do not provide the final answer', api)
        self.assertIn('ai_instructor_prompt', api)

    def test_math_renderer_covers_workspace_and_copies_latex(self):
        html = self.read('workspace.html')
        math = self.read('assets/ws/ws-math.js')
        self.assertIn('installMathRendering()', html)
        self.assertIn("button.textContent = 'LaTeX'", math)
        self.assertIn('navigator.clipboard.writeText(latex)', math)
        self.assertIn('window.katex', math)

    def test_offline_shell_does_not_cache_authenticated_api_responses(self):
        sw = self.read('workspace-sw.js')
        learner = self.read('assets/ws/ws-member-lms.js')
        self.assertIn("if (url.pathname.startsWith('/api/'))", sw)
        self.assertIn('saveOfflineCourseSnapshot', learner)
        self.assertIn('Offline read mode', learner)
        self.assertIn('P.lmsExecuteNotebook(currentId)', learner)
        advanced = self.read('backend/core/lms_advanced_api.py')
        self.assertIn('def notebook_execute', advanced)
        self.assertIn('LMS_JUPYTER_EXEC_URL', advanced)
        self.assertIn('LMS_MATHEMATICA_EXEC_URL', advanced)


    def test_course_media_uses_nextcloud_folders_and_versions(self):
        models = self.read('backend/core/lms_models.py')
        api = self.read('backend/core/lms_extended_api.py')
        admin = self.read('assets/ws/ws-admin.js')
        settings = self.read('backend/gravitas_backend/settings.py')
        for marker in ('logical_id', 'folder_path', 'version_note', 'is_current'):
            self.assertIn(marker, models)
        self.assertIn('LMS_ASSET_NEXTCLOUD_MOUNTPOINT', settings)
        self.assertIn('version_of_id', api)
        self.assertIn('_lms_asset_path', api)
        self.assertIn('Nextcloud-backed media with folders and version history', admin)
        self.assertIn("action('New version'", admin)

    def test_paid_course_flow_tracks_verification_before_enrollment(self):
        api = self.read('backend/core/lms_advanced_api.py')
        admin = self.read('assets/ws/ws-admin.js')
        learner = self.read('assets/ws/ws-member-lms.js')
        self.assertIn('def course_checkout', api)
        self.assertIn('def admin_course_payments', api)
        self.assertIn('def course_payment_webhook', api)
        self.assertIn('X-Gravitas-Payment-Secret', api)
        self.assertIn('CourseEnrollment.AccessSource.PURCHASE', api)
        self.assertIn("section('Course payments'", admin)
        self.assertIn('P.lmsStartCheckout(course.id)', learner)

    def test_certificate_has_downloadable_credential(self):
        api = self.read('backend/core/lms_extended_api.py')
        learner = self.read('assets/ws/ws-member-lms.js')
        self.assertIn('def lms_certificate_download', api)
        self.assertIn('GRAVITAS+', api)
        self.assertIn('Download certificate', learner)

    def test_learning_path_admin_edits_graph_objects_not_raw_json(self):
        api = self.read('backend/core/lms_extended_api.py')
        admin = self.read('assets/ws/ws-admin.js')
        self.assertIn('def _normalize_learning_graph', api)
        self.assertIn("['course', 'Course']", admin)
        self.assertIn("['choice', 'Choice / branch']", admin)
        self.assertIn("section('Path edges'", admin)


class CoreAssetVersioningContractTests(SimpleTestCase):
    def read(self, path):
        return (ROOT / path).read_text(encoding='utf-8')

    def test_core_assets_have_folders_and_explicit_versions(self):
        models = self.read('backend/core/platform_models.py')
        api = self.read('backend/core/core_assets_api.py')
        ui = self.read('assets/ws/ws-core-assets.js')
        for marker in ('logical_id', 'folder_path', 'version_note', 'is_current'):
            self.assertIn(marker, models)
        self.assertIn('version_of_id', api)
        self.assertIn("f'v{int(asset.version):03d}'", api)
        self.assertIn("'New version'", ui)
        self.assertIn("'Rename / move'", ui)
        self.assertIn("'Version history · '", ui)
