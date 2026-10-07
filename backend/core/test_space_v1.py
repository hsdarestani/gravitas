import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from .ai_providers import decrypt_api_key, encrypt_api_key
from .models import KnowledgeResource, ResearchProject
from .platform_api import ensure_dual_workspaces
from .platform_models import ResearchProjectProfile
from .space_fs import create_node, ensure_note_link, ensure_project_link, filesystem_name
from .space_models import AIProviderCredential, SpaceNode
from .space_project_metadata import project_markdown
from .space_reconcile import _parse_markdown


class SpaceFilesystemTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            'space@example.com', 'space@example.com', 'A-secure-password-123!'
        )
        self.spaces = ensure_dual_workspaces(self.user)

    def test_filesystem_name_replaces_spaces_with_underscores(self):
        self.assertEqual(filesystem_name('  Protein folding project  '), 'Protein_folding_project')
        self.assertEqual(filesystem_name('Nested   Category'), 'Nested_Category')
        self.assertNotIn('/', filesystem_name('Nested / Category'))

    def test_nested_categories_keep_parent_paths(self):
        research = create_node(self.user, 'Research', SpaceNode.Kind.SUBSPACE, sync=False)
        biology = create_node(self.user, 'Biology', SpaceNode.Kind.CATEGORY, parent=research, sync=False)
        modeling = create_node(self.user, 'Cell Models', SpaceNode.Kind.CATEGORY, parent=biology, sync=False)
        self.assertEqual(research.nextcloud_path, 'Space/Research')
        self.assertEqual(biology.nextcloud_path, 'Space/Research/Biology')
        self.assertEqual(modeling.nextcloud_path, 'Space/Research/Biology/Cell_Models')

    @patch('core.space_fs.ensure_space_root')
    def test_project_has_same_name_folder_and_markdown_sidecar(self, ensure_root):
        ensure_root.return_value = object()
        research = create_node(self.user, 'Research', SpaceNode.Kind.SUBSPACE, sync=False)
        category = create_node(self.user, 'Client Work', SpaceNode.Kind.CATEGORY, parent=research, sync=False)
        project = ResearchProject.objects.create(
            workspace=self.spaces['research'], owner=self.user,
            title='Protein Folding', description='Client model',
        )
        link = ensure_project_link(project, user=self.user, category=category, sync=False)
        self.assertEqual(link.folder_path, 'Space/Research/Client_Work/Protein_Folding')
        self.assertEqual(link.metadata_path, 'Space/Research/Client_Work/Protein_Folding.md')
        self.assertEqual(link.category, category)
        self.assertEqual(link.user, self.user)

    def test_project_markdown_contains_complete_form_metadata(self):
        project = ResearchProject.objects.create(
            workspace=self.spaces['research'], owner=self.user,
            title='Cell Atlas', description='Full project brief',
        )
        ResearchProjectProfile.objects.create(
            project=project,
            category='client', visibility='invite', status='active',
            research_question='Which cell states matter?',
            client_name='Client A', requester_name='Requester B', requester_email='requester@example.com',
            confidentiality='restricted', compensation_text='Paid project',
            required_skills=['Python', 'biology'], application_open=True,
            secure_data_room=True, allow_public_links=False, allow_downloads=False,
            currency='EUR',
        )
        text = project_markdown(project, self.user)
        self.assertIn('@project', text)
        self.assertIn('project_type: "client"', text)
        self.assertIn('requester_email: "requester@example.com"', text)
        self.assertIn('required_skills: ["Python", "biology"]', text)
        self.assertIn('application_open: true', text)
        self.assertIn('secure_data_room: true', text)
        self.assertIn('allow_downloads: false', text)
        self.assertIn('Full project brief', text)

    @patch('core.space_fs.ensure_space_root')
    def test_nested_note_uses_parent_same_name_attachment_folder(self, ensure_root):
        ensure_root.return_value = object()
        parent = KnowledgeResource.objects.create(
            workspace=self.spaces['personal'], owner=self.user,
            kind=KnowledgeResource.Kind.NOTE, title='Reading Notes', body='Parent',
        )
        child = KnowledgeResource.objects.create(
            workspace=self.spaces['personal'], owner=self.user,
            kind=KnowledgeResource.Kind.NOTE, title='Paper One', body='Child',
        )
        parent_link = ensure_note_link(parent, attachments=True, sync=False)
        child_link = ensure_note_link(child, parent_note=parent, sync=False)
        self.assertEqual(parent_link.note_path, 'Space/Personal/Notes/Reading_Notes.md')
        self.assertEqual(parent_link.attachments_path, 'Space/Personal/Notes/Reading_Notes')
        self.assertEqual(child_link.note_path, 'Space/Personal/Notes/Reading_Notes/Paper_One.md')
        self.assertEqual(child_link.parent_note, parent)

    def test_markdown_parser_recovers_tag_metadata_and_body(self):
        tag, metadata, body = _parse_markdown(
            '@note\n---\ngravitas_type: note\ntitle: "Field Note"\n---\n\n# Field Note\n\nRemote body\n'
        )
        self.assertEqual(tag, 'note')
        self.assertEqual(metadata['title'], 'Field Note')
        self.assertEqual(body, 'Remote body')

    def test_reconcile_requires_explicit_confirmation(self):
        self.client.force_login(self.user)
        response = self.client.post(
            '/api/platform/space/reconcile/',
            json.dumps({}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error'], 'confirmation_required')


class AIProviderCredentialTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            'ai@example.com', 'ai@example.com', 'A-secure-password-123!'
        )

    def test_api_key_is_encrypted_at_rest(self):
        secret = 'sk-example-do-not-store-plain'
        encrypted = encrypt_api_key(secret)
        self.assertNotIn(secret, encrypted)
        self.assertEqual(decrypt_api_key(encrypted), secret)

    def test_provider_credentials_are_scoped_per_user(self):
        item = AIProviderCredential.objects.create(
            user=self.user,
            provider=AIProviderCredential.Provider.OPENAI,
            label='Research account',
            model='example-model',
            base_url='https://api.openai.com/v1',
            encrypted_api_key=encrypt_api_key('secret'),
            is_default=True,
        )
        self.assertEqual(self.user.gravitas_ai_credentials.get(), item)
        self.assertTrue(item.is_default)
